import { z } from "zod";

import { env } from "./env";
import { getDb, isDbUp } from "./db/init";
import { defRpc, RpcHandler } from "./rpc-handler";
import type { InferRpc } from "./rpc-handler";
import { MigrationStatus, runMigrations } from "./db/run-migrations";
import { userSignup, userLogin } from "./services/user/auth";

enum HttpStatus {
  OK = 200,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  SERVER_ERROR = 500,
}

const {db, closeDb} = getDb(env);
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