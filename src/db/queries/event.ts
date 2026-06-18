import type { SQL } from "@/db/types";
import type { UUID } from "crypto";
import { EventType } from "@/lib/event-types";
import type { EventsCursor } from "@/services/events/events-cursor";

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
  targetDisplayName?: string;
  permission?: string;
  permissions?: string[];
  removedPermissions?: string[];
  name?: string;
};

type EventWithCursorAndActorName = EventDbRow & {
  cursor: string;
  actor_name: string | null;
};

export const eventsChangedChannel = (projectId: UUID): string =>
  `slashevents_events_${projectId.replaceAll("-", "")}`;

export type EventsChangedNotification = {
  type: EventType;
};

type EventsChangedListener = (payload: string) => void;
const localEventsChangedListeners = new Map<string, Set<EventsChangedListener>>();

// Bun.SQL has no LISTEN callback API; pg_notify remains for external listeners,
// while this wakes long-polls served by the same process that inserted the event.
export const subscribeToEventsChanged = (
  projectId: UUID,
  listener: EventsChangedListener,
): (() => void) => {
  const channel = eventsChangedChannel(projectId);
  const listeners = localEventsChangedListeners.get(channel) ?? new Set<EventsChangedListener>();
  listeners.add(listener);
  localEventsChangedListeners.set(channel, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) localEventsChangedListeners.delete(channel);
  };
};

const dispatchLocalEventsChanged = (channel: string, payload: string): void => {
  for (const listener of localEventsChangedListeners.get(channel) ?? []) {
    listener(payload);
  }
};

const notifyEventInserted = async (
  db: SQL,
  params: EventsChangedNotification & { projectId: UUID },
): Promise<void> => {
  const channel = eventsChangedChannel(params.projectId);
  const payload = JSON.stringify({ type: params.type });
  await db`SELECT pg_notify(${channel}, ${payload})`;
  dispatchLocalEventsChanged(channel, payload);
};

// ============ Insert Events ============

export const insertWebhookEvent = async (
  db: SQL,
  params: {
    project_id: UUID;
    data: WebhookEventData;
    receivedAt?: Date
  }
): Promise<UUID | undefined> => {
  const receivedAtValue = params.receivedAt ? db`${params.receivedAt}` : db`NOW()`;
  const res = await db`
    INSERT INTO events (project_id, type, data, received_at)
    VALUES (${params.project_id}, ${EventType.WEBHOOK_RECEIVED}, ${JSON.stringify(params.data)}::jsonb, ${receivedAtValue})
    RETURNING id;
  ` as { id: UUID }[];
  const id = res[0]?.id;
  if (id) {
    await notifyEventInserted(db, {
      projectId: params.project_id,
      type: EventType.WEBHOOK_RECEIVED,
    });
  }
  return id;
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
    VALUES (${params.project_id}, ${params.event_type}, ${JSON.stringify(data)}::jsonb)
    RETURNING id;
  ` as { id: UUID }[];
  const id = res[0]?.id;
  if (id) {
    await notifyEventInserted(db, {
      projectId: params.project_id,
      type: params.event_type,
    });
  }
  return id;
};

// ============ Query Events ============

export const getEvents = async (
  db: SQL,
  params: { project_id: UUID; type?: EventType; limit?: number; cursor?: EventsCursor }
): Promise<EventWithCursorAndActorName[]> => {
  const limit = params.limit ?? 50;
  const typeFilter = params.type ? db`AND e.type = ${params.type}` : db``;
  const cursorFilter = params.cursor ? db`AND (EXTRACT(EPOCH FROM e.received_at)::TEXT || e.id::TEXT) > ${params.cursor.c}` : db``;
  return await db`
    SELECT 
      e.id, e.project_id, e.type, e.data, e.received_at,
      u.display_name as actor_name,
      EXTRACT(EPOCH FROM e.received_at)::TEXT || e.id::TEXT as cursor
    FROM events e
    LEFT JOIN users u ON (e.data->>'actorUserId')::uuid = u.id
    WHERE e.project_id = ${params.project_id}
      ${typeFilter}
      ${cursorFilter}
    ORDER BY cursor ASC
    LIMIT ${limit};
  ` as EventWithCursorAndActorName[];
};

export const countEvents = async (
  db: SQL,
  params: { project_id: UUID; type?: EventType }
): Promise<number> => {
  const typeFilter = params.type ? db`AND type = ${params.type}` : db``;
  const res = await db`
    SELECT COUNT(*)::int as count
    FROM events
    WHERE project_id = ${params.project_id}
      ${typeFilter};
  ` as { count: number }[];
  return res[0]?.count ?? 0;
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
