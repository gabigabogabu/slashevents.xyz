import type { SQL } from "bun";
import type { UUID } from "crypto";

import * as queries from "@/server/db/queries";
import { 
  HttpMethod, 
  EventType,
  isWebhookEvent,
  type WebhookEventData, 
  type ProjectActivityEventData,
} from "@/server/db/queries/event";

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
};

export const handleIngress = async (
  params: IngressParams,
  { db }: { db: SQL }
): Promise<{ eventId: UUID } | { error: string; status: number }> => {
  const { projectId, path, method, headers, body, queryString, sourceIp, sourcePort } = params;

  // Validate HTTP method
  const httpMethod = HTTP_METHOD_MAP[method.toUpperCase()];
  if (!httpMethod) {
    return { error: "UNSUPPORTED_METHOD", status: 405 };
  }

  // Validate project exists
  const projectExists = await queries.projectExists(db, { project_id: projectId });
  if (!projectExists) {
    return { error: "PROJECT_NOT_FOUND", status: 404 };
  }

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
  });

  if (!eventId) {
    return { error: "FAILED_TO_STORE_EVENT", status: 500 };
  }

  return { eventId };
};

// Webhook event type for return
type WebhookEvent = {
  id: UUID;
  type: EventType.WEBHOOK_RECEIVED;
  httpMethod: HttpMethod;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  queryString: string | null;
  sourceIp: string | null;
  sourcePort: number | null;
  receivedAt: string;
};

// Project activity event type for return
type ProjectActivityEvent = {
  id: UUID;
  type: EventType.PROJECT_CREATED | EventType.PROJECT_USER_ADDED | EventType.PROJECT_USER_REMOVED | EventType.PROJECT_USER_PERMISSION_GRANTED | EventType.PROJECT_USER_PERMISSION_REVOKED;
  actorEmail: string;
  data: ProjectActivityEventData;
  receivedAt: string;
};

export type Event = WebhookEvent | ProjectActivityEvent;

export const getEvents = async (
  params: { projectId: UUID; type?: EventType; limit?: number; cursor?: UUID },
  { db }: { db: SQL }
): Promise<{
  events: Event[];
  total: number;
}> => {
  const [events, total] = await Promise.all([
    queries.getEvents(db, {
      project_id: params.projectId,
      type: params.type,
      limit: params.limit,
      cursor: params.cursor,
    }),
    queries.getEventCount(db, { project_id: params.projectId, type: params.type }),
  ]);

  return {
    events: events.map((e): Event => {
      if (isWebhookEvent(e.type)) {
        const data = e.data as WebhookEventData;
        return {
          id: e.id,
          type: EventType.WEBHOOK_RECEIVED,
          httpMethod: data.httpMethod,
          path: data.path,
          headers: data.headers,
          body: data.body,
          queryString: data.queryString,
          sourceIp: data.sourceIp,
          sourcePort: data.sourcePort,
          receivedAt: e.received_at,
        };
      }
      // project activity event
      const data = e.data as ProjectActivityEventData;
      return {
        id: e.id,
        type: e.type as ProjectActivityEvent["type"],
        actorEmail: e.actor_email ?? "",
        data,
        receivedAt: e.received_at,
      };
    }),
    total,
  };
};
