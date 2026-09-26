import { z } from 'zod';

import { getDb, getPg, isDbUp } from './db/init';
import * as queries from './db/queries';
import { runMigrations } from './db/run-migrations';
import { generateRpcDocs, renderRpcDocsHtml } from './docs/generate-docs';
import { env } from './env';
import { AppError, ErrorCode, InvalidInputError } from './errors';
import { createTokenAuthenticator } from './http/auth';
import { createClientAddressResolver } from './http/client-address';
import { htmlResponse, jsonResponse, notFound, respondError } from './http/format';
import { assertRateLimit, createFixedWindowRateLimiter } from './http/rate-limit';
import { createAppRpcHandler } from './http/rpc';
import { ingressSubpath, isWebhookPathAllowed } from './http/webhook-path-allowlist';
import { startBackgroundWorkers } from './lib/background-worker';
import { getLog } from './log';
import * as services from './services';

import type { BunRequest, Server } from 'bun';
import type { UUID } from 'node:crypto';

const log = getLog();
const authenticate = createTokenAuthenticator(env.SLASHEVENTS_API_TOKEN);
const resolveClientAddress = createClientAddressResolver(env.TRUSTED_PROXY_CIDRS);
const shutdownController = new AbortController();
const { signal } = shutdownController;
const { db, closeDb } = getDb(env, log);
const { pg, closePg } = getPg(env, log);
const appRpcHandler = createAppRpcHandler({ db, pg, log });
const landing = Bun.file(new URL('./http/landing.html', import.meta.url));
const docs = renderRpcDocsHtml(generateRpcDocs(appRpcHandler, env.PUBLIC_URL));
const limiter = (limit: number) => createFixedWindowRateLimiter({ limit, windowMs: 60_000 });
const limits = {
  pages: limiter(env.PUBLIC_RATE_LIMIT_PER_MINUTE),
  rpc: limiter(env.RPC_RATE_LIMIT_PER_MINUTE),
  ingress: limiter(env.INGRESS_RATE_LIMIT_PER_MINUTE),
  authFailures: limiter(env.AUTH_FAILURE_RATE_LIMIT_PER_MINUTE),
};

type RouteHandler = (request: BunRequest, server: Server<undefined>) => Promise<Response> | Response;
const clientAddress = (request: Request, server: Server<undefined>) =>
  resolveClientAddress(request, server.requestIP(request)?.address ?? null);

const route = (handler: RouteHandler, format: 'html' | 'json' = 'json'): RouteHandler => async (request, server) => {
  try {
    return await handler(request, server);
  } catch (error) {
    if (!(error instanceof AppError) && !signal.aborted) log.error(error, 'Request failed');
    return respondError(request, error, { defaultFormat: format });
  }
};

const rpcRoute = route(async (request, server) => {
  const sourceIp = clientAddress(request, server);
  assertRateLimit('authentication attempts', limits.authFailures.check(sourceIp));
  try {
    authenticate(request);
  } catch (error) {
    assertRateLimit('authentication attempts', limits.authFailures.consume(sourceIp));
    throw error;
  }
  assertRateLimit('instance RPC', limits.rpc.consume('instance'));
  const body = await request.json().catch(() => {
    throw new InvalidInputError('Expected a JSON RPC request body');
  });
  return jsonResponse(await appRpcHandler.handle(body, {
    signal: AbortSignal.any([request.signal, signal]),
  }));
});

