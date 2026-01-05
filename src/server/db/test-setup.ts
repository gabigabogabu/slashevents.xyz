import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import sortBy from "lodash/sortBy";

export const TEST_DB_URL = "postgres://web-latch:web-latch@localhost:5432/web-latch-test";

export const getTestDb = () => new SQL(TEST_DB_URL);

/**
 * Resets the test database by dropping all tables and re-running migrations
 */
export const resetTestDb = async (db: SQL) => {
  // Drop all tables in public schema
  await db`DROP SCHEMA IF EXISTS public CASCADE`;
  await db`CREATE SCHEMA public`;
  await db`DROP SCHEMA IF EXISTS migrations CASCADE`;
  
  // Run all migrations
  const migrationFileNames = await readdir("src/server/db/migrations");
  const migrationNames = sortBy(migrationFileNames.map(fileName => fileName.replace(".ts", "").replace(".js", "")));
  
  for (const migrationName of migrationNames) {
    const migrationFn = (await import(`./migrations/${migrationName}`)).default;
    await migrationFn(db);
  }
};

