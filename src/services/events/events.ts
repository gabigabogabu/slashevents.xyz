import type { SQL } from "@/db/types";
import type { UUID } from "crypto";

import * as queries from "@/db/queries";
import { timestampToIsoString } from "@/db/timestamps";
import { HttpMethod, type EventsChangedNotification } from "@/db/queries/event";
import { decodeEventsCursor, encodeEventsCursor } from "./events-cursor";
import { EventType } from "@/lib/event-types";

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

export const handleIngress = async (
  params: IngressParams,
  { db }: { db: SQL }
): Promise<{ eventId: UUID } | { error: string; status: number }> => {
  const { projectId, path, method, headers, body, queryString, sourceIp, sourcePort, receivedAt } = params;

  // Validate HTTP method
  const httpMethod = HTTP_METHOD_MAP[method.toUpperCase()];
  if (!httpMethod)
    return { error: "UNSUPPORTED_METHOD", status: 405 };

  // Validate project exists
  const projectExists = await queries.projectExists(db, { project_id: projectId });
  if (!projectExists)
    return { error: "PROJECT_NOT_FOUND", status: 404 };

  // Store the event
  const eventId = await queries.insertWebhookEvent(db, {
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
    receivedAt
  });

  if (!eventId)
    return { error: "FAILED_TO_STORE_EVENT", status: 500 };
  return { eventId };
};

export type EventDto = {
  id: UUID;
  projectId: UUID;
  type: EventType;
  data: queries.WebhookEventData | queries.ProjectActivityEventData;
  receivedAt: string;
  actorName: string | null;
};

export type GetEventsResult = {
  events: EventDto[];
  nextCursor: string | null;
  hasMore: boolean;
};

export const getEvents = async (
  params: { projectId: UUID; limit: number; type?: EventType; cursor?: string },
  { db }: { db: SQL }
): Promise<GetEventsResult> => {
  const decodedCursor = params.cursor
    ? decodeEventsCursor(params.cursor)
    : undefined;

  const events = await queries.getEvents(db, {
    project_id: params.projectId,
    type: params.type,
    limit: params.limit + 1,
    cursor: decodedCursor
  });

  const limitedEvents = events.slice(0, params.limit);
  
  const mapped: EventDto[] = limitedEvents.map((e) => ({
    id: e.id,
    projectId: e.project_id,
    type: e.type,
    data: e.data as queries.WebhookEventData | queries.ProjectActivityEventData,
    receivedAt: timestampToIsoString(e.received_at),
    actorName: e.actor_name,
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
    if (typeof parsed.type !== "string" || !eventTypes.has(parsed.type)) return null;
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
  { db }: { db: SQL }
): Promise<GetEventsResult> => {
  const maxWaitMs = Math.max(0, Math.floor((params.longPollDurationSeconds ?? 0) * 1000));
  if (maxWaitMs <= 0) return getEvents(params, { db });

  const deadline = Date.now() + maxWaitMs;
  let pendingNotification = false;
  let wake: (() => void) | null = null;
  const unsubscribe = queries.subscribeToEventsChanged(params.projectId, (payload) => {
    const notification = parseEventsChangedNotification(payload);
    if (!notification || !notificationMatches(notification, params)) return;
    pendingNotification = true;
    wake?.();
  });

  const waitForNotificationOrDeadline = (remainingMs: number): Promise<void> =>
    new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        timeout = null;
        wake = null;
        resolve();
      }, remainingMs);

      wake = () => {
        if (timeout) clearTimeout(timeout);
        timeout = null;
        wake = null;
        resolve();
      };
    });

  try {
    let result = await getEvents(params, { db });
    if (result.events.length > 0) return result;

    while (Date.now() < deadline) {
      if (!pendingNotification) {
        const remainingMs = Math.max(0, deadline - Date.now());
        if (remainingMs <= 0) break;
        await waitForNotificationOrDeadline(remainingMs);
      }

      if (!pendingNotification) break;
      pendingNotification = false;
      result = await getEvents(params, { db });
      if (result.events.length > 0) return result;
    }

    return getEvents(params, { db });
  } finally {
    unsubscribe();
  }
};
