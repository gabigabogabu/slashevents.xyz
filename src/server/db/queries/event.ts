import type { SQL } from "bun";
import type { UUID } from "crypto";

// All event types use dot-separated naming
export enum EventType {
  WEBHOOK_RECEIVED = "webhook.received",
  PROJECT_CREATED = "project.created",
  PROJECT_USER_ADDED = "project.user.added",
  PROJECT_USER_REMOVED = "project.user.removed",
  PROJECT_USER_PERMISSION_GRANTED = "project.user.permission.granted",
  PROJECT_USER_PERMISSION_REVOKED = "project.user.permission.revoked",
}

// Helper to check if an event type is a project activity type
export const isProjectActivityEvent = (type: EventType): boolean => {
  return type.startsWith("project.");
};

export const isWebhookEvent = (type: EventType): boolean => {
  return type.startsWith("webhook.");
};

export enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  PATCH = "PATCH",
  DELETE = "DELETE",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS",
}

// Base event row from DB
type EventDbRow = {
  id: UUID;
  project_id: UUID;
  type: EventType;
  data: Record<string, unknown>;
  received_at: string;
};

// Typed webhook data
export type WebhookEventData = {
  httpMethod: HttpMethod;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  queryString: string | null;
  sourceIp: string | null;
  sourcePort: number | null;
};

export type ProjectActivityEventData = {
  actorUserId: string;
  targetUserId?: string;
  targetEmail?: string;
  permission?: string;
  permissions?: string[];
  removedPermissions?: string[];
  name?: string;
};

type EventWithActorEmail = EventDbRow & {
  actor_email?: string;
};

// Typed event types
export type WebhookEventRow = Omit<EventDbRow, "data" | "type"> & { type: EventType.WEBHOOK_RECEIVED; data: WebhookEventData };
export type ProjectActivityEventRow = Omit<EventDbRow, "data"> & { data: ProjectActivityEventData; actor_email: string };

// ============ Insert Events ============

export const insertWebhookEvent = async (
  db: SQL,
  params: {
    project_id: UUID;
    data: WebhookEventData;
  }
): Promise<UUID | undefined> => {
  const res = await db`
    INSERT INTO events (project_id, type, data)
    VALUES (${params.project_id}, 'webhook.received', ${params.data})
    RETURNING id;
  ` as { id: UUID }[];
  return res[0]?.id;
};

export const insertProjectActivityEvent = async (
  db: SQL,
  params: {
    project_id: UUID;
    actor_user_id: UUID;
    event_type: EventType;
    metadata?: Record<string, unknown>;
  }
): Promise<UUID | undefined> => {
  const data = {
    actorUserId: params.actor_user_id,
    ...params.metadata,
  };
  const res = await db`
    INSERT INTO events (project_id, type, data)
    VALUES (${params.project_id}, ${params.event_type}, ${data})
    RETURNING id;
  ` as { id: UUID }[];
  return res[0]?.id;
};

// ============ Query Events ============

// Project activity event types for internal use
const PROJECT_ACTIVITY_TYPES = [
  EventType.PROJECT_CREATED,
  EventType.PROJECT_USER_ADDED,
  EventType.PROJECT_USER_REMOVED,
  EventType.PROJECT_USER_PERMISSION_GRANTED,
  EventType.PROJECT_USER_PERMISSION_REVOKED,
] as const;

