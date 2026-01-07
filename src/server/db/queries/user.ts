import type { SQL } from "bun";
import type { UUID } from "crypto";

type UserDbRow = {
  id: UUID;
  email: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
  updated_at: string;
}

export const insertUser = async (db: SQL, params: {
  email: string;
  password_hash: string;
  password_salt: string;
}): Promise<string | undefined> => {
  const res = await db`INSERT INTO users ${db(params)} RETURNING id;` as Pick<UserDbRow, "id">[];
  return res[0]?.id;
};

export const getUserById = async (db: SQL, params: { id: UUID }): Promise<Pick<UserDbRow, "id" | "email" | "created_at" | "updated_at"> | undefined> => {
  const res = await db`SELECT id, email, created_at, updated_at FROM users WHERE id = ${params.id};` as Pick<UserDbRow, "id" | "email" | "created_at" | "updated_at">[];
  return res[0];
};

export const getUserByEmail = async (db: SQL, params: { email: string }): Promise<Pick<UserDbRow, "id" | "email" | "created_at" | "updated_at"> | undefined> => {
  const res = await db`SELECT id, email, created_at, updated_at FROM users WHERE email = ${params.email};` as Pick<UserDbRow, "id" | "email" | "created_at" | "updated_at">[];
  return res[0];
};

export const getUserPasswordHashAndSaltByEmail = async (db: SQL, params: { email: string }): Promise<Pick<UserDbRow, "id" | "password_hash" | "password_salt"> | undefined> => {
  const res = await db`SELECT id, email, password_hash, password_salt FROM users WHERE email = ${params.email};` as Pick<UserDbRow, "id" | "email" | "password_hash" | "password_salt">[];
  return res[0];
};