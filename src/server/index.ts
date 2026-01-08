import type { SQL } from "bun";
import type { UUID } from "crypto";
import { z } from "zod";

import { env } from "./env";
import { getDb, isDbUp } from "./db/init";
import { defRpc, RpcHandler, RpcError } from "./rpc-handler";
import type { InferRpc } from "./rpc-handler";
import { ErrorCode } from "@/lib/errors";
import { MigrationStatus, runMigrations } from "./db/run-migrations";
import { userSignup, userLogin, checkUserJwt } from "./services/user/auth";
import * as projectService from "./services/project/project";
import * as eventsService from "./services/events/events";
import { ProjectPermission, checkUserHasProjectPermission } from "./db/queries/project";
import { EventType } from "./db/queries/event";
export { EventType };

enum HttpStatus {
  OK = 200,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  SERVER_ERROR = 500,
}

const { db, closeDb } = getDb(env);
const { getMigrationsStatus, migrationPromise } = runMigrations(db);

const okResponse = new Response("OK", { status: 200 });
const ngResponse = new Response("NG", { status: 500 });
export const isAppAlive = async () => (await isDbUp(db)) ? okResponse : ngResponse;
export const isAppReady = async () => (await isDbUp(db) && ((await getMigrationsStatus()) === MigrationStatus.COMPLETED)) ? okResponse : ngResponse;

const handleBunServe = <T extends Record<string, any>>(handler: RpcHandler<T>) => {
  const serve = async (req: Request): Promise<Response> => {
    try {
      const rpcReq = await req.json();
      const result = await handler.handle(rpcReq);
      if ('error' in result)
        return Response.json(result, { status: HttpStatus.BAD_REQUEST });
      if (result.id === null || result.id === undefined)
        return new Response(null, { status: HttpStatus.NO_CONTENT });
      return Response.json(result, { status: HttpStatus.OK });
    } catch (error) {
      console.error('Unhandled error in RPC handler', error);
      return new Response(null, { status: HttpStatus.SERVER_ERROR });
    }
  };
  return serve as typeof serve & { _rpcType: InferRpc<RpcHandler<T>> };
};

// Helper to extract user ID from JWT in authenticated endpoints
const withAuth = <P extends { jwt: string }, R>(
  handler: (params: Omit<P, "jwt"> & { actorUserId: UUID }, ctx: { db: SQL }) => Promise<R>
) => {
  return async ({ params }: { params: P }): Promise<R> => {
    const { jwt, ...rest } = params;
    const { userId: actorUserId } = checkUserJwt(jwt, env.JWT_PUBLIC_KEY);
    return handler({
      ...rest,
      actorUserId,
    }, { db });
  };
};

const handleJwt = <P extends { jwt: string }>(params: P) => {
  const { jwt, ...rest } = params;
  const { userId: actorUserId } = checkUserJwt(jwt, env.JWT_PUBLIC_KEY);
  return {
    ...rest,
    actorUserId,
  };
};

const jwtSchema = z.object({ jwt: z.string() });

