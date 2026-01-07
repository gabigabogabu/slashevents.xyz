import type { SQL } from "bun";

export default async (db: SQL) => {
  await db`DO $$ BEGIN
    CREATE TYPE app.project_permission AS ENUM ('project_manage_users', 'project_read_users');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$`;

  await db`CREATE TABLE IF NOT EXISTS app.project_user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    permission app.project_permission NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, user_id, permission)
  )`;

  await db`CREATE INDEX IF NOT EXISTS idx_project_user_permissions_project ON app.project_user_permissions (project_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_project_user_permissions_user ON app.project_user_permissions (user_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_project_user_permissions_project_user ON app.project_user_permissions (project_id, user_id)`;
};

