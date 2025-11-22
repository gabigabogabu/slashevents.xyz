import type { SQL } from "bun";
import { ADVISORY_LOCK_IDS, withAdvisoryLock } from "./advisory-lock";
import { readdir } from "node:fs/promises";
import sortBy from "lodash/sortBy";

export enum MigrationStatus {
  PENDING,
  RUNNING,
  COMPLETED,
}

export const runMigrations = (db: SQL) => {
  let migrationsStatus: MigrationStatus = MigrationStatus.PENDING;

  const getMigrationsStatus = async () => {
    return migrationsStatus;
  };

  const migrationPromise = withAdvisoryLock(db, ADVISORY_LOCK_IDS.MIGRATIONS, async () => {
    console.log("Running migrations");
    migrationsStatus = MigrationStatus.RUNNING;
    // const [{migrations}] = await db`SELECT 1 as "migrations"`;
    // return migrations === 1;
    await db`CREATE SCHEMA IF NOT EXISTS migrations`;
    await db`CREATE TABLE IF NOT EXISTS migrations.migrations (
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`;
    const alreadyAppliedMigrations = (await db`SELECT name FROM migrations.migrations` as { name: string }[]).map(migration => migration.name);
    const migrationFileNames = await readdir("src/server/db/migrations");
    const migrationNames = migrationFileNames.map(fileName => fileName.replace(".ts", "").replace(".js", ""));
    const migrationsToRun = sortBy(migrationNames.filter(name => !alreadyAppliedMigrations.includes(name)));
    const missingMigrations = alreadyAppliedMigrations.filter(appliedMigration => !migrationNames.includes(appliedMigration));
    console.dir({ alreadyAppliedMigrations, migrationNames, migrationsToRun, missingMigrations });
    for (const migrationName of migrationsToRun) {
      console.log(`Running migration: ${migrationName}`);
      const migrationFn = (await import(`./migrations/${migrationName}`)).default;
      await migrationFn(db);
      await db`INSERT INTO migrations.migrations (name) VALUES (${migrationName})`;
      console.log(`Migration ${migrationName} completed`);
    }

    migrationsStatus = MigrationStatus.COMPLETED;
    console.log("Migrations completed");
  });

  return {
    getMigrationsStatus,
    migrationPromise,
  }
};