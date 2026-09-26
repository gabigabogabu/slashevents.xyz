import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { getTestDb, resetTestDb } from '@/db/test-setup';
import type { SQL } from '@/db/types';
import { EventType, HttpMethod, type WebhookEventData } from '@/services/events/types';

import {
  countEvents,
  deleteEventsPastRetentionDuration,
  deleteEventsPastRetentionMaxCount,
  getEvents,
  insertWebhookEvent,
} from './event';
import { insertProject, updateProjectRetentionConfig } from './project';

import type { UUID } from 'crypto';

const webhookData = (path: string): WebhookEventData => ({
  httpMethod: HttpMethod.POST,
  path,
  headers: {},
  body: null,
  queryString: null,
  sourceIp: null,
  sourcePort: null,
});

describe('event queries', () => {
  let db: SQL;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);
  });

  afterAll(async () => {
    await db.end();
  });

  test('deletes events older than the project retention duration', async () => {
    const projectId = await insertProject(db, {
      name: 'Duration retention',
    }) as UUID;
    await updateProjectRetentionConfig(db, {
      project_id: projectId,
      retention_duration_seconds: 60,
      retention_max_events: null,
    });

    await insertWebhookEvent(db, {
      project_id: projectId,
      data: webhookData('/old-1'),
      receivedAt: new Date(Date.now() - 180_000),
    });
    await insertWebhookEvent(db, {
      project_id: projectId,
      data: webhookData('/old-2'),
      receivedAt: new Date(Date.now() - 120_000),
    });
    await insertWebhookEvent(db, {
      project_id: projectId,
      data: webhookData('/fresh'),
      receivedAt: new Date(),
    });

    const firstPage = await deleteEventsPastRetentionDuration(db, { limit: 1 });
    expect(firstPage.removed).toBe(1);
    expect(firstPage.nextCursor).toBeDefined();
    if (!firstPage.nextCursor) throw new Error('Expected duration retention cursor');

    const secondPage = await deleteEventsPastRetentionDuration(db, {
      after_id: firstPage.nextCursor,
      limit: 1,
    });
    expect(secondPage.removed).toBe(1);
    if (!secondPage.nextCursor) throw new Error('Expected duration retention cursor');

    const thirdPage = await deleteEventsPastRetentionDuration(db, {
      after_id: secondPage.nextCursor,
      limit: 1,
    });
    expect(thirdPage.removed).toBe(0);
    expect(await countEvents(db, { project_id: projectId })).toBe(1);

    const kept = await getEvents(db, {
      project_id: projectId,
      type: EventType.WEBHOOK_RECEIVED,
      limit: 10,
    });
    expect(kept.map((event) => (event.data as WebhookEventData).path)).toEqual(['/fresh']);
  });

  test('deletes events beyond the project retention max count', async () => {
    const projectId = await insertProject(db, {
      name: 'Count retention',
    }) as UUID;
    const secondProjectId = await insertProject(db, {
      name: 'Second count retention',
    }) as UUID;
    await updateProjectRetentionConfig(db, {
      project_id: projectId,
      retention_duration_seconds: null,
      retention_max_events: 2,
    });
    await updateProjectRetentionConfig(db, {
      project_id: secondProjectId,
      retention_duration_seconds: null,
      retention_max_events: 1,
    });

    const baseTime = Date.now() - 10_000;
    for (const index of [0, 1, 2, 3]) {
      await insertWebhookEvent(db, {
        project_id: projectId,
        data: webhookData(`/count-${index}`),
        receivedAt: new Date(baseTime + index * 1000),
      });
    }
    for (const index of [0, 1]) {
      await insertWebhookEvent(db, {
        project_id: secondProjectId,
        data: webhookData(`/second-count-${index}`),
        receivedAt: new Date(baseTime + index * 1000),
      });
    }

    const firstPage = await deleteEventsPastRetentionMaxCount(db, {
      project_limit: 1,
      event_limit_per_project: 1,
    });
    expect(firstPage.removed).toBe(1);
    expect(firstPage.scannedProjects).toBe(1);
    expect(firstPage.nextProjectCursor).toBeDefined();
    if (!firstPage.nextProjectCursor) throw new Error('Expected max-count project cursor');

    const secondPage = await deleteEventsPastRetentionMaxCount(db, {
      after_project_id: firstPage.nextProjectCursor,
      project_limit: 1,
      event_limit_per_project: 10,
    });
    expect(secondPage.scannedProjects).toBe(1);

    const nextRun = await deleteEventsPastRetentionMaxCount(db, {
      project_limit: 10,
      event_limit_per_project: 10,
    });
    expect(firstPage.removed + secondPage.removed + nextRun.removed).toBe(3);

    expect(await countEvents(db, { project_id: projectId })).toBe(2);
    expect(await countEvents(db, { project_id: secondProjectId })).toBe(1);

    const kept = await getEvents(db, {
      project_id: projectId,
      type: EventType.WEBHOOK_RECEIVED,
      limit: 10,
    });
    expect(kept.map((event) => (event.data as WebhookEventData).path)).toEqual(['/count-2', '/count-3']);

    const secondProjectKept = await getEvents(db, {
      project_id: secondProjectId,
      type: EventType.WEBHOOK_RECEIVED,
      limit: 10,
    });
    expect(secondProjectKept.map((event) => (event.data as WebhookEventData).path)).toEqual(['/second-count-1']);
  });
});
