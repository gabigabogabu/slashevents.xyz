import type { UUID } from "node:crypto";
import type { BunRequest, Server, SocketAddress, SQL } from "bun";
import { z } from "zod";

import { AppError, InvalidInputError } from "@/lib/app-error";
import { ErrorCode } from "@/lib/errors";
import { EventType } from "@/lib/event-types";
import { ProjectPermission } from "@/lib/project-permissions";
import { getDb, isDbUp } from "./db/init";
import { checkUserHasProjectPermission } from "./db/queries/project";
import { MigrationStatus, runMigrations } from "./db/run-migrations";
import { generateRpcDocs, renderRpcDocsHtml } from "./docs/generate-docs";
import { env } from "./env";
import { requireAgentUser } from "./http/auth";
import { htmlResponse, jsonResponse, notFound, respondError } from "./http/format";
import { assertRateLimit, createFixedWindowRateLimiter, rateLimitHint } from "./http/rate-limit";
import { defRpc, RpcHandler } from "./rpc-handler";
import type { Rpc } from "./rpc-handler";
import * as agentService from "./services/agents/agents";
import * as eventsService from "./services/events/events";
import * as projectService from "./services/project/project";

const services = {
  agents: agentService,
  events: eventsService,
  projects: projectService,
};
const queries = { checkUserHasProjectPermission };
const auth = { requireAgentUser };
const rateLimits = {
  publicPageByIp: createFixedWindowRateLimiter({ limit: 60, windowMs: 60_000 }),
  publicRpcByIp: createFixedWindowRateLimiter({ limit: 10, windowMs: 10 * 60_000 }),
  authFailureByIp: createFixedWindowRateLimiter({ limit: 20, windowMs: 60_000 }),
  ingressByIp: createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000 }),
  agentRpcByAgent: createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000 }),
};

type RpcContext = {
  request: Request;
  body: string;
  sourceIp: string;
};

type DbHealthCheck = (db: SQL) => Promise<boolean> | boolean;

const okResponse = new Response("OK", { status: 200 });
const ngResponse = new Response("NG", { status: 500 });
const landing = Bun.file(new URL("./http/landing.html", import.meta.url));

const parseUuid = (value: string | undefined, name: string): UUID => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new InvalidInputError(`Invalid ${name}`);
  return parsed.data as UUID;
};

const agentUserSchema = z.object({
  id: z.uuid(),
  alias: z.string(),
  fingerprintSha256: z.string(),
  subject: z.string().nullable(),
  certValidFrom: z.string().nullable(),
  certValidTo: z.string().nullable(),
  createdAt: z.string(),
  revoked: z.boolean(),
  revokedAt: z.string().nullable(),
});

const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
});

const eventSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  type: z.enum(EventType),
  data: z.unknown(),
  receivedAt: z.string(),
  actorName: z.string().nullable(),
});

type AppAuth = typeof auth;
type AuthenticatedUser = Awaited<ReturnType<AppAuth["requireAgentUser"]>>;
type AppQueries = typeof queries;
type AppServices = typeof services;
type AppRateLimits = typeof rateLimits;

type RpcDeps = {
  db: SQL;
  services: AppServices;
  queries: AppQueries;
  auth: AppAuth;
  rateLimits: AppRateLimits;
};

const rateLimitKey = (scope: string, value: string): string => `${scope}:${value}`;

const createRequireRpcUser = ({ db, auth, rateLimits }: Pick<RpcDeps, "db" | "auth" | "rateLimits">) =>
  async (_rpc: Rpc<unknown>, context: RpcContext) => {
    const failureKey = rateLimitKey("ip", context.sourceIp);
    assertRateLimit("failed authenticated RPC attempts", rateLimits.authFailureByIp.check(failureKey));

    try {
      return {
        success: true,
        result: await auth.requireAgentUser(context.request, { db, body: context.body }),
      };
    } catch (error) {
      assertRateLimit("failed authenticated RPC attempts", rateLimits.authFailureByIp.consume(failureKey));
      throw error;
    }
  };

const createAgentRpcRateLimit = ({ rateLimits }: Pick<RpcDeps, "rateLimits">) =>
  async (_rpc: Rpc<unknown>, authResult: { result: AuthenticatedUser }) => {
    const rateLimit = rateLimits.agentRpcByAgent.consume(
      rateLimitKey("agent", authResult.result.id),
    );
    return {
      success: rateLimit.allowed,
      result: rateLimit.allowed ? rateLimit : rateLimitHint("agent RPC", rateLimit),
    };
  };

