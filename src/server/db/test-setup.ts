import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import sortBy from "lodash/sortBy";

export const TEST_DB_URL =
  process.env.TEST_DB_URL ??
  "postgres://slashevents:slashevents@localhost:5432/slashevents_test";

export const getTestDb = () => new SQL(TEST_DB_URL);

/**
 * Resets the test database by dropping all tables and re-running migrations
 */
export const resetTestDb = async (db: SQL) => {
  await db`DROP SCHEMA IF EXISTS app CASCADE`;
  await db`CREATE SCHEMA app`;
  await db`SET search_path TO app`;
  await db`DROP SCHEMA IF EXISTS migrations CASCADE`;
  
  // Run all migrations
  const migrationFileNames = await readdir("src/server/db/migrations");
  const migrationNames = sortBy(migrationFileNames.map(fileName => fileName.replace(".ts", "").replace(".js", "")));
  
  for (const migrationName of migrationNames) {
    const migrationFn = (await import(`./migrations/${migrationName}`)).default;
    await migrationFn(db);
  }
};

