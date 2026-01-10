import type { SQL } from "bun";
import type { UUID } from "crypto";

import * as queries from "@/server/db/queries";
import { HttpMethod } from "@/server/db/queries/event";
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
  actorEmail: string | null;
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
    receivedAt: e.received_at,
    actorEmail: e.actor_email,
  }));

  const hasMore = events.length > params.limit;
  const lastEvent = limitedEvents[limitedEvents.length - 1];
  const nextCursor = lastEvent && hasMore
    ? encodeEventsCursor({ c: lastEvent.cursor })
    : null;
  return { events: mapped, nextCursor, hasMore };
};

const sleep = async (ms: number): Promise<void> => {
  const clampedMs = Math.max(0, Math.floor(ms));
  if (clampedMs === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, clampedMs));
};

export const getEventsLongPoll = async (
  params: {
    projectId: UUID;
    limit: number;
    type?: EventType;
    cursor?: string;
    longPollDurationSeconds?: number;
  },
  { db }: { db: SQL }
): Promise<ReturnType<typeof getEvents>> => {
  const maxWaitMs = Math.max(0, Math.floor((params.longPollDurationSeconds ?? 0) * 1000));
  const delayBetweenLoopsMs = 1 * 1000; // 1 second
  const startedAt = Date.now();
  const deadline = startedAt + maxWaitMs;

  let result: Awaited<ReturnType<typeof getEvents>> = { events: [], nextCursor: null, hasMore: false };
  do {
    result = await getEvents(params, { db });
    if (!params.longPollDurationSeconds) break; // not requested to long-poll
    if (params.longPollDurationSeconds <= 0) break; // not requested to long-poll
    if (result.events.length > 0) break; // we have events

    // retry
    const remainingMs = deadline - Date.now();
    await sleep(Math.min(delayBetweenLoopsMs, remainingMs));
  } while (Date.now() < deadline && result.events.length === 0);

  return result;
};