const createAuthenticatedRpcGuards = (deps: RpcDeps) => ({
  auth: createRequireRpcUser(deps),
  rateLimit: createAgentRpcRateLimit(deps),
});

const createAppRpcHandler = (deps: RpcDeps) =>
  new RpcHandler({

    ackMessages: defRpc({
      inputValidation: z.object({
        messageIds: z.array(z.uuidv7()).min(1),
      }),
      outputValidation: z.object({ ok: z.boolean() }),
      ...createAuthenticatedRpcGuards(deps),
      handle: async () => ({ ok: true }),
    }),

    createUser: defRpc({
      inputValidation: z.object({
        alias: z.string().trim().min(1).max(255),
        publicCertPem: z.string().trim().min(1),
      }),
      outputValidation: z.object({ user: agentUserSchema }),
      handle: async ({ params }) => services.agents.createAgentUser(params, { db }),
    }),

    createProject: defRpc({
      inputValidation: z.object({ name: z.string().trim().min(1).max(255) }),
      outputValidation: z.object({ projectId: z.uuid() }),
      ...createAuthenticatedRpcGuards(deps),
      handle: async ({ params, authResult }) =>
        deps.services.projects.createProject({
          name: params.name,
          actorUserId: (authResult.result as AuthenticatedUser).id,
        }, { db: deps.db }),
    }),

    getProjects: defRpc({
      inputValidation: z.object({}),
      outputValidation: z.object({ projects: z.array(projectSchema) }),
      ...createAuthenticatedRpcGuards(deps),
      handle: async ({ authResult }) =>
        deps.services.projects.getProjects({
          actorUserId: (authResult.result as AuthenticatedUser).id,
        }, { db: deps.db }),
    }),

    getProject: defRpc({
      inputValidation: z.object({ projectId: z.uuid() }),
      outputValidation: z.object({ project: projectSchema }),
      ...createAuthenticatedRpcGuards(deps),
      handle: async ({ params, authResult }) =>
        deps.services.projects.getProject({
          projectId: params.projectId as UUID,
          actorUserId: (authResult.result as AuthenticatedUser).id,
        }, { db: deps.db }),
    }),

    getProjectUsers: defRpc({
      inputValidation: z.object({ projectId: z.uuid() }),
      outputValidation: z.object({
        users: z.array(z.object({
          userId: z.uuid(),
          displayName: z.string(),
          permissions: z.array(z.enum(ProjectPermission)),
        })),
      }),
      ...createAuthenticatedRpcGuards(deps),
      handle: async ({ params, authResult }) =>
        deps.services.projects.getProjectUsers({
          projectId: params.projectId as UUID,
          actorUserId: (authResult.result as AuthenticatedUser).id,
        }, { db: deps.db }),
    }),

    addUserToProject: defRpc({
      inputValidation: z.object({
        projectId: z.uuid(),
        userId: z.uuid(),
        permissions: z.array(z.enum(ProjectPermission)).min(1),
      }),
      outputValidation: z.object({ ok: z.boolean() }),
      ...createAuthenticatedRpcGuards(deps),
      handle: async ({ params, authResult }) => {
        await deps.services.projects.addUserToProject({
          projectId: params.projectId as UUID,
          actorUserId: (authResult.result as AuthenticatedUser).id,
          userIdToAdd: params.userId as UUID,
          permissions: params.permissions,
        }, { db: deps.db });
        return { ok: true };
      },
    }),

    updateProjectUserPermissions: defRpc({
      inputValidation: z.object({
        projectId: z.uuid(),
        userId: z.uuid(),
        permissions: z.array(z.enum(ProjectPermission)).min(1),
      }),
      outputValidation: z.object({ ok: z.boolean() }),
      ...createAuthenticatedRpcGuards(deps),
      handle: async ({ params, authResult }) => {
        await deps.services.projects.updateUserProjectPermissions({
          projectId: params.projectId as UUID,
          actorUserId: (authResult.result as AuthenticatedUser).id,
          userIdToUpdate: params.userId as UUID,
          permissions: params.permissions,
        }, { db: deps.db });
        return { ok: true };
      },
    }),

    removeUserFromProject: defRpc({
      inputValidation: z.object({
        projectId: z.uuid(),
        userId: z.uuid(),
      }),
      outputValidation: z.object({ ok: z.boolean() }),
      ...createAuthenticatedRpcGuards(deps),
      handle: async ({ params, authResult }) => {
        await deps.services.projects.removeUserFromProject({
          projectId: params.projectId as UUID,
          actorUserId: (authResult.result as AuthenticatedUser).id,
          userIdToRemove: params.userId as UUID,
        }, { db: deps.db });
        return { ok: true };
      },
    }),

    getEvents: defRpc({
      inputValidation: z.object({
        projectId: z.uuid(),
        type: z.enum(EventType).optional(),
        limit: z.number().int().min(1).max(100).default(100),
        cursor: z.string().optional(),
        longPollDurationSeconds: z.number().int().min(0).max(60).default(0),
      }),
      outputValidation: z.object({
        events: z.array(eventSchema),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      }),
      ...createAuthenticatedRpcGuards(deps),
      handle: async ({ params, authResult }) => {
        const actorUserId = (authResult.result as AuthenticatedUser).id;
        const projectId = params.projectId as UUID;
        const hasPermission = await deps.queries.checkUserHasProjectPermission(deps.db, {
          project_id: projectId,
          user_id: actorUserId,
          permission: ProjectPermission.PROJECT_READ_EVENTS,
        });
        if (!hasPermission) throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);
        return deps.services.events.getEventsLongPoll({
          projectId,
          type: params.type,
          limit: params.limit,
          cursor: params.cursor,
          longPollDurationSeconds: params.longPollDurationSeconds,
        }, { db: deps.db });
      },
    }),

  });

