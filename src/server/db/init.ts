import { SQL } from "bun";
import { type Env } from "../env";
import { ADVISORY_LOCK_IDS, withAdvisoryLock } from "./advisory-lock";

export const getDb = (env: Env) => new SQL(env.DATABASE_URL);

export const isDbUp = async (db: SQL) => {
  try {
    const [{alive}] = await db`SELECT 1 as "alive"`;
    return alive === 1;
  } catch (error) {
    console.error("Error checking database status:", error);
    return false;
  }
};

const waitForDb = async (db: SQL) => {
  const startTime = Date.now();
  while (!await isDbUp(db)) {
    console.log(`Waiting for database to be up... ${Date.now() - startTime}ms`);
    if (Date.now() - startTime > 10000) {
      throw new Error("Database is not up after 10 seconds");
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log(`Database is up after ${Date.now() - startTime}ms`);
};


export const runMigrations = async (db: SQL) => {
  await waitForDb(db);
  await withAdvisoryLock(db, ADVISORY_LOCK_IDS.MIGRATIONS, async () => {
    // const [{migrations}] = await db`SELECT 1 as "migrations"`;
    // return migrations === 1;
  });
};