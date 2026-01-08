// Shared event type definitions used by both frontend and backend
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