type AppRpcHandler = ReturnType<typeof createAppRpcHandler>;

const forwardedIp = (request: Request, socket: SocketAddress | null): string | null =>
  request.headers.get("cf-connecting-ip")?.trim()
  || request.headers.get("x-real-ip")?.trim()
  || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  || socket?.address
  || null;

const forwardedPort = (request: Request, socket: SocketAddress | null): number | null => {
  const nativePort = socket?.port;
  if (nativePort) return nativePort;
  const rawPort = request.headers.get("x-forwarded-port")?.trim();
  if (!rawPort) return null;
  const port = Number.parseInt(rawPort, 10);
  return Number.isInteger(port) ? port : null;
};

const sourceIpForRequest = (request: Request, server: Server<undefined>): string =>
  forwardedIp(request, server.requestIP(request)) ?? "unknown";

type RouteHandler = (request: BunRequest, server: Server<undefined>) => Promise<Response> | Response;

const createIpRateLimitedRoute = (
  {
    limiter,
    scope,
    defaultFormat,
    handler,
  }: {
    limiter: AppRateLimits[keyof AppRateLimits];
    scope: string;
    defaultFormat: "html" | "json";
    handler: RouteHandler;
  },
): RouteHandler =>
  async (request, server) => {
    try {
      const sourceIp = sourceIpForRequest(request, server);
      assertRateLimit(scope, limiter.consume(rateLimitKey("ip", sourceIp)));
      return await handler(request, server);
    } catch (error) {
      if (!(error instanceof AppError)) console.error("Unhandled route error", error);
      return respondError(request, error, { defaultFormat });
    }
  };

const createIsAppAlive = (
  { db, isDbUp }: {
    db: SQL;
    isDbUp: DbHealthCheck;
  },
) =>
  async () => (await isDbUp(db)) ? okResponse : ngResponse;

const createIsAppReady = (
  { db, getMigrationsStatus, isDbUp }: {
    db: SQL;
    getMigrationsStatus: () => Promise<MigrationStatus>;
    isDbUp: DbHealthCheck;
  },
) =>
  async () =>
    (await isDbUp(db)) && ((await getMigrationsStatus()) === MigrationStatus.COMPLETED)
      ? okResponse
      : ngResponse;

const createRpcRoute = (
  { appRpcHandler, migrationPromise, rateLimits }: {
    appRpcHandler: AppRpcHandler;
    migrationPromise: Promise<unknown>;
    rateLimits: AppRateLimits;
  },
) =>
  async (request: BunRequest, server: Server<undefined>): Promise<Response> => {
    try {
      await migrationPromise;
      const sourceIp = sourceIpForRequest(request, server);
      // Auth signs the exact request body, so keep the raw text and parse it
      // separately instead of using request.json().
      const body = await request.text().catch(() => {
        throw new InvalidInputError("Expected a JSON RPC request body");
      });
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        assertRateLimit("public RPC", rateLimits.publicRpcByIp.consume(rateLimitKey("ip", sourceIp)));
        throw new InvalidInputError("Expected a JSON RPC request body");
      }
      const method = payload && typeof payload === "object" && "method" in payload
        ? (payload as { method?: unknown }).method
        : undefined;
      if (typeof method !== "string" || method === "createUser" || !(method in appRpcHandler.getRpcDefs())) {
        assertRateLimit("public RPC", rateLimits.publicRpcByIp.consume(rateLimitKey("ip", sourceIp)));
      }

      const context: RpcContext = { request, body, sourceIp };
      const result = await appRpcHandler.handle(payload, context);
      return jsonResponse(result);
    } catch (error) {
      if (!(error instanceof AppError)) console.error("Unhandled route error", error);
      return respondError(request, error, { defaultFormat: "json" });
    }
  };

