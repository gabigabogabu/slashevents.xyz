import type { Pg } from '@/db/init';
import type * as dbQueries from '@/db/queries';
import type { SQL } from '@/db/types';
import { AppError, ErrorCode } from '@/errors';
import { timestampToIsoString } from '@/lib/timestamps';
import type { Log } from '@/log';

import { decodeEventsCursor, encodeEventsCursor } from './events-cursor';
import {
  EventType,
  type EventsChangedNotification,
  HttpMethod,
  type ProjectActivityEventData,
  type WebhookEventData,
} from './types';

import type { UUID } from 'crypto';

const retentionDurationDeletePageSize = 1_000;
const retentionDurationDeleteMaxPagesPerRun = 10;
const retentionMaxCountProjectPageSize = 100;
const retentionMaxCountDeleteLimitPerProject = 1_000;

const HTTP_METHOD_MAP: Record<string, HttpMethod | undefined> = {
  GET: HttpMethod.GET,
  POST: HttpMethod.POST,
  PUT: HttpMethod.PUT,
  PATCH: HttpMethod.PATCH,
  DELETE: HttpMethod.DELETE,
  HEAD: HttpMethod.HEAD,
  OPTIONS: HttpMethod.OPTIONS,
};

type IngressParams = {
  projectId: UUID;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  queryString: string | null;
  sourceIp: string | null;
  sourcePort: number | null;
  receivedAt?: Date
};

type EventDi = {
  db: SQL;
  queries: typeof dbQueries;
  log: Log;
  signal?: AbortSignal;
};

type LongPollEventDi = EventDi & { pg: Pg };

export const handleIngress = async (
  params: IngressParams,
  di: EventDi,
): Promise<{ eventId: UUID } | { error: string; status: number }> => {
  const { db, queries } = di;
  const { projectId, path, method, headers, body, queryString, sourceIp, sourcePort, receivedAt } = params;

  // Validate HTTP method
  const httpMethod = HTTP_METHOD_MAP[method.toUpperCase()];
  if (!httpMethod)
    return { error: 'UNSUPPORTED_METHOD', status: 405 };

  return await db.begin('read write', async (tx) => {
    if (!await queries.projectExists(tx, { project_id: projectId }))
      return { error: 'PROJECT_NOT_FOUND', status: 404 };

    const eventId = await queries.insertWebhookEvent(tx, {
      project_id: projectId,
      data: {
        httpMethod,
        path,
        headers,
        body,
        queryString,
        sourceIp,
        sourcePort,
      },
      receivedAt,
    });

    if (!eventId)
      return { error: 'FAILED_TO_STORE_EVENT', status: 500 };

    return { eventId };
  });
};

export type EventDto = {
  id: UUID;
  projectId: UUID;
  type: EventType;
  data: WebhookEventData | ProjectActivityEventData;
  receivedAt: string;
};

export type GetEventsResult = {
  events: EventDto[];
  nextCursor: string | null;
  hasMore: boolean;
};

export const getEvents = async (
  params: { projectId: UUID; limit: number; type?: EventType; cursor?: string },
  { db, queries }: EventDi,
): Promise<GetEventsResult> => {
  const decodedCursor = params.cursor
    ? decodeEventsCursor(params.cursor)
    : undefined;

  const events = await queries.getEvents(db, {
    project_id: params.projectId,
    type: params.type,
    limit: params.limit + 1,
    cursor: decodedCursor?.c,
  });

  const limitedEvents = events.slice(0, params.limit);
  
  const mapped: EventDto[] = limitedEvents.map((e) => ({
    id: e.id,
    projectId: e.project_id,
    type: e.type,
    data: e.data as WebhookEventData | ProjectActivityEventData,
    receivedAt: timestampToIsoString(e.received_at),
  }));

  const hasMore = events.length > params.limit;
  const lastEvent = limitedEvents[limitedEvents.length - 1];
  const nextCursor = lastEvent && hasMore
    ? encodeEventsCursor({ c: lastEvent.cursor })
    : null;
  return { events: mapped, nextCursor, hasMore };
};

const eventTypes = new Set<string>(Object.values(EventType));

const parseEventsChangedNotification = (payload: string): EventsChangedNotification | null => {
  try {
    const parsed = JSON.parse(payload) as Partial<EventsChangedNotification>;
    if (typeof parsed.type !== 'string' || !eventTypes.has(parsed.type)) return null;
    return {
      type: parsed.type as EventType,
    };
  } catch {
    return null;
  }
};

const notificationMatches = (
  notification: EventsChangedNotification,
  params: { type?: EventType },
): boolean =>
  !params.type || notification.type === params.type;