const _appRpcHandler = new RpcHandler({
  userSignup: defRpc({
    inputValidation: z.object({
      email: z.email(),
      password: z.string().min(8),
    }),
    handle: async ({ params }) => userSignup(params, { db, env }),
  }),
  userLogin: defRpc({
    inputValidation: z.object({
      email: z.email(),
      password: z.string().min(8),
    }),
    handle: async ({ params }) => userLogin(params, { db, env }),
  }),

  // Project endpoints
  createProject: defRpc({
    inputValidation: jwtSchema.extend({
      name: z.string().min(1).max(255),
    }),
    handle: ({ params }) => {
      const authedParams = handleJwt(params);
      return projectService.createProject(authedParams, { db })
    },
  }),
  getProjects: defRpc({
    inputValidation: jwtSchema,
    handle: ({ params }) => {
      const authedParams = handleJwt(params);
      return projectService.getProjects(authedParams, { db })
    },
  }),
  getProject: defRpc({
    inputValidation: jwtSchema.extend({
      projectId: z.uuid(),
    }),
    handle: ({ params }) => {
      const authedParams = handleJwt(params);
      return projectService.getProject({ ...authedParams, projectId: authedParams.projectId as UUID }, { db })
    },
  }),
  getProjectUsers: defRpc({
    inputValidation: jwtSchema.extend({
      projectId: z.uuid(),
    }),
    handle: ({ params }) => {
      const authedParams = handleJwt(params);
      return projectService.getProjectUsers({ ...authedParams, projectId: authedParams.projectId as UUID }, { db })
    },
  }),
  addUserToProject: defRpc({
    inputValidation: jwtSchema.extend({
      projectId: z.uuid(),
      userEmail: z.email(),
      permissions: z.array(z.nativeEnum(ProjectPermission)),
    }),
    handle: ({ params }) => {
      const authedParams = handleJwt(params);
      return projectService.addUserToProject({ ...authedParams, projectId: authedParams.projectId as UUID }, { db })
    },
  }),
  removeUserFromProject: defRpc({
    inputValidation: jwtSchema.extend({
      projectId: z.uuid(),
      userIdToRemove: z.uuid(),
    }),
    handle: ({ params }) => {
      const authedParams = handleJwt(params);
      return projectService.removeUserFromProject({ 
        ...authedParams, 
        projectId: authedParams.projectId as UUID, 
        userIdToRemove: authedParams.userIdToRemove as UUID 
      }, { db })
    },
  }),
  updateUserProjectPermissions: defRpc({
    inputValidation: jwtSchema.extend({
      projectId: z.uuid(),
      userIdToUpdate: z.uuid(),
      permissions: z.array(z.nativeEnum(ProjectPermission)),
    }),
    handle: ({ params }) => {
      const authedParams = handleJwt(params);
      return projectService.updateUserProjectPermissions({ 
        ...authedParams, 
        projectId: authedParams.projectId as UUID, 
        userIdToUpdate: authedParams.userIdToUpdate as UUID 
      }, { db })
    },
  }),
  getEvents: defRpc({
    inputValidation: jwtSchema.extend({
      projectId: z.uuid(),
      type: z.nativeEnum(EventType).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.uuid().optional(),
    }),
    handle: async ({ params }) => {
      const authedParams = handleJwt(params);
      const hasPermission = await checkUserHasProjectPermission(db, {
        project_id: authedParams.projectId as UUID,
        user_id: authedParams.actorUserId,
        permission: ProjectPermission.PROJECT_READ_EVENTS,
      });
      if (!hasPermission) {
        throw new RpcError(ErrorCode.PROJECT_NOT_FOUND, 404);
      }
      return eventsService.getEvents({ 
        projectId: authedParams.projectId as UUID,
        type: authedParams.type,
        limit: authedParams.limit as number | undefined,
        cursor: authedParams.cursor as UUID | undefined
      }, { db })
    },
  }),
});

export const appRpc = handleBunServe(_appRpcHandler);
export type AppRpc = typeof appRpc._rpcType;

const _adminRpcHandler = new RpcHandler({});
export const adminRpc = handleBunServe(_adminRpcHandler);
export type AdminRpc = typeof adminRpc._rpcType;

const _apiRpcHandler = new RpcHandler({});
export const apiRpc = handleBunServe(_apiRpcHandler);
export type ApiRpc = typeof apiRpc._rpcType;

export const closeServer = async () => {
  await closeDb();
};

// Ingress handler for webhook endpoints
export const handleWebhook = async (req: Request, server: Bun.Server<unknown>, projectId: string, restOfPath: string): Promise<Response> => {
  try {
    const headers = req.headers.toJSON();

    let body: string | null = null;
    try {
      body = await req.text();
    } catch {
      body = null;
    }

    // Extract query string
    const url = new URL(req.url);
    const queryString = url.search ? url.search.slice(1) : null;

    // Extract source IP (from headers or connection)
    const source = server.requestIP(req)
    const sourceIp = source?.address ?? null;
    const sourcePort = source?.port ?? null;

    const result = await eventsService.handleIngress({
      projectId: projectId as UUID,
      path: "/" + restOfPath,
      method: req.method,
      headers,
      body,
      queryString,
      sourceIp,
      sourcePort,
    }, { db });

    if ("error" in result) {
      return new Response(JSON.stringify({ error: result.error }), { 
        status: result.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ eventId: result.eventId }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Error handling ingress request:", error);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
