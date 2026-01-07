import type { SQL } from "bun";
import crypto, { type UUID } from "node:crypto";

import jwt from "jsonwebtoken";
import { z } from "zod";

import { ErrorCode } from "@/lib/errors";
import { RpcError } from "@/server/rpc-handler";
import type { Env } from "@/server/env";
import * as queries from "@/server/db/queries";

// Password
const generateSalt = (size: number = 16) => crypto.randomBytes(size).toString("hex");
const hashPassword = (password: string, salt: string) => crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");

// JWT
const signUserJwt = (userId: string, privateKey: string) => jwt.sign({ userId }, privateKey, { algorithm: "RS256" });
const verifyUserJwt = (token: string, publicKey: string) => jwt.verify(token, publicKey, { algorithms: ["RS256"] });
const jwtSchema = z.object({ userId: z.uuid() });
const safeParseJwtSchema = (object: ReturnType<typeof verifyUserJwt>) => jwtSchema.safeParse(object) as z.ZodSafeParseResult<{ userId: UUID }>;

// User
export const userSignup = async (
  { email, password }: { email: string, password: string },
  { db, env }: { db: SQL, env: Env }
): Promise<{ jwt: string }> => {
  const passwordSalt = generateSalt();
  const passwordHash = hashPassword(password, passwordSalt);
  const userId = await queries.insertUser(db, {
    email,
    password_hash: passwordHash,
    password_salt: passwordSalt
  });
  if (!userId)
    throw new RpcError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Failed to create user");
  const jwt = signUserJwt(userId, env.JWT_PRIVATE_KEY);
  return { jwt };
}

export const userLogin = async (
  { email, password }: { email: string, password: string },
  { db, env }: { db: SQL, env: Env }
): Promise<{ jwt: string }> => {
  // no early return to avoid timing attacks
  // mock user in case no user is found
  const storedPasswordSaltMock = generateSalt();
  const storedPasswordHashMock = hashPassword("dummy", storedPasswordSaltMock);

  const foundUser = await queries.getUserPasswordHashAndSaltByEmail(db, { email });
  // hash the provided password with the stored salt (or mock salt if no user found)
  const providedPasswordHash = hashPassword(password, foundUser?.password_salt ?? storedPasswordSaltMock);
  const storedPasswordHash = foundUser?.password_hash ?? storedPasswordHashMock;
  // compare even if no user is found to avoid timing attacks
  const isPasswordValid = crypto.timingSafeEqual(Buffer.from(providedPasswordHash), Buffer.from(storedPasswordHash));
  if (!isPasswordValid || !foundUser?.id) {
    throw new RpcError(ErrorCode.INVALID_CREDENTIALS, 401);
  };
  const jwt = signUserJwt(foundUser?.id, env.JWT_PRIVATE_KEY);
  return { jwt };
}

export const checkUserJwt = (token: string, publicKey: string) => {
  const decoded = verifyUserJwt(token, publicKey);
  const validated = safeParseJwtSchema(decoded);
  if (!validated.success)
    throw new RpcError(ErrorCode.AUTHENTICATION_ERROR, 401, "Invalid JWT token");
  return validated.data;
};