export const getEvents = async (
  db: SQL,
  params: { project_id: UUID; type?: EventType; limit?: number; cursor?: UUID }
): Promise<EventWithActorEmail[]> => {
  const limit = params.limit ?? 50;

  // Specific event type filter
  if (params.type) {
    const needsActorEmail = isProjectActivityEvent(params.type);
    if (needsActorEmail) {
      if (params.cursor) {
        return await db`
          SELECT 
            e.id, e.project_id, e.type, e.data, e.received_at,
            u.email as actor_email
          FROM events e
          LEFT JOIN users u ON (e.data->>'actorUserId')::uuid = u.id
          WHERE e.project_id = ${params.project_id}
            AND e.type = ${params.type}
            AND e.received_at < (SELECT received_at FROM events WHERE id = ${params.cursor})
          ORDER BY e.received_at DESC
          LIMIT ${limit};
        ` as EventWithActorEmail[];
      }
      return await db`
        SELECT 
          e.id, e.project_id, e.type, e.data, e.received_at,
          u.email as actor_email
        FROM events e
        LEFT JOIN users u ON (e.data->>'actorUserId')::uuid = u.id
        WHERE e.project_id = ${params.project_id}
          AND e.type = ${params.type}
        ORDER BY e.received_at DESC
        LIMIT ${limit};
      ` as EventWithActorEmail[];
    }
    // Webhook event
    if (params.cursor) {
      return await db`
        SELECT id, project_id, type, data, received_at
        FROM events
        WHERE project_id = ${params.project_id}
          AND type = ${params.type}
          AND received_at < (SELECT received_at FROM events WHERE id = ${params.cursor})
        ORDER BY received_at DESC
        LIMIT ${limit};
      ` as EventDbRow[];
    }
    return await db`
      SELECT id, project_id, type, data, received_at
      FROM events
      WHERE project_id = ${params.project_id}
        AND type = ${params.type}
      ORDER BY received_at DESC
      LIMIT ${limit};
    ` as EventDbRow[];
  }

  // No type filter - return all events with optional actor_email
  if (params.cursor) {
    return await db`
      SELECT 
        e.id, e.project_id, e.type, e.data, e.received_at,
        u.email as actor_email
      FROM events e
      LEFT JOIN users u ON e.type IN ${db(PROJECT_ACTIVITY_TYPES)} AND (e.data->>'actorUserId')::uuid = u.id
      WHERE e.project_id = ${params.project_id}
        AND e.received_at < (SELECT received_at FROM events WHERE id = ${params.cursor})
      ORDER BY e.received_at DESC
      LIMIT ${limit};
    ` as EventWithActorEmail[];
  }
  return await db`
    SELECT 
      e.id, e.project_id, e.type, e.data, e.received_at,
      u.email as actor_email
    FROM events e
    LEFT JOIN users u ON e.type IN ${db(PROJECT_ACTIVITY_TYPES)} AND (e.data->>'actorUserId')::uuid = u.id
    WHERE e.project_id = ${params.project_id}
    ORDER BY e.received_at DESC
    LIMIT ${limit};
  ` as EventWithActorEmail[];
};

export const getEventCount = async (
  db: SQL,
  params: { project_id: UUID; type?: EventType }
): Promise<number> => {
  if (params.type) {
    const res = await db`
      SELECT COUNT(*) as count FROM events 
      WHERE project_id = ${params.project_id} AND type = ${params.type};
    ` as { count: string }[];
    return parseInt(res[0]?.count ?? "0", 10);
  }
  const res = await db`
    SELECT COUNT(*) as count FROM events WHERE project_id = ${params.project_id};
  ` as { count: string }[];
  return parseInt(res[0]?.count ?? "0", 10);
};

// ============ Convenience Wrappers ============

export const getWebhookEvents = async (
  db: SQL,
  params: { project_id: UUID; limit?: number; cursor?: UUID }
): Promise<WebhookEventRow[]> => {
  const events = await getEvents(db, { ...params, type: EventType.WEBHOOK_RECEIVED });
  return events as unknown as WebhookEventRow[];
};

export const getProjectActivityEvents = async (
  db: SQL,
  params: { project_id: UUID; limit?: number; cursor?: UUID }
): Promise<ProjectActivityEventRow[]> => {
  // Get all project activity event types
  const events: EventWithActorEmail[] = [];
  for (const eventType of PROJECT_ACTIVITY_TYPES) {
    const typeEvents = await getEvents(db, { ...params, type: eventType });
    events.push(...typeEvents);
  }
  // Sort by received_at descending and limit
  events.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
  return events.slice(0, params.limit ?? 50) as unknown as ProjectActivityEventRow[];
};

export const getProjectActivityEventCount = async (
  db: SQL,
  params: { project_id: UUID }
): Promise<number> => {
  let count = 0;
  for (const eventType of PROJECT_ACTIVITY_TYPES) {
    count += await getEventCount(db, { ...params, type: eventType });
  }
  return count;
};

// ============ Other Operations ============

export const getEventById = async (
  db: SQL,
  params: { id: UUID }
): Promise<EventDbRow | undefined> => {
  const res = await db`
    SELECT id, project_id, type, data, received_at
    FROM events
    WHERE id = ${params.id};
  ` as EventDbRow[];
  return res[0];
};

export const deleteEvent = async (
  db: SQL,
  params: { id: UUID }
): Promise<boolean> => {
  const res = await db`
    DELETE FROM events WHERE id = ${params.id} RETURNING id;
  ` as { id: UUID }[];
  return res.length > 0;
};

export const projectExists = async (
  db: SQL,
  params: { project_id: UUID }
): Promise<boolean> => {
  const res = await db`
    SELECT 1 FROM projects WHERE id = ${params.project_id} LIMIT 1;
  ` as { "?column?": number }[];
  return res.length > 0;
};
