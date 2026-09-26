import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { getPg, type Pg } from '@/db/init';
import * as queries from '@/db/queries';
import { TEST_DB_URL, getTestDb, resetTestDb } from '@/db/test-setup';
import type { SQL } from '@/db/types';
import { ErrorCode } from '@/errors';
import { getLog } from '@/log';

import { getEvents, getEventsLongPoll, handleIngress, removeEvent } from './events';
import { EventType, HttpMethod, type WebhookEventData } from './types';

import type { UUID } from 'crypto';

const testEnv = { DATABASE_URL: TEST_DB_URL };
const testLog = getLog();
testLog.level = 'silent';

describe('events service', () => {
  let db: SQL;
  let pg: Pg;
  let closePg: () => Promise<void>;
  let testProjectId: UUID;

  const eventDi = () => ({ db, pg, queries, log: testLog });

  const createTestProject = async (name: string): Promise<UUID> =>
    (await queries.insertProject(db, { name })) as UUID;

  beforeAll(async () => {
    db = getTestDb();
    ({ pg, closePg } = getPg(testEnv, testLog));
    await resetTestDb(db);

    testProjectId = await createTestProject('Test Project');
  });

  afterAll(async () => {
    await closePg();
    await db.end();
  });

  describe('handleIngress', () => {
    test('stores a webhook event successfully', async () => {
      const result = await handleIngress({
        projectId: testProjectId,
        path: '/webhook/test',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"hello": "world"}',
        queryString: 'foo=bar',
        sourceIp: '192.168.1.1',
        sourcePort: 54321,
      }, eventDi());

      expect(result).toHaveProperty('eventId');
      expect('error' in result).toBe(false);

      // Verify the event was stored
      const events = await queries.getEvents(db, { project_id: testProjectId, type: EventType.WEBHOOK_RECEIVED });
      expect(events.length).toBeGreaterThanOrEqual(1);
      const event = events.find(e => (e.data as any).path === '/webhook/test');
      expect(event).toBeDefined();
      const data = event!.data as any;
      expect(data.httpMethod).toBe(HttpMethod.POST);
      expect(data.body).toBe('{"hello": "world"}');
      expect(data.queryString).toBe('foo=bar');
      expect(data.sourceIp).toBe('192.168.1.1');
      expect(data.headers).toEqual({ 'content-type': 'application/json' });
    });

    test('returns error for non-existent project', async () => {
      const fakeProjectId = '00000000-0000-0000-0000-000000000000' as UUID;

      const result = await handleIngress({
        projectId: fakeProjectId,
        path: '/webhook/test',
        method: 'POST',
        headers: {},
        body: null,
        queryString: null,
        sourceIp: null,
        sourcePort: null,
      }, eventDi());

      expect(result).toEqual({ error: 'PROJECT_NOT_FOUND', status: 404 });
    });

    test('returns error for unsupported HTTP method', async () => {
      const result = await handleIngress({
        projectId: testProjectId,
        path: '/webhook/test',
        method: 'INVALID',
        headers: {},
        body: null,
        queryString: null,
        sourceIp: null,
        sourcePort: null,
      }, eventDi());

      expect(result).toEqual({ error: 'UNSUPPORTED_METHOD', status: 405 });
    });

    test('stores GET request without body', async () => {
      const result = await handleIngress({
        projectId: testProjectId,
        path: '/api/status',
        method: 'GET',
        headers: { 'accept': 'application/json' },
        body: null,
        queryString: 'page=1&limit=10',
        sourceIp: '10.0.0.1',
        sourcePort: 12345,
      }, eventDi());

      expect(result).toHaveProperty('eventId');

      const events = await queries.getEvents(db, { project_id: testProjectId, type: EventType.WEBHOOK_RECEIVED });
      const event = events.find(e => (e.data as WebhookEventData).path === '/api/status');
      expect(event).toBeDefined();
      const data = event!.data as any;
      expect(data.httpMethod).toBe(HttpMethod.GET);
      expect(data.body).toBeNull();
    });


  });

  describe('getEvents', () => {
    test('returns events with pagination', async () => {
      // Create a fresh project for pagination test
      const paginationProjectId = await createTestProject('Pagination Test');

      // Create multiple events
      const now = +new Date()
      for (let i = 0; i < 5; i++) {
        await handleIngress({
          projectId: paginationProjectId,
          path: `/webhook/pagination-${i}`,
          method: 'POST',
          headers: {},
          body: null,
          queryString: null,
          sourceIp: null,
          sourcePort: null,
          receivedAt: new Date(now + i),
        }, eventDi());
      }

      // Get first page (only webhook events)
      const firstPage = await getEvents({ projectId: paginationProjectId, type: EventType.WEBHOOK_RECEIVED, limit: 3 }, eventDi());
      expect(firstPage.events.length).toBe(3);
      expect(firstPage.nextCursor).toBeTruthy();
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.events.map(e => (e.data as WebhookEventData).path)).toEqual([0, 1, 2].map(i => `/webhook/pagination-${i}`));

      // Get second page using cursor
      const lastEvent = firstPage.events[2];
      expect(lastEvent).toBeDefined();
      const secondPage = await getEvents({
        projectId: paginationProjectId,
        type: EventType.WEBHOOK_RECEIVED,
        limit: 3,
        cursor: firstPage.nextCursor as string,
      }, eventDi());
      expect(secondPage.events.length).toBe(2);
      expect(secondPage.nextCursor).toBeNull();
      expect(secondPage.hasMore).toBe(false);
      expect(secondPage.events.map(e => (e.data as WebhookEventData).path)).toEqual([3, 4].map(i => `/webhook/pagination-${i}`));
    });

    test('can paginate events all with same receivedAt', async () => {
      const projectId = await createTestProject('Pagination Test');
      
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        await handleIngress({
          projectId,
          path: `/webhook/pagination-${i}`,
          method: 'POST',
          headers: {},
          body: null,
          queryString: null,
          sourceIp: null,
          sourcePort: null,
          receivedAt: now,
        }, eventDi());
      }

      const firstPage = await getEvents({ projectId, limit: 3, type: EventType.WEBHOOK_RECEIVED }, eventDi());
      expect(firstPage.events.length).toBe(3);
      expect(firstPage.nextCursor).toBeTruthy();
      expect(firstPage.hasMore).toBe(true);

      const secondPage = await getEvents({ projectId, limit: 3, type: EventType.WEBHOOK_RECEIVED, cursor: firstPage.nextCursor as string }, eventDi());
      expect(secondPage.events.length).toBe(2);
      expect(secondPage.nextCursor).toBeNull();
      expect(secondPage.hasMore).toBe(false);

      const firstPagePaths = firstPage.events.map(e => (e.data as WebhookEventData).path);
      const secondPagePaths = secondPage.events.map(e => (e.data as WebhookEventData).path);
      expect(firstPagePaths).not.toContain(secondPagePaths);
      expect(secondPagePaths).not.toContain(firstPagePaths);
    });

    test('returns webhook event', async () => {
      const webhookEventProjectId = await createTestProject('Webhook Event Project');

      const result = await handleIngress({
        projectId: webhookEventProjectId,
        path: '/webhook/test',
        method: 'POST',
        headers: { 'x-test-header': 'testvalue' },
        body: '{"test": "testbody"}',
        queryString: 'foo=bar',
        sourceIp: '192.168.1.1',
        sourcePort: 12345,
      }, eventDi());

      expect(result).toHaveProperty('eventId');
      expect('error' in result).toBe(false);

      const events = await getEvents({ projectId: webhookEventProjectId, limit: 1, type: EventType.WEBHOOK_RECEIVED }, eventDi());
      expect(events.events.length).toBe(1);
      expect(events).toEqual({
        hasMore: false,
        nextCursor: null,
        events: [
          {

            id: expect.any(String),
            projectId: expect.any(String),
            type: EventType.WEBHOOK_RECEIVED,
            data: {
              httpMethod: HttpMethod.POST,
              path: '/webhook/test',
              headers: { 'x-test-header': 'testvalue' },
              body: '{"test": "testbody"}',
              queryString: 'foo=bar',
              sourceIp: '192.168.1.1',
              sourcePort: 12345,
            },
            receivedAt: expect.any(String),
          },
        ],
      });
    });

    test('returns empty array for project with no events', async () => {
      // Create a fresh project with no events
      const emptyProjectId = await createTestProject('Empty Project');

      const result = await getEvents({ projectId: emptyProjectId, limit: 2 }, eventDi());
      expect(result.events).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    test('filters events by type', async () => {
      // Create a fresh project
      const filterProjectId = await createTestProject('Filter Test');

      // Create a webhook event
      await handleIngress({
        projectId: filterProjectId,
        path: '/webhook/filter-test',
        method: 'POST',
        headers: {},
        body: null,
        queryString: null,
        sourceIp: null,
        sourcePort: null,
      }, eventDi());

      // Create a project activity event
      await queries.insertProjectActivityEvent(db, {
        project_id: filterProjectId,

        event_type: EventType.PROJECT_CREATED,
        metadata: { name: 'Filter Test' },
      });

      // Get all events
      const allEvents = await getEvents({ projectId: filterProjectId, limit: 2 }, eventDi());
      expect(allEvents.events.length).toBe(2);

      // Get only webhook events
      const webhookEvents = await getEvents({ projectId: filterProjectId, type: EventType.WEBHOOK_RECEIVED, limit: 2 }, eventDi());
      expect(webhookEvents.events.length).toBe(1);
      expect(webhookEvents.events[0]?.type).toBe(EventType.WEBHOOK_RECEIVED);

      // Get only project.created events
      const activityEvents = await getEvents({ projectId: filterProjectId, type: EventType.PROJECT_CREATED, limit: 2 }, eventDi());
      expect(activityEvents.events.length).toBe(1);
      expect(activityEvents.events[0]?.type).toBe(EventType.PROJECT_CREATED);
    });

    describe('getEventsLongPoll', () => {
      test('long-polls when empty and returns once an event is written', async () => {
        const projectId = await createTestProject('Long Poll Test');

        const startMs = Date.now();
        const pollPromise = getEventsLongPoll(
          {
            projectId,
            type: EventType.WEBHOOK_RECEIVED,
            limit: 10,
            longPollDurationSeconds: 2,
          },
          eventDi(),
        );

        // Insert an event shortly after starting the long-poll.
        setTimeout(() => {
          void handleIngress({
            projectId,
            path: '/webhook/long-poll',
            method: 'POST',
            headers: {},
            body: null,
            queryString: null,
            sourceIp: null,
            sourcePort: null,
          }, eventDi());
        }, 100);

        const result = await pollPromise;
        const elapsedMs = Date.now() - startMs;

        expect(result.events.length).toBeGreaterThanOrEqual(1);
        expect(elapsedMs).toBeLessThanOrEqual(2500);
      });

      test('does not wait when longPollDurationSeconds is 0', async () => {
        const projectId = await createTestProject('No Wait Test');

        const result = await getEventsLongPoll(
          {
            projectId,
            type: EventType.WEBHOOK_RECEIVED,
            limit: 10,
            longPollDurationSeconds: 0,
          },
          eventDi(),
        );

        expect(result.events).toEqual([]);
      });

      test('does not wait when longPollDurationSeconds is not set', async () => {
        const projectId = await createTestProject('No Wait Test');

        const result = await getEventsLongPoll(
          {
            projectId,
            type: EventType.WEBHOOK_RECEIVED,
            limit: 10,
          }, eventDi(),
        );
        expect(result.events).toEqual([]);
      });

      test('waits for the specified duration with no events', async () => {
        const projectId = await createTestProject('No Wait Test');

        const startMs = Date.now();
        const result = await getEventsLongPoll(
          {
            projectId,
            type: EventType.WEBHOOK_RECEIVED,
            limit: 10,
            longPollDurationSeconds: 2,
          }, eventDi(),
        );
        const elapsedMs = Date.now() - startMs;

        expect(elapsedMs).toBeGreaterThanOrEqual(2000);
        expect(result.events).toEqual([]);
      });

      test('aborts while waiting for events', async () => {
        const projectId = await createTestProject('Abort Long Poll Test');
        const controller = new AbortController();

        const pollPromise = getEventsLongPoll(
          {
            projectId,
            type: EventType.WEBHOOK_RECEIVED,
            limit: 10,
            longPollDurationSeconds: 2,
          },
          { ...eventDi(), signal: controller.signal },
        );
        controller.abort(new DOMException('stop poll', 'AbortError'));

        await expect(pollPromise).rejects.toMatchObject({ name: 'AbortError' });
      });
    });
  });

  describe('removeEvent', () => {
    const createProject = createTestProject;

    const createWebhookEvent = async (projectId: UUID, path: string): Promise<UUID> => {
      const ingressResult = await handleIngress({
        projectId,
        path,
        method: 'POST',
        headers: {},
        body: null,
        queryString: null,
        sourceIp: null,
        sourcePort: null,
      }, eventDi());
      if ('error' in ingressResult) throw new Error(ingressResult.error);
      return ingressResult.eventId;
    };

    test('removes an event', async () => {
      const projectId = await createProject('Remove Event Test');
      const eventId = await createWebhookEvent(projectId, '/webhook/remove-me');
      await removeEvent({
        projectId,
        eventId,

      }, eventDi());

      const events = await getEvents({ projectId, limit: 10 }, eventDi());
      expect(events.events.some((event) => event.id === eventId)).toBe(false);
    });


    test('does not remove an event from a different project', async () => {
      const managedProjectId = await createProject('Managed Remove Event');
      const eventProjectId = await createProject('Other Remove Event');
      const eventId = await createWebhookEvent(eventProjectId, '/webhook/other-project');

      await expect(
        removeEvent({
          projectId: managedProjectId,
          eventId,

        }, eventDi()),
      ).rejects.toThrow(ErrorCode.NOT_FOUND);

      const events = await getEvents({ projectId: eventProjectId, limit: 10 }, eventDi());
      expect(events.events.some((event) => event.id === eventId)).toBe(true);
    });
  });
});
