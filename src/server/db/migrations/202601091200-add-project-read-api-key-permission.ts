import type { SQL } from "bun";

export default async (db: SQL) => {
  await db`DO $$ BEGIN
    ALTER TYPE app.project_permission ADD VALUE 'PROJECT_READ_API_KEY';
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$`;
};

