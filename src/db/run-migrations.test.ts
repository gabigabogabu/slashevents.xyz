import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { getLog } from '@/log';

import { runMigrations } from './run-migrations';
import { getTestDb, resetTestDb } from './test-setup';

const log = getLog();
log.level = 'silent';

describe('migration lifecycle', () => {
  const first = getTestDb();
  const second = getTestDb();
  beforeAll(async () => { await resetTestDb(first); });
  afterAll(async () => { await Promise.all([first.close(), second.close()]); });

  test('serializes concurrent starts and preserves existing events on restart', async () => {
    await Promise.all([runMigrations(first, log).migrationPromise, runMigrations(second, log).migrationPromise]);
    const [project] = await first`INSERT INTO app.projects (name) VALUES ('migration persistence') RETURNING id`;
    await first`INSERT INTO app.events (project_id, type, data) VALUES (${project.id}, 'WEBHOOK_RECEIVED', '{"hello":"world"}')`;
    await runMigrations(second, log).migrationPromise;
    const [row] = await second`SELECT count(*)::int AS count FROM app.events WHERE project_id = ${project.id}`;
    expect(row.count).toBe(1);
    const tables = await first`SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY table_name`;
    expect(tables.map((table: { table_name: string }) => table.table_name)).toEqual(['events', 'projects']);
  });

  test('rejects migration history containing an unknown migration', async () => {
    await first`INSERT INTO migrations.migrations (name) VALUES ('209901010000-unknown-migration')`;
    try {
      await expect(runMigrations(first, log).migrationPromise).rejects.toThrow('unsupported migration history');
    } finally {
      await first`DELETE FROM migrations.migrations WHERE name = '209901010000-unknown-migration'`;
    }
  });
});