const ingressRoute = route(async (request, server) => {
  const sourceIp = clientAddress(request, server);
  assertRateLimit('ingress', limits.ingress.consume(sourceIp));
  const parsed = z.uuidv7().safeParse(request.params.projectId);
  if (!parsed.success) throw new InvalidInputError('Invalid projectId');
  const projectId = parsed.data as UUID;
  const url = new URL(request.url);
  const allowedPaths = await queries.getProjectWebhookPathAllowlist(db, { project_id: projectId });
  if (!allowedPaths) throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);
  if (!isWebhookPathAllowed(log)(allowedPaths, ingressSubpath(projectId, url.pathname)))
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Webhook path is not allowlisted for this project');
  const socket = server.requestIP(request);
  const result = await services.events.handleIngress({
    projectId,
    path: url.pathname,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: ['GET', 'HEAD'].includes(request.method) ? null : await request.text(),
    queryString: url.search ? url.search.slice(1) : null,
    sourceIp,
    sourcePort: socket?.address === sourceIp ? socket.port : null,
  }, { db, queries, log });
  if ('error' in result) throw new AppError(result.error as ErrorCode, result.status);
  return jsonResponse(result, { status: 201 });
});

const publicRoute = (handler: RouteHandler): RouteHandler => route((request, server) => {
  assertRateLimit('public pages', limits.pages.consume(clientAddress(request, server)));
  return handler(request, server);
}, 'html');

let app: Server<undefined> | undefined;
let workers: Promise<unknown> = Promise.resolve();
let shuttingDown = false;
const shutdown = async (exitCode: number, reason: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ reason }, 'Stopping SlashEvents');
  shutdownController.abort(new DOMException(reason, 'AbortError'));
  const timeout = setTimeout(() => {
    log.error('Shutdown timed out');
    void app?.stop(true);
    process.exit(1);
  }, 10_000);
  try {
    await app?.stop();
    await workers;
    await Promise.all([closePg(), closeDb()]);
  } catch (error) {
    log.error(error, 'Shutdown failed');
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
  process.exit(exitCode);
};
process.on('SIGINT', () => void shutdown(0, 'SIGINT'));
process.on('SIGTERM', () => void shutdown(0, 'SIGTERM'));

try {
  const { migrationPromise } = runMigrations(db, log);
  await migrationPromise;
  signal.throwIfAborted();
  const workerOptions = { intervalMs: env.RETENTION_INTERVAL_SECONDS * 1000, startAfter: migrationPromise, shutdownSignal: signal };
  workers = startBackgroundWorkers({
    duration: {
      ...workerOptions,
      log: log.child({ worker: 'retentionDuration' }),
      run: (workerLog) => services.events.removeEventsPastRetentionDuration({ db, queries, log: workerLog, signal }),
    },
    count: {
      ...workerOptions,
      log: log.child({ worker: 'retentionMaxCount' }),
      run: (workerLog) => services.events.removeEventsPastRetentionMaxCount({ db, queries, log: workerLog, signal }),
    },
  });
  const readiness = async () => {
    const ready = !shuttingDown && await isDbUp(db, pg, log);
    return new Response(ready ? 'OK' : 'NG', { status: ready ? 200 : 503 });
  };
  app = Bun.serve({
    hostname: '0.0.0.0',
    port: env.PORT,
    idleTimeout: 65,
    maxRequestBodySize: env.MAX_REQUEST_BODY_BYTES,
    routes: {
      '/': { GET: publicRoute(() => new Response(landing, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })) },
      '/docs': { GET: publicRoute(() => htmlResponse(docs)) },
      '/docs/': { GET: publicRoute(() => htmlResponse(docs)) },
      '/rpc': { POST: rpcRoute },
      '/rpc/': { POST: rpcRoute },
      '/ingress/:projectId': ingressRoute,
      '/ingress/:projectId/': ingressRoute,
      '/ingress/:projectId/*': ingressRoute,
      '/health/liveness': { GET: () => new Response('OK') },
      '/health/readiness': { GET: readiness },
      '/*': publicRoute((request) => notFound(request)),
    },
    error: (error) => {
      log.error(error, 'Unhandled server error');
      return new Response(null, { status: 500 });
    },
  });
  log.info({ port: env.PORT }, 'SlashEvents is ready');
} catch (error) {
  log.error(error, 'Startup failed');
  await shutdown(1, 'Startup failed');
}
