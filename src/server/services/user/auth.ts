import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { SQL } from "bun";

import { RpcError } from "@/server/rpc-handler";
import type { Env } from "@/server/env";
import * as queries from "@/server/db/queries";

const generateSalt = (size: number = 16) => crypto.randomBytes(size).toString("hex");
const hashPassword = (password: string, salt: string) => crypto.pbkdf2Sync(password, salt, 1000, 128, "sha512").toString("hex");
const signUserJwt = (userId: string, privateKey: string) => jwt.sign({ userId }, privateKey);

export const userSignup = async (
  { email, password }: { email: string, password: string }, 
  { db, env }: {db: SQL, env: Env}
): Promise<{ jwtToken: string }> => {
  const passwordSalt = generateSalt();
  const passwordHash = hashPassword(password, passwordSalt);
  const userId = await queries.insertUser(db, { email, passwordHash, passwordSalt });
  if (!userId)
    throw new RpcError("Failed to create user", "InternalServerError", 500);
  const jwtToken = signUserJwt(userId, env.JWT_PRIVATE_KEY);
  return { jwtToken };
}

export const userLogin =async (
  { email, password }: { email: string, password: string }, 
  { db, env }: {db: SQL, env: Env}
): Promise<{ jwtToken: string }> => {
  // no early return to avoid timing attacks
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
  const jwtToken = signUserJwt(foundUser?.id, env.JWT_PRIVATE_KEY);
  return { jwtToken };
}