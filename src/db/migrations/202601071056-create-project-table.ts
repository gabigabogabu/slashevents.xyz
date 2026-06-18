import type { SQL } from "@/db/types";

export default async (db: SQL) => {
  await db`CREATE TABLE IF NOT EXISTS app.projects (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name VARCHAR(255) NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES app.users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

  await db`CREATE INDEX IF NOT EXISTS idx_projects_created_by ON app.projects (created_by_user_id)`;
};
