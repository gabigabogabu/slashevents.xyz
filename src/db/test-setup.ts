import { SQL } from "bun";
import type { SQL as SQLClient } from "@/db/types";
import { readdir } from "node:fs/promises";
import sortBy from "lodash/sortBy";

export const TEST_DB_URL =
  process.env.TEST_DB_URL ??
  "postgres://slashevents:slashevents@localhost:5432/slashevents_test";

export const getTestDb = () => new SQL(TEST_DB_URL, {
  connection: {
    search_path: "app",
  },
});

/**
 * Resets the test database by dropping all tables and re-running migrations
 */
export const resetTestDb = async (db: SQLClient) => {
  await db`DROP SCHEMA IF EXISTS app CASCADE`;
  await db`CREATE SCHEMA app`;
  await db`SET search_path TO app`;
  await db`DROP SCHEMA IF EXISTS migrations CASCADE`;
  
  // Run all migrations
  const migrationFileNames = await readdir("src/db/migrations");
  const migrationNames = sortBy(migrationFileNames.map(fileName => fileName.replace(".ts", "").replace(".js", "")));
  const migrationFileByName = new Map(migrationFileNames.map((fileName) => [
    fileName.replace(".ts", "").replace(".js", ""),
    fileName,
  ]));
  
  for (const migrationName of migrationNames) {
    const migrationFileName = migrationFileByName.get(migrationName);
    if (!migrationFileName) throw new Error(`Migration file not found: ${migrationName}`);
    const migrationFn = (await import(`./migrations/${migrationFileName}`)).default;
    await migrationFn(db);
  }
};
