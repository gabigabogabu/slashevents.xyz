import { SQL } from "bun";
import type { SQL as SQLClient } from "@/db/types";
import { logger } from "@/logger";
import { type Env } from "../env";

export const getDb = (env: Env) => {
  const db = new SQL(env.DATABASE_URL, {
    connection: {
      search_path: "app",
    },
  });
  const closeDb = async () => {
    logger.info("Closing database connection");
    await db.close();
  };
  return { db, closeDb };
};

export const isDbUp = async (db: SQLClient) => {
  try {
    const [row] = await db`SELECT 1 as "alive"` as { alive: number }[];
    return row?.alive === 1;
  } catch (error) {
    logger.error(error, "Error checking database status");
    return false;
  }
};
