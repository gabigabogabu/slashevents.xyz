import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { SQL } from "bun";
import type { UUID } from "crypto";

import { getTestDb, resetTestDb } from "@/server/db/test-setup";
import * as queries from "@/server/db/queries";
import { handleIngress, getEvents } from "./events";
import { HttpMethod, EventType } from "@/server/db/queries/event";

describe("events service", () => {
  let db: SQL;
  let testUserId: UUID;
  let testProjectId: UUID;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);

    // Create test user
    const email = `test-${Date.now()}@example.com`;
    testUserId = (await queries.insertUser(db, {
      email,
      password_hash: "testhash",
      password_salt: "testsalt",
    })) as UUID;

    // Create test project
    testProjectId = (await queries.insertProject(db, {
      name: `Test Project ${Date.now()}`,
      created_by_user_id: testUserId,
    })) as UUID;
  });

  afterAll(async () => {
    await db.close();
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
      const events = await queries.getWebhookEvents(db, { project_id: testProjectId });
      expect(events.length).toBeGreaterThanOrEqual(1);
      const event = events.find(e => e.data.path === "/webhook/test");
      expect(event).toBeDefined();
      expect(event!.data.httpMethod).toBe(HttpMethod.POST);
      expect(event!.data.body).toBe('{"hello": "world"}');
      expect(event!.data.queryString).toBe("foo=bar");
      expect(event!.data.sourceIp).toBe("192.168.1.1");
      expect(event!.data.headers).toEqual({ "content-type": "application/json" });
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

      const events = await queries.getWebhookEvents(db, { project_id: testProjectId });
      const event = events.find(e => e.data.path === "/api/status");
      expect(event).toBeDefined();
      expect(event!.data.httpMethod).toBe(HttpMethod.GET);
      expect(event!.data.body).toBeNull();
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
        }, { db });
      }

      // Get first page (only webhook events)
      const firstPage = await getEvents({ projectId: paginationProjectId, type: EventType.WEBHOOK_RECEIVED, limit: 3 }, { db });
      expect(firstPage.events.length).toBe(3);
      expect(firstPage.total).toBe(5);

      // Get second page using cursor
      const lastEvent = firstPage.events[2];
      expect(lastEvent).toBeDefined();
      const secondPage = await getEvents({ 
        projectId: paginationProjectId,
        type: EventType.WEBHOOK_RECEIVED,
        limit: 3, 
        cursor: lastEvent!.id 
      }, { db });
      expect(secondPage.events.length).toBe(2);
      expect(secondPage.total).toBe(5);
    });

    test("returns empty array for project with no events", async () => {
      // Create a fresh project with no events
      const emptyProjectId = (await queries.insertProject(db, {
        name: `Empty Project ${Date.now()}`,
        created_by_user_id: testUserId,
      })) as UUID;

      const result = await getEvents({ projectId: emptyProjectId }, { db });
      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
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
      const allEvents = await getEvents({ projectId: filterProjectId }, { db });
      expect(allEvents.events.length).toBe(2);

      // Get only webhook events
      const webhookEvents = await getEvents({ projectId: filterProjectId, type: EventType.WEBHOOK_RECEIVED }, { db });
      expect(webhookEvents.events.length).toBe(1);
      expect(webhookEvents.events[0]?.type).toBe(EventType.WEBHOOK_RECEIVED);

      // Get only project.created events
      const activityEvents = await getEvents({ projectId: filterProjectId, type: EventType.PROJECT_CREATED }, { db });
      expect(activityEvents.events.length).toBe(1);
      expect(activityEvents.events[0]?.type).toBe(EventType.PROJECT_CREATED);
    });
  });
});
