export enum EventType {
  WEBHOOK_RECEIVED = 'WEBHOOK_RECEIVED',
  PROJECT_CREATED = 'PROJECT_CREATED',
}

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',
}

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
  name: string;
};

export type EventsChangedNotification = {
  type: EventType;
};
