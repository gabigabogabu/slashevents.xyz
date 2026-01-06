import type { SQL } from "bun";

export default async (db: SQL) => {
  await db`CREATE SCHEMA IF NOT EXISTS app`;
};