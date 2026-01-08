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

export const getEvents = async (
  db: SQL,
  params: { project_id: UUID; type?: EventType; limit?: number; cursor?: UUID }
): Promise<EventWithActorEmail[]> => {
  const limit = params.limit ?? 50;

  const typeFilter = params.type ? db`AND e.type = ${params.type}` : db``;
  const cursorFilter = params.cursor ? db`AND e.received_at < (SELECT received_at FROM events WHERE id = ${params.cursor})` : db``;
  
  return await db`
    SELECT 
      e.id, e.project_id, e.type, e.data, e.received_at,
      u.email as actor_email
    FROM events e
    LEFT JOIN users u ON (e.data->>'actorUserId')::uuid = u.id
    WHERE e.project_id = ${params.project_id}
      ${typeFilter}
      ${cursorFilter}
    ORDER BY e.received_at DESC
    LIMIT ${limit};
  ` as EventWithActorEmail[];
};

export const getEventCount = async (
  db: SQL,
  params: { project_id: UUID; type?: EventType }
): Promise<number> => {
  const typeFilter = params.type ? db`AND type = ${params.type}` : db``;
  const res = await db`
    SELECT COUNT(*) as count FROM events 
    WHERE project_id = ${params.project_id} ${typeFilter};
  ` as { count: string }[];
  return parseInt(res[0]?.count ?? "0", 10);
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
