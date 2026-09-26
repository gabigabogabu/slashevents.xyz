import type { Pg } from '@/db/init';
import type { SQL } from '@/db/types';
import {
  EventType,
  type EventsChangedNotification,
  type WebhookEventData,
} from '@/services/events/types';

import type { UUID } from 'crypto';

// Base event row from DB
type EventDbRow = {
  id: UUID;
  project_id: UUID;
  type: EventType;
  data: Record<string, unknown>;
  received_at: string;
};

type EventWithCursor = EventDbRow & {
  cursor: string;
};

const parseEventData = (value: Record<string, unknown> | string): Record<string, unknown> =>
  typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value;

export const eventsChangedChannel = (projectId: UUID): string =>
  `slashevents_events_${projectId.replaceAll('-', '')}`;

type EventsChangedListener = (payload: string) => void;
type UnsubscribeEventsChanged = () => Promise<void>;

export type SubscribeToEventsChanged = (
  pg: Pg,
  projectId: UUID,
  listener: EventsChangedListener,
) => Promise<UnsubscribeEventsChanged>;

export const subscribeToEventsChanged: SubscribeToEventsChanged = async (pg, projectId, listener) => {
  const subscription = await pg.listen(eventsChangedChannel(projectId), listener);
  return () => subscription.unlisten();
};

const notifyEventInserted = async (
  db: SQL,
  params: EventsChangedNotification & { projectId: UUID },
): Promise<void> => {
  const channel = eventsChangedChannel(params.projectId);
  const payload = JSON.stringify({ type: params.type });
  await db`SELECT pg_notify(${channel}, ${payload})`;
};

// ============ Insert Events ============

export const insertWebhookEvent = async (
  db: SQL,
  params: {
    project_id: UUID;
    data: WebhookEventData;
    receivedAt?: Date
  },
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
    event_type: EventType;
    metadata?: Record<string, unknown>;
  },
): Promise<UUID | undefined> => {
  const data = {
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
  params: { project_id: UUID; type?: EventType; limit?: number; cursor?: string },
): Promise<EventWithCursor[]> => {
  const limit = params.limit ?? 50;
  const typeFilter = params.type ? db`AND e.type = ${params.type}` : db``;
  const cursorFilter = params.cursor ? db`AND (EXTRACT(EPOCH FROM e.received_at)::TEXT || e.id::TEXT) > ${params.cursor}` : db``;
  const rows = await db`
    SELECT 
      e.id, e.project_id, e.type, e.data, e.received_at,
      EXTRACT(EPOCH FROM e.received_at)::TEXT || e.id::TEXT as cursor
    FROM events e
    WHERE e.project_id = ${params.project_id}
      ${typeFilter}
      ${cursorFilter}
    ORDER BY cursor ASC
    LIMIT ${limit};
  ` as (EventWithCursor & { data: Record<string, unknown> | string })[];
  return rows.map((row) => ({ ...row, data: parseEventData(row.data) }));
};

export const countEvents = async (
  db: SQL,
  params: { project_id: UUID; type?: EventType },
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

export const deleteEvents = async (
  db: SQL,
  params: { ids: UUID[]; project_id: UUID },
): Promise<boolean> => {
  const res = await db`
    DELETE FROM events
    WHERE id = ANY(${db.array(params.ids, 'UUID')})
      AND project_id = ${params.project_id}
    RETURNING id;
  ` as { id: UUID }[];
  return res.length > 0;
};

export const projectExists = async (
  db: SQL,
  params: { project_id: UUID },
): Promise<boolean> => {
  const res = await db`
    SELECT 1 FROM projects WHERE id = ${params.project_id} LIMIT 1;
  ` as { '?column?': number }[];
  return res.length > 0;
};

export const deleteEventsPastRetentionDuration = async (
  db: SQL,
  params: { after_id?: UUID; limit: number },
): Promise<{ removed: number; nextCursor?: UUID }> => {
  const cursorFilter = params.after_id ? db`AND e.id > ${params.after_id}` : db``;
  const res = await db`
    WITH expired_events AS (
      SELECT e.id
      FROM events e
      INNER JOIN projects p ON p.id = e.project_id
      WHERE p.retention_duration_seconds IS NOT NULL
        AND e.received_at < NOW() - (p.retention_duration_seconds * INTERVAL '1 second')
        ${cursorFilter}
      ORDER BY e.id ASC
      LIMIT ${params.limit}
    ),
    deleted_events AS (
      DELETE FROM events e
      USING expired_events expired
      WHERE e.id = expired.id
      RETURNING e.id
    )
    SELECT expired.id
    FROM expired_events expired
    INNER JOIN deleted_events deleted ON deleted.id = expired.id
    ORDER BY expired.id ASC;
  ` as { id: UUID }[];
  return { removed: res.length, nextCursor: res[res.length - 1]?.id };
};

export const deleteEventsPastRetentionMaxCount = async (
  db: SQL,
  params: { after_project_id?: UUID; project_limit: number; event_limit_per_project: number },
): Promise<{ removed: number; scannedProjects: number; nextProjectCursor?: UUID }> => {
  const cursorFilter = params.after_project_id ? db`AND p.id > ${params.after_project_id}` : db``;
  const res = await db`
    WITH project_page AS (
      SELECT p.id, p.retention_max_events
      FROM projects p
      WHERE p.retention_max_events IS NOT NULL
        ${cursorFilter}
      ORDER BY p.id ASC
      LIMIT ${params.project_limit}
    ),
    deletable_events AS (
      SELECT candidate.id
      FROM project_page p
      CROSS JOIN LATERAL (
        SELECT retained.id
        FROM events retained
        WHERE retained.project_id = p.id
        ORDER BY retained.id DESC
        OFFSET (p.retention_max_events - 1)
        LIMIT 1
      ) cutoff
      CROSS JOIN LATERAL (
        SELECT e.id
        FROM events e
        WHERE e.project_id = p.id
          AND e.id < cutoff.id
        ORDER BY e.id ASC
        LIMIT ${params.event_limit_per_project}
      ) candidate
    ),
    deleted_events AS (
      DELETE FROM events e
      USING deletable_events deletable
      WHERE e.id = deletable.id
      RETURNING e.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM project_page) AS scanned_projects,
      (SELECT id FROM project_page ORDER BY id DESC LIMIT 1) AS next_project_cursor,
      (SELECT COUNT(*)::int FROM deleted_events) AS removed;
  ` as { removed: number; scanned_projects: number; next_project_cursor: UUID | null }[];
  const row = res[0];
  return {
    removed: row?.removed ?? 0,
    scannedProjects: row?.scanned_projects ?? 0,
    nextProjectCursor: row?.next_project_cursor ?? undefined,
  };
};
