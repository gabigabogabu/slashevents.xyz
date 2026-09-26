import type { SQL } from '@/db/types';

export default async (db: SQL) => {
  await db`DO $$ BEGIN
    CREATE TYPE app.event_type AS ENUM (
      'WEBHOOK_RECEIVED',
      'PROJECT_CREATED'
    );
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$`;

  // Create unified events table
  // All event-specific data is stored in the data JSONB column
  await db`CREATE TABLE IF NOT EXISTS app.events (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    project_id UUID NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
    type app.event_type NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

  // Create indexes for efficient queries
  await db`CREATE INDEX IF NOT EXISTS idx_events_project ON app.events (project_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_type ON app.events (type)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_project_type ON app.events (project_id, type)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_project_received ON app.events (project_id, received_at DESC)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_project_type_received ON app.events (project_id, type, received_at DESC)`;
};
