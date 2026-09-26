import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import * as queries from '@/db/queries';
import { getTestDb, resetTestDb } from '@/db/test-setup';
import type { SQL } from '@/db/types';
import { ErrorCode } from '@/errors';
import { getLog } from '@/log';
import { EventType } from '@/services/events/types';

import * as projects from './project';

import type { UUID } from 'node:crypto';

const log = getLog();
log.level = 'silent';
const missingId = '01900000-0000-7000-8000-000000000000' as UUID;

describe('instance projects', () => {
  let db: SQL;
  const di = () => ({ db, queries, log });
  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);
  });
  afterAll(async () => { await db.close(); });

  test('creates a project and its activity atomically', async () => {
    const { projectId } = await projects.createProject({ name: 'Hooks' }, di());
    const { project } = await projects.getProject({ projectId }, di());
    expect(project.name).toBe('Hooks');
    expect(project.webhookPathAllowlist).toEqual([]);
    expect(project.retentionConfig).toEqual({ durationSeconds: null, maxEvents: null });
    const events = await queries.getEvents(db, { project_id: projectId });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(EventType.PROJECT_CREATED);
    expect(events[0]?.data).toEqual({ name: 'Hooks' });
  });

  test('rolls back project creation if its activity cannot be stored', async () => {
    const before = await projects.getProjects({}, di());
    await expect(projects.createProject({ name: 'Rollback' }, {
      ...di(),
      queries: { ...queries, insertProjectActivityEvent: async () => { throw new Error('storage failed'); } },
    })).rejects.toThrow('storage failed');
    expect(await projects.getProjects({}, di())).toEqual(before);
  });

  test('lists every project and paginates without overlap', async () => {
    const first = await projects.createProject({ name: 'First' }, di());
    const second = await projects.createProject({ name: 'Second' }, di());
    const page = await projects.getProjects({ limit: 1 }, di());
    expect(page.projects.map((project) => project.id)).toEqual([second.projectId]);
    expect(page.nextCursor).toBeDefined();
    const next = await projects.getProjects({ limit: 1, cursor: page.nextCursor }, di());
    expect(next.projects.map((project) => project.id)).toEqual([first.projectId]);
  });

  test('updates and reads path allowlists', async () => {
    const { projectId } = await projects.createProject({ name: 'Paths' }, di());
    await projects.setProjectWebhookPathAllowlist({ projectId, paths: ['/hooks', '/accounts/[^/]+/events'] }, di());
    expect(await projects.getProjectWebhookPathAllowlist({ projectId }, di())).toEqual({
      webhookPathAllowlist: ['/hooks', '/accounts/[^/]+/events'],
    });
  });

  test('updates retention and allows disabling both limits', async () => {
    const { projectId } = await projects.createProject({ name: 'Retention' }, di());
    const retentionConfig = { durationSeconds: 3600, maxEvents: 100 };
    await projects.setProjectRetentionConfig({ projectId, retentionConfig }, di());
    expect(await projects.getProjectRetentionConfig({ projectId }, di())).toEqual({ retentionConfig });
    expect((await projects.getProject({ projectId }, di())).project.retentionConfig).toEqual(retentionConfig);
    const disabled = { durationSeconds: null, maxEvents: null };
    await projects.setProjectRetentionConfig({ projectId, retentionConfig: disabled }, di());
    expect(await projects.getProjectRetentionConfig({ projectId }, di())).toEqual({ retentionConfig: disabled });
  });

  test('reports missing projects consistently', async () => {
    await expect(projects.getProject({ projectId: missingId }, di())).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    await expect(projects.getProjectWebhookPathAllowlist({ projectId: missingId }, di())).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    await expect(projects.setProjectWebhookPathAllowlist({ projectId: missingId, paths: [] }, di())).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    await expect(projects.getProjectRetentionConfig({ projectId: missingId }, di())).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    await expect(projects.setProjectRetentionConfig({ projectId: missingId, retentionConfig: { durationSeconds: null, maxEvents: null } }, di())).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
  });
});
