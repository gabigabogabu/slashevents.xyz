import { SQL } from "bun";
import { type Env } from "../env";

export const getDb = (env: Env) => {
  const db = new SQL(env.DATABASE_URL);
  db`SET search_path TO app`;
  return db;
};

export const isDbUp = async (db: SQL) => {
  try {
    const [{alive}] = await db`SELECT 1 as "alive"`;
    return alive === 1;
  } catch (error) {
    console.error("Error checking database status:", error);
    return false;
  }
};