export const getEventsLongPoll = async (
  params: {
    projectId: UUID;
    limit: number;
    type?: EventType;
    cursor?: string;
    longPollDurationSeconds?: number;
  },
  { db, pg, queries, log, signal }: LongPollEventDi,
): Promise<GetEventsResult> => {
  signal?.throwIfAborted();
  const maxWaitMs = Math.max(0, Math.floor((params.longPollDurationSeconds ?? 0) * 1000));
  if (maxWaitMs <= 0) return getEvents(params, { db, queries, log });

  const deadline = Date.now() + maxWaitMs;
  let pendingNotification = false;
  let wake: (() => void) | null = null;
  const unsubscribe = await queries.subscribeToEventsChanged(
    pg,
    params.projectId,
    (payload) => {
      const notification = parseEventsChangedNotification(payload);
      if (!notification || !notificationMatches(notification, params)) return;
      pendingNotification = true;
      wake?.();
    },
  );

  const waitForNotificationOrDeadline = (remainingMs: number): Promise<void> =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        timeout = null;
        signal?.removeEventListener('abort', onAbort);
        wake = null;
      };
      const onAbort = () => {
        cleanup();
        reject(signal?.reason ?? new DOMException('Operation aborted', 'AbortError'));
      };

      timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, remainingMs);

      signal?.addEventListener('abort', onAbort, { once: true });

      wake = () => {
        cleanup();
        resolve();
      };
    });

  try {
    let result = await getEvents(params, { db, queries, log });
    if (result.events.length > 0) return result;

    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (!pendingNotification) {
        const remainingMs = Math.max(0, deadline - Date.now());
        if (remainingMs <= 0) break;
        await waitForNotificationOrDeadline(remainingMs);
      }

      if (!pendingNotification) break;
      pendingNotification = false;
      result = await getEvents(params, { db, queries, log });
      if (result.events.length > 0) return result;
    }

    return getEvents(params, { db, queries, log });
  } finally {
    await unsubscribe();
  }
};

export const removeEvent = async (
  params: { projectId: UUID; eventId: UUID },
  { db, queries }: EventDi,
): Promise<void> => {
  if (!await queries.projectExists(db, { project_id: params.projectId }))
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  const removed = await queries.deleteEvents(db, {
    ids: [params.eventId],
    project_id: params.projectId,
  });
  if (!removed)
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'Event not found');
};

export const removeEventsPastRetentionDuration = async (
  { db, queries, log, signal }: EventDi,
): Promise<void> => {
  let removed = 0;
  let durationCursor: UUID | undefined;

  log.info({
    maxPages: retentionDurationDeleteMaxPagesPerRun,
    pageSize: retentionDurationDeletePageSize,
  }, 'Starting retention duration cleanup');

  for (let page = 0; page < retentionDurationDeleteMaxPagesPerRun; page++) {
    if (signal?.aborted) {
      log.info({ removed }, 'Retention duration cleanup stopped');
      return;
    }
    const pageLog = log.child({
      afterId: durationCursor,
      page: page + 1,
    });
    pageLog.info('Deleting events past retention duration');
    const result = await queries.deleteEventsPastRetentionDuration(db, {
      after_id: durationCursor,
      limit: retentionDurationDeletePageSize,
    });
    removed += result.removed;
    pageLog.info({
      nextCursor: result.nextCursor,
      removed: result.removed,
      totalRemoved: removed,
    }, 'Deleted events past retention duration');
    if (result.removed < retentionDurationDeletePageSize || !result.nextCursor) break;
    durationCursor = result.nextCursor;
  }

  log.info({ removed }, 'Completed retention duration cleanup');
};

export const removeEventsPastRetentionMaxCount = async (
  { db, queries, log, signal }: EventDi,
): Promise<void> => {
  let removed = 0;
  let projectCursor: UUID | undefined;
  let page = 0;

  log.info({
    deleteLimitPerProject: retentionMaxCountDeleteLimitPerProject,
    projectPageSize: retentionMaxCountProjectPageSize,
  }, 'Starting retention max count cleanup');

  while (true) {
    if (signal?.aborted) {
      log.info({ removed }, 'Retention max count cleanup stopped');
      return;
    }
    page++;
    const pageLog = log.child({
      afterProjectId: projectCursor,
      page,
    });
    pageLog.info('Deleting events past retention max count');
    const result = await queries.deleteEventsPastRetentionMaxCount(db, {
      after_project_id: projectCursor,
      project_limit: retentionMaxCountProjectPageSize,
      event_limit_per_project: retentionMaxCountDeleteLimitPerProject,
    });
    removed += result.removed;
    pageLog.info({
      nextProjectCursor: result.nextProjectCursor,
      removed: result.removed,
      scannedProjects: result.scannedProjects,
      totalRemoved: removed,
    }, 'Deleted events past retention max count');
    if (result.scannedProjects < retentionMaxCountProjectPageSize || !result.nextProjectCursor) break;
    projectCursor = result.nextProjectCursor;
  }

  log.info({ removed }, 'Completed retention max count cleanup');
};
