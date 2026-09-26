import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { getTestDb, resetTestDb } from '@/db/test-setup';
import type { SQL } from '@/db/types';

import { getProjectById, getProjects, insertProject, updateProjectRetentionConfig, updateProjectWebhookPathAllowlist } from './project';

import type { UUID } from 'node:crypto';

describe('project queries', () => {
  let db: SQL;
  beforeAll(async () => { db = getTestDb(); await resetTestDb(db); });
  afterAll(async () => { await db.close(); });

  test('creates projects with schema defaults', async () => {
    const id = await insertProject(db, { name: 'Independent project' }) as UUID;
    const project = await getProjectById(db, { id });
    expect(project?.webhook_path_allowlist).toEqual([]);
    expect(project?.retention_duration_seconds).toBeNull();
    expect(project?.retention_max_events).toBeNull();
    expect(project).toMatchObject({ id, name: 'Independent project' });
  });

  test('lists all projects in descending order with an exclusive cursor', async () => {
    const first = await insertProject(db, { name: 'One' }) as UUID;
    const second = await insertProject(db, { name: 'Two' }) as UUID;
    expect((await getProjects(db, { limit: 1 }))[0]?.id).toBe(second);
    expect((await getProjects(db, { limit: 1, before_id: second }))[0]?.id).toBe(first);
  });

  test('persists retention and allowed paths', async () => {
    const id = await insertProject(db, { name: 'Configuration' }) as UUID;
    expect(await updateProjectWebhookPathAllowlist(db, { project_id: id, webhook_path_allowlist: ['/hooks'] })).toBe(true);
    expect(await updateProjectRetentionConfig(db, { project_id: id, retention_duration_seconds: 60, retention_max_events: 100 })).toBe(true);
    expect(await getProjectById(db, { id })).toMatchObject({
      webhook_path_allowlist: ['/hooks'], retention_duration_seconds: 60, retention_max_events: 100,
    });
  });
});
