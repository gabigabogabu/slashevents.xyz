import type { SQL } from "bun";

export default async (db: SQL) => {
  // Create enum type for project event types
  await db`DO $$ BEGIN
    CREATE TYPE app.project_event_type AS ENUM (
      'project_created',
      'user_added',
      'user_removed',
      'permission_granted',
      'permission_revoked'
    );
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$`;

  // Create project_events table
  // Event-specific data (target_user_id, permission, etc.) is stored in metadata JSONB
  await db`CREATE TABLE IF NOT EXISTS app.project_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL REFERENCES app.users(id),
    event_type app.project_event_type NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

  // Create indexes for efficient queries
  await db`CREATE INDEX IF NOT EXISTS idx_project_events_project ON app.project_events (project_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_project_events_project_created ON app.project_events (project_id, created_at DESC)`;
};

