import type { SQL } from "bun";

export default async (db: SQL) => {
  await db`DO $$ BEGIN
    CREATE TYPE app.event_type AS ENUM (
      'WEBHOOK_RECEIVED',
      'PROJECT_CREATED',
      'PROJECT_USER_ADDED',
      'PROJECT_USER_REMOVED',
      'PROJECT_USER_PERMISSION_GRANTED',
      'PROJECT_USER_PERMISSION_REVOKED'
    );
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$`;

  // Create unified events table
  // All event-specific data is stored in the data JSONB column
  await db`CREATE TABLE IF NOT EXISTS app.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
    type app.event_type NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

  // Create indexes for efficient queries
  await db`CREATE INDEX IF NOT EXISTS idx_events_project ON app.events (project_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_type ON app.events (type)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_project_type ON app.events (project_id, type)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_project_received ON app.events (project_id, received_at DESC)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_project_type_received ON app.events (project_id, type, received_at DESC)`;
};
