import { env } from "./env";
import { getDb, isDbUp as isDbUpFn } from "./db/init";
import { RpcHandler } from "./rpc-handler";
import { MigrationStatus, runMigrations } from "./db/run-migrations";

export const db = getDb(env);
const { getMigrationsStatus, migrationPromise } = runMigrations(db);

const okResponse = new Response("OK", { status: 200 });
const ngResponse = new Response("NG", { status: 500 });
export const isAppAlive = async () => {
  if (!await isDbUpFn(db))
    return ngResponse;
  return okResponse;
}
export const isAppReady = async () => {
  if ((await getMigrationsStatus()) !== MigrationStatus.COMPLETED || !await isDbUpFn(db))
    return ngResponse;
  return okResponse;
}

enum HttpStatus {
  OK = 200,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  SERVER_ERROR = 500,
}

const handleBunServe = (handler: RpcHandler<any>) => {
  return async (req: Request): Promise<Response> => {
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
  }
}

export const appRpc = handleBunServe(new RpcHandler({}));
export const adminRpc = handleBunServe(new RpcHandler({}));
export const apiRpc = handleBunServe(new RpcHandler({}));