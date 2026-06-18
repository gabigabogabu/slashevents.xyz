import type { SQL } from "@/db/types";

export default async (db: SQL) => {
  await db`ALTER TABLE app.projects
    ADD COLUMN IF NOT EXISTS webhook_path_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb`;
};
