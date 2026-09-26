import { readdir } from 'node:fs/promises';

import sortBy from 'lodash/sortBy';

import type { SQL } from '@/db/types';
import { type Log } from '@/log';

import { ADVISORY_LOCK_IDS, withAdvisoryLock } from './advisory-lock';

export enum MigrationStatus {
  PENDING,
  RUNNING,
  COMPLETED,
}

export const runMigrations = (db: SQL, log: Log) => {
  let migrationsStatus: MigrationStatus = MigrationStatus.PENDING;

  const getMigrationsStatus = async () => {
    return migrationsStatus;
  };

  const migrationPromise = withAdvisoryLock(db, ADVISORY_LOCK_IDS.MIGRATIONS, async (connection) => {
    log.info('Running migrations');
    migrationsStatus = MigrationStatus.RUNNING;
    await connection`CREATE SCHEMA IF NOT EXISTS migrations`;
    await connection`CREATE TABLE IF NOT EXISTS migrations.migrations (
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`;
    const alreadyAppliedMigrations = (await connection`SELECT name FROM migrations.migrations` as { name: string }[]).map(migration => migration.name);
    const migrationFileNames = (await readdir(new URL('./migrations', import.meta.url))).filter((name) => /\.(ts|js)$/.test(name));
    const migrationNames = migrationFileNames.map(fileName => fileName.replace('.ts', '').replace('.js', ''));
    const migrationFileByName = new Map(migrationFileNames.map((fileName) => [
      fileName.replace('.ts', '').replace('.js', ''),
      fileName,
    ]));
    const migrationsToRun = sortBy(migrationNames.filter(name => !alreadyAppliedMigrations.includes(name)));
    const missingMigrations = alreadyAppliedMigrations.filter(appliedMigration => !migrationNames.includes(appliedMigration));
    log.info({ alreadyAppliedMigrations, migrationNames, migrationsToRun, missingMigrations }, 'Migration status');
    if (missingMigrations.length > 0)
      throw new Error('Database has an unsupported migration history. Use an image version compatible with this database, or restore a matching backup into an empty database.');
    for (const migrationName of migrationsToRun) {
      log.info({ migrationName }, `Running migration: ${migrationName}`);
      const migrationFileName = migrationFileByName.get(migrationName);
      if (!migrationFileName) throw new Error(`Migration file not found: ${migrationName}`);
      const migrationFn = (await import(`./migrations/${migrationFileName}`)).default;
      await connection.begin(async (tx) => {
        await migrationFn(tx);
        await tx`INSERT INTO migrations.migrations (name) VALUES (${migrationName})`;
      });
      log.info({ migrationName }, `Migration ${migrationName} completed`);
    }

    migrationsStatus = MigrationStatus.COMPLETED;
    log.info('Migrations completed');
  });

  return {
    getMigrationsStatus,
    migrationPromise,
  }
};