const createDocsRoute = (
  { appRpcHandler, migrationPromise }: {
    appRpcHandler: AppRpcHandler;
    migrationPromise: Promise<unknown>;
  },
) =>
  async (request: Request): Promise<Response> => {
    try {
      await migrationPromise;
      return htmlResponse(renderRpcDocsHtml(generateRpcDocs(appRpcHandler)));
    } catch (error) {
      if (!(error instanceof AppError)) console.error("Unhandled route error", error);
      return respondError(request, error, { defaultFormat: "html" });
    }
  };

const createHandleWebhook = (
  { db, migrationPromise, services }: {
    db: SQL;
    migrationPromise: Promise<unknown>;
    services: AppServices;
  },
) =>
  async (request: BunRequest, server: Server<undefined>): Promise<Response> => {
    try {
      await migrationPromise;
      const projectId = parseUuid(request.params.projectId, "projectId");
      const headers = Object.fromEntries(request.headers.entries());
      const body = ["GET", "HEAD"].includes(request.method)
        ? null
        : await request.text().catch(() => null);
      const url = new URL(request.url);
      const socket = server.requestIP(request);
      const result = await services.events.handleIngress({
        projectId,
        path: url.pathname,
        method: request.method,
        headers,
        body,
        queryString: url.search ? url.search.slice(1) : null,
        sourceIp: forwardedIp(request, socket),
        sourcePort: forwardedPort(request, socket),
      }, { db });

      if ("error" in result)
        throw new AppError(result.error as ErrorCode, result.status);
      return jsonResponse(result, { status: 201 });
    } catch (error) {
      if (!(error instanceof AppError)) console.error("Unhandled route error", error);
      return respondError(request, error, { defaultFormat: "json" });
    }
  };

const notFoundRoute = (request: Request): Response => notFound(request);

const { db, closeDb } = getDb(env);
const { getMigrationsStatus, migrationPromise } = runMigrations(db);

const appRpcHandler = createAppRpcHandler({ db, services, queries, auth, rateLimits });
const rpcRoute = createRpcRoute({ appRpcHandler, migrationPromise, rateLimits });
const docsRoute = createDocsRoute({ appRpcHandler, migrationPromise });
const handleWebhook = createHandleWebhook({ db, migrationPromise, services });
const isAppAlive = createIsAppAlive({ db, isDbUp });
const isAppReady = createIsAppReady({ db, getMigrationsStatus, isDbUp });
const landingRoute = createIpRateLimitedRoute({
  limiter: rateLimits.publicPageByIp,
  scope: "public pages",
  defaultFormat: "html",
  handler: () => new Response(landing, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }),
});
const publicDocsRoute = createIpRateLimitedRoute({
  limiter: rateLimits.publicPageByIp,
  scope: "public pages",
  defaultFormat: "html",
  handler: docsRoute,
});
const ingressRoute = createIpRateLimitedRoute({
  limiter: rateLimits.ingressByIp,
  scope: "ingress",
  defaultFormat: "json",
  handler: handleWebhook,
});
const publicNotFoundRoute = createIpRateLimitedRoute({
  limiter: rateLimits.publicPageByIp,
  scope: "public pages",
  defaultFormat: "html",
  handler: notFoundRoute,
});

const app = Bun.serve({
  port: env.PORT,
  routes: {
    "/": landingRoute,
    "/rpc": { POST: rpcRoute },
    "/docs": { GET: publicDocsRoute },
    "/ingress/:projectId": ingressRoute,
    "/ingress/:projectId/*": ingressRoute,
    "/health/liveness": { GET: isAppAlive },
    "/health/readiness": { GET: isAppReady },
    "/*": publicNotFoundRoute,
  },
  error: (error) => {
    console.error("Unhandled server error", error);
    return new Response(null, { status: 500 });
  },
});

console.log(`Server running at http://127.0.0.1:${env.PORT}`);

const shutdown = async (signal: string) => {
  console.log(`Shutting down server on ${signal}`);
  await app.stop();
  await closeDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
