import type { SQL } from "bun";
import type { UUID } from "crypto";
import jwt from "jsonwebtoken";
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
import { EventType } from "@/lib/event-types";
import { apiKeyHasReadEventsPermission, checkApiKeyJwt, createApiKeyJwt } from "./services/api-keys/api-keys";
export { EventType };

const { db, closeDb } = getDb(env);
const { getMigrationsStatus, migrationPromise } = runMigrations(db);

const okResponse = new Response("OK", { status: 200 });
const ngResponse = new Response("NG", { status: 500 });
export const isAppAlive = async () => (await isDbUp(db)) ? okResponse : ngResponse;
export const isAppReady = async () => (await isDbUp(db) && ((await getMigrationsStatus()) === MigrationStatus.COMPLETED)) ? okResponse : ngResponse;

// Helper to extract user ID from JWT in authenticated endpoints
const withAuth = <P extends { jwt: string }, R>(
  handler: (params: Omit<P, "jwt"> & { actorUserId: UUID }, ctx: { db: SQL }) => Promise<R>
) => {
  return async ({ params }: { params: P }): Promise<R> => {
    const { jwt, ...rest } = params;
    const { userId: actorUserId } = checkUserJwt(jwt, env.APP_JWT_PUBLIC_KEY);
    return handler({
      ...rest,
      actorUserId,
    }, { db });
  };
};

const handleJwt = <P extends { jwt: string }>(params: P) => {
  const { jwt, ...rest } = params;
  const { userId: actorUserId } = checkUserJwt(jwt, env.APP_JWT_PUBLIC_KEY);
  return {
    ...rest,
    actorUserId,
  };
};

const jwtSchema = z.object({ jwt: z.string() });

export const appRpcHandler = new RpcHandler({
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
  getProjectApiKey: defRpc({
    inputValidation: jwtSchema.extend({
      projectId: z.uuid(),
    }),
    handle: async ({ params }) => {
      const authedParams = handleJwt(params);
      const hasPermission = await checkUserHasProjectPermission(db, {
        project_id: authedParams.projectId as UUID,
        user_id: authedParams.actorUserId,
        permission: ProjectPermission.PROJECT_READ_API_KEY,
      });
      if (!hasPermission) {
        throw new RpcError(ErrorCode.PROJECT_NOT_FOUND, 404);
      }
      const apiKey = createApiKeyJwt({ projectId: authedParams.projectId as UUID }, env.API_JWT_PRIVATE_KEY);
      return { apiKey };
    },
  }),
});
export type AppRpc = InferRpc<typeof appRpcHandler>;

export const adminRpcHandler = new RpcHandler({});
export type AdminRpc = InferRpc<typeof adminRpcHandler>;

const exampleJwt = jwt.sign({ example: "example" }, 'secret');
const exampleUUID = crypto.randomUUID();

export const apiRpcHandler = new RpcHandler({
  getEvents: defRpc({
    inputValidation: z.object({
      apiKey: z.jwt().describe("The API key to use for authentication.").meta({example: exampleJwt}),
      type: z.enum(EventType).optional().describe("The type of events to retrieve.").meta({example: EventType.WEBHOOK_RECEIVED}),
      limit: z.number().int().min(1).max(100).optional().describe("The maximum number of events to retrieve.").meta({example: 10}),
      cursor: z.uuid().optional().describe("The cursor to use for pagination.").meta({example: exampleUUID}),
    }),
    outputValidation: z.object({
      events: z.array(z.object({
        id: z.uuid().meta({example: exampleUUID}),
        type: z.enum(EventType).meta({example: EventType.WEBHOOK_RECEIVED}),
        receivedAt: z.string().meta({example: "2026-01-01T00:00:00.000Z"}),
      })),
    }),
    handle: async ({ params }) => {
      const claims = checkApiKeyJwt(params.apiKey, env.API_JWT_PUBLIC_KEY);
      if (!apiKeyHasReadEventsPermission(claims)) {
        throw new RpcError(ErrorCode.FORBIDDEN, 403);
      }
      return eventsService.getEvents(
        {
          projectId: claims.projectId as UUID,
          type: params.type,
          limit: params.limit,
          cursor: params.cursor as UUID | undefined,
        },
        { db }
      );
    },
  }),
});
export type ApiRpc = InferRpc<typeof apiRpcHandler>;

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
