import type { SQL } from "@/db/types";

export default async (db: SQL) => {
  await db`CREATE SCHEMA IF NOT EXISTS app`;
};