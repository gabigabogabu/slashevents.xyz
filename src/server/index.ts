import { z } from "zod";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import { env } from "./env";
import { getDb, isDbUp } from "./db/init";
import * as queries from "./db/queries";
import { defRpc, RpcError, RpcHandler } from "./rpc-handler";
import { MigrationStatus, runMigrations } from "./db/run-migrations";

enum HttpStatus {
  OK = 200,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  SERVER_ERROR = 500,
}

export const db = getDb(env);
const { getMigrationsStatus, migrationPromise } = runMigrations(db);

const okResponse = new Response("OK", { status: 200 });
const ngResponse = new Response("NG", { status: 500 });
export const isAppAlive = async () => (await isDbUp(db)) ? okResponse : ngResponse;
export const isAppReady = async () => (await isDbUp(db) && ((await getMigrationsStatus()) === MigrationStatus.COMPLETED)) ? okResponse : ngResponse;

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

const generateSalt = (size: number = 16) => crypto.randomBytes(size).toString("hex");
const hashPassword = (password: string, salt: string) => crypto.pbkdf2Sync(password, salt, 1000, 128, "sha512").toString("hex");
const signUserJwt = (userId: string) => jwt.sign({ userId }, env.JWT_PRIVATE_KEY);

export const appRpc = handleBunServe(new RpcHandler({
  userSignup: defRpc({
    inputValidation: z.object({
      email: z.email(),
      password: z.string().min(8),
    }),
    handle: async ({ params }) => {
      const { email, password } = params;
      const passwordSalt = generateSalt();
      const passwordHash = hashPassword(password, passwordSalt);
      const userId = await queries.insertUser(db, { email, passwordHash, passwordSalt });
      if (!userId)
        throw new RpcError("Failed to create user", "InternalServerError", 500);
      const jwtToken = signUserJwt(userId);
      return { jwtToken };
    },
  }),
  userLogin: defRpc({
    inputValidation: z.object({
      email: z.email(),
      password: z.string().min(8),
    }),
    handle: async ({ params }) => {
      // no early return to avoid timing attacks
      const { email, password } = params;
      // mock user in case no user is found
      const storedUserIdMock = crypto.randomUUID();
      const storedPasswordSaltMock = generateSalt();
      const storedPasswordHashMock = hashPassword("dummy", storedPasswordSaltMock);

      const foundUser = await queries.getUserPasswordHashAndSaltByEmail(db, { email });
      // hash the provided password with the stored salt (or mock salt if no user found)
      const providedPasswordHash = hashPassword(password, foundUser?.passwordSalt ?? storedPasswordSaltMock);
      const storedPasswordHash = foundUser?.passwordHash ?? storedPasswordHashMock;
      // compare even if no user is found to avoid timing attacks
      const isPasswordValid = crypto.timingSafeEqual(Buffer.from(providedPasswordHash), Buffer.from(storedPasswordHash));
      if (!isPasswordValid || !foundUser?.id) {
        throw new RpcError("Invalid email or password", "AuthenticationError", 401);
      };
      const jwtToken = signUserJwt(foundUser?.id);
      return { jwtToken };
    },
  }),
}));
export const adminRpc = handleBunServe(new RpcHandler({}));
export const apiRpc = handleBunServe(new RpcHandler({}));