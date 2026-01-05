import type { SQL } from "bun";
import { snakeCaseKeys, camelCaseKeys } from "./queryutils";

export const insertUser = async (db: SQL, data: {
  email: string;
  passwordHash: string;
  passwordSalt: string;
}): Promise<string | undefined> => {
  const snakeCaseData = snakeCaseKeys(data);
  const res = await db`INSERT INTO users ${db(snakeCaseData)} RETURNING id;` as {id: string}[];
  return res[0]?.id;
};

export const getUserPasswordHashAndSaltByEmail = async (db: SQL, {email}: {email: string}): Promise<{id: string, passwordHash: string, passwordSalt: string} | undefined> => {
  const res = await db`SELECT id, password_hash, password_salt FROM users WHERE email = ${email};` as {
    id: string;
    password_hash: string;
    password_salt: string;
  }[];
  return res[0] ? camelCaseKeys(res[0]) : undefined;
};