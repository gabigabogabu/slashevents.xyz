import { afterAll, beforeAll, describe, test } from "bun:test";

import { expect } from "@/test-expect";
import type { SQL } from "@/db/types";
import type { UUID } from "crypto";

import { getTestDb, resetTestDb } from "@/db/test-setup";
import * as queries from "@/db/queries";
import { handleIngress, getEvents, getEventsLongPoll, removeEvent } from "./events";
import { HttpMethod } from "@/db/queries/event";
import { EventType } from "@/lib/event-types";
import { ProjectPermission } from "@/lib/project-permissions";
import { ErrorCode } from "@/lib/errors";

describe("events service", () => {
  let db: SQL;
  let testUserId: UUID;
  let testProjectId: UUID;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);

    // Create test user
    const displayName = `test-${Date.now()}`;
    testUserId = (await queries.insertUser(db, {
      display_name: displayName,
    })) as UUID;

    // Create test project
    testProjectId = (await queries.insertProject(db, {
      name: `Test Project ${Date.now()}`,
      created_by_user_id: testUserId,
    })) as UUID;
  });

  afterAll(async () => {
    await db.end();
  });

  describe("handleIngress", () => {
    test("stores a webhook event successfully", async () => {
      const result = await handleIngress({
        projectId: testProjectId,
        path: "/webhook/test",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"hello": "world"}',
        queryString: "foo=bar",
        sourceIp: "192.168.1.1",
        sourcePort: 54321,
      }, { db });

      expect(result).toHaveProperty("eventId");
      expect("error" in result).toBe(false);

      // Verify the event was stored
      const events = await queries.getEvents(db, { project_id: testProjectId, type: EventType.WEBHOOK_RECEIVED });
      expect(events.length).toBeGreaterThanOrEqual(1);
      const event = events.find(e => (e.data as any).path === "/webhook/test");
      expect(event).toBeDefined();
      const data = event!.data as any;
      expect(data.httpMethod).toBe(HttpMethod.POST);
      expect(data.body).toBe('{"hello": "world"}');
      expect(data.queryString).toBe("foo=bar");
      expect(data.sourceIp).toBe("192.168.1.1");
      expect(data.headers).toEqual({ "content-type": "application/json" });
    });

    test("returns error for non-existent project", async () => {
      const fakeProjectId = "00000000-0000-0000-0000-000000000000" as UUID;

      const result = await handleIngress({
        projectId: fakeProjectId,
        path: "/webhook/test",
        method: "POST",
        headers: {},
        body: null,
        queryString: null,
        sourceIp: null,
        sourcePort: null,
      }, { db });

      expect(result).toEqual({ error: "PROJECT_NOT_FOUND", status: 404 });
    });

    test("returns error for unsupported HTTP method", async () => {
      const result = await handleIngress({
        projectId: testProjectId,
        path: "/webhook/test",
        method: "INVALID",
        headers: {},
        body: null,
        queryString: null,
        sourceIp: null,
        sourcePort: null,
      }, { db });

      expect(result).toEqual({ error: "UNSUPPORTED_METHOD", status: 405 });
    });

    test("stores GET request without body", async () => {
      const result = await handleIngress({
        projectId: testProjectId,
        path: "/api/status",
        method: "GET",
        headers: { "accept": "application/json" },
        body: null,
        queryString: "page=1&limit=10",
        sourceIp: "10.0.0.1",
        sourcePort: 12345,
      }, { db });

      expect(result).toHaveProperty("eventId");

      const events = await queries.getEvents(db, { project_id: testProjectId, type: EventType.WEBHOOK_RECEIVED });
      const event = events.find(e => (e.data as queries.WebhookEventData).path === "/api/status");
      expect(event).toBeDefined();
      const data = event!.data as any;
      expect(data.httpMethod).toBe(HttpMethod.GET);
      expect(data.body).toBeNull();
    });
  });

  describe("getEvents", () => {
    test("returns events with pagination", async () => {
      // Create a fresh project for pagination test
      const paginationProjectId = (await queries.insertProject(db, {
        name: `Pagination Test ${Date.now()}`,
        created_by_user_id: testUserId,
      })) as UUID;

      // Create multiple events
      const now = +new Date()
      for (let i = 0; i < 5; i++) {
        await handleIngress({
          projectId: paginationProjectId,
          path: `/webhook/pagination-${i}`,
          method: "POST",
          headers: {},
          body: null,
          queryString: null,
          sourceIp: null,
          sourcePort: null,
          receivedAt: new Date(now + i)
        }, { db });
      }

      // Get first page (only webhook events)
      const firstPage = await getEvents({ projectId: paginationProjectId, type: EventType.WEBHOOK_RECEIVED, limit: 3 }, { db });
      expect(firstPage.events.length).toBe(3);
      expect(firstPage.nextCursor).toBeTruthy();
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.events.map(e => (e.data as queries.WebhookEventData).path)).toEqual([0, 1, 2].map(i => `/webhook/pagination-${i}`));

      // Get second page using cursor
      const lastEvent = firstPage.events[2];
      expect(lastEvent).toBeDefined();
      const secondPage = await getEvents({
        projectId: paginationProjectId,
        type: EventType.WEBHOOK_RECEIVED,
        limit: 3,
        cursor: firstPage.nextCursor as string,
      }, { db });
      expect(secondPage.events.length).toBe(2);
      expect(secondPage.nextCursor).toBeNull();
      expect(secondPage.hasMore).toBe(false);
      expect(secondPage.events.map(e => (e.data as queries.WebhookEventData).path)).toEqual([3, 4].map(i => `/webhook/pagination-${i}`));
    });

    test("can paginate events all with same receivedAt", async () => {
      const projectId = (await queries.insertProject(db, {
        name: `Pagination Test ${Date.now()}`,
        created_by_user_id: testUserId,
      })) as UUID;
      
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        await handleIngress({
          projectId,
          path: `/webhook/pagination-${i}`,
          method: "POST",
          headers: {},
          body: null,
          queryString: null,
          sourceIp: null,
          sourcePort: null,
          receivedAt: now
        }, { db });
      }

      const firstPage = await getEvents({ projectId, limit: 3, type: EventType.WEBHOOK_RECEIVED }, { db });
      expect(firstPage.events.length).toBe(3);
      expect(firstPage.nextCursor).toBeTruthy();
      expect(firstPage.hasMore).toBe(true);

      const secondPage = await getEvents({ projectId, limit: 3, type: EventType.WEBHOOK_RECEIVED, cursor: firstPage.nextCursor as string }, { db });
      expect(secondPage.events.length).toBe(2);
      expect(secondPage.nextCursor).toBeNull();
      expect(secondPage.hasMore).toBe(false);

      const firstPagePaths = firstPage.events.map(e => (e.data as queries.WebhookEventData).path);
      const secondPagePaths = secondPage.events.map(e => (e.data as queries.WebhookEventData).path);
      expect(firstPagePaths).not.toContain(secondPagePaths);
      expect(secondPagePaths).not.toContain(firstPagePaths);
    });

    test("returns webhook event", async () => {
      const webhookEventProjectId = (await queries.insertProject(db, {
        name: `Webhook Event Project ${Date.now()}`,
        created_by_user_id: testUserId,
      })) as UUID;

      const result = await handleIngress({
        projectId: webhookEventProjectId,
        path: "/webhook/test",
        method: "POST",
        headers: { 'x-test-header': 'testvalue' },
        body: '{"test": "testbody"}',
        queryString: 'foo=bar',
        sourceIp: '192.168.1.1',
        sourcePort: 12345,
      }, { db });

      expect(result).toHaveProperty("eventId");
      expect("error" in result).toBe(false);

      const events = await getEvents({ projectId: webhookEventProjectId, limit: 1, type: EventType.WEBHOOK_RECEIVED }, { db });
      expect(events.events.length).toBe(1);
      expect(events).toEqual({
        hasMore: false,
        nextCursor: null,
        events: [
          {
            actorName: null,
            id: expect.any(String),
            projectId: expect.any(String),
            type: EventType.WEBHOOK_RECEIVED,
            data: {
              httpMethod: HttpMethod.POST,
              path: "/webhook/test",
              headers: { 'x-test-header': 'testvalue' },
              body: '{"test": "testbody"}',
              queryString: 'foo=bar',
              sourceIp: '192.168.1.1',
              sourcePort: 12345,
            },
            receivedAt: expect.any(String),
          }
        ]
      });
    });

    test("returns empty array for project with no events", async () => {
      // Create a fresh project with no events
      const emptyProjectId = (await queries.insertProject(db, {
        name: `Empty Project ${Date.now()}`,
        created_by_user_id: testUserId,
      })) as UUID;

      const result = await getEvents({ projectId: emptyProjectId, limit: 2 }, { db });
      expect(result.events).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    test("filters events by type", async () => {
      // Create a fresh project
      const filterProjectId = (await queries.insertProject(db, {
        name: `Filter Test ${Date.now()}`,
        created_by_user_id: testUserId,
      })) as UUID;

      // Create a webhook event
      await handleIngress({
        projectId: filterProjectId,
        path: "/webhook/filter-test",
        method: "POST",
        headers: {},
        body: null,
        queryString: null,
        sourceIp: null,
        sourcePort: null,
      }, { db });

      // Create a project activity event
      await queries.insertProjectActivityEvent(db, {
        project_id: filterProjectId,
        actor_user_id: testUserId,
        event_type: EventType.PROJECT_CREATED,
        metadata: { name: "Filter Test" },
      });

      // Get all events
      const allEvents = await getEvents({ projectId: filterProjectId, limit: 2 }, { db });
      expect(allEvents.events.length).toBe(2);

      // Get only webhook events
      const webhookEvents = await getEvents({ projectId: filterProjectId, type: EventType.WEBHOOK_RECEIVED, limit: 2 }, { db });
      expect(webhookEvents.events.length).toBe(1);
      expect(webhookEvents.events[0]?.type).toBe(EventType.WEBHOOK_RECEIVED);

      // Get only project.created events
      const activityEvents = await getEvents({ projectId: filterProjectId, type: EventType.PROJECT_CREATED, limit: 2 }, { db });
      expect(activityEvents.events.length).toBe(1);
      expect(activityEvents.events[0]?.type).toBe(EventType.PROJECT_CREATED);
    });

    describe("getEventsLongPoll", () => {
      test("long-polls when empty and returns once an event is written", async () => {
        const projectId = (await queries.insertProject(db, {
          name: `Long Poll Test ${Date.now()}`,
          created_by_user_id: testUserId,
        })) as UUID;

        const startMs = Date.now();
        const pollPromise = getEventsLongPoll(
          {
            projectId,
            type: EventType.WEBHOOK_RECEIVED,
            limit: 10,
            longPollDurationSeconds: 2,
          },
          { db }
        );

        // Insert an event shortly after starting the long-poll.
        setTimeout(() => {
          void handleIngress({
            projectId,
            path: "/webhook/long-poll",
            method: "POST",
            headers: {},
            body: null,
            queryString: null,
            sourceIp: null,
            sourcePort: null,
          }, { db });
        }, 100);

        const result = await pollPromise;
        const elapsedMs = Date.now() - startMs;

        expect(result.events.length).toBeGreaterThanOrEqual(1);
        expect(elapsedMs).toBeLessThanOrEqual(2500);
      });

      test("does not wait when longPollDurationSeconds is 0", async () => {
        const projectId = (await queries.insertProject(db, {
          name: `No Wait Test ${Date.now()}`,
          created_by_user_id: testUserId,
        })) as UUID;

        const result = await getEventsLongPoll(
          {
            projectId,
            type: EventType.WEBHOOK_RECEIVED,
            limit: 10,
            longPollDurationSeconds: 0,
          },
          { db }
        );

        expect(result.events).toEqual([]);
      });

      test("does not wait when longPollDurationSeconds is not set", async () => {
        const projectId = (await queries.insertProject(db, {
          name: `No Wait Test ${Date.now()}`,
          created_by_user_id: testUserId,
        })) as UUID;

        const result = await getEventsLongPoll(
          {
            projectId,
            type: EventType.WEBHOOK_RECEIVED,
            limit: 10,
          }, { db }
        );
        expect(result.events).toEqual([]);
      });

      test("waits for the specified duration with no events", async () => {
        const projectId = (await queries.insertProject(db, {
          name: `No Wait Test ${Date.now()}`,
          created_by_user_id: testUserId,
        })) as UUID;

        const startMs = Date.now();
        const result = await getEventsLongPoll(
          {
            projectId,
            type: EventType.WEBHOOK_RECEIVED,
            limit: 10,
            longPollDurationSeconds: 2,
          }, { db }
        );
        const elapsedMs = Date.now() - startMs;

        expect(elapsedMs).toBeGreaterThanOrEqual(2000);
        expect(result.events).toEqual([]);
      });
    });
  });

  describe("removeEvent", () => {
    const createProject = async (name: string, grantManage = false): Promise<UUID> => {
      const projectId = (await queries.insertProject(db, {
        name: `${name} ${Date.now()}`,
        created_by_user_id: testUserId,
      })) as UUID;
      if (grantManage) {
        await queries.allowProjectUserPermission(db, {
          project_id: projectId,
          user_id: testUserId,
          permission: ProjectPermission.PROJECT_MANAGE_USERS,
        });
      }
      return projectId;
    };

    const createWebhookEvent = async (projectId: UUID, path: string): Promise<UUID> => {
      const ingressResult = await handleIngress({
        projectId,
        path,
        method: "POST",
        headers: {},
        body: null,
        queryString: null,
        sourceIp: null,
        sourcePort: null,
      }, { db });
      if ("error" in ingressResult) throw new Error(ingressResult.error);
      return ingressResult.eventId;
    };

    test("removes an event for a project manager", async () => {
      const projectId = await createProject("Remove Event Test", true);
      const eventId = await createWebhookEvent(projectId, "/webhook/remove-me");
      await removeEvent({
        projectId,
        eventId,
        actorUserId: testUserId,
      }, { db });

      const events = await getEvents({ projectId, limit: 10 }, { db });
      expect(events.events.some((event) => event.id === eventId)).toBe(false);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      const projectId = await createProject("Remove Event No Access");
      const eventId = await createWebhookEvent(projectId, "/webhook/keep-me");

      await expect(
        removeEvent({
          projectId,
          eventId,
          actorUserId: testUserId,
        }, { db })
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });

    test("does not remove an event from a different project", async () => {
      const managedProjectId = await createProject("Managed Remove Event", true);
      const eventProjectId = await createProject("Other Remove Event");
      const eventId = await createWebhookEvent(eventProjectId, "/webhook/other-project");

      await expect(
        removeEvent({
          projectId: managedProjectId,
          eventId,
          actorUserId: testUserId,
        }, { db })
      ).rejects.toThrow(ErrorCode.NOT_FOUND);

      const events = await getEvents({ projectId: eventProjectId, limit: 10 }, { db });
      expect(events.events.some((event) => event.id === eventId)).toBe(true);
    });
  });
});
