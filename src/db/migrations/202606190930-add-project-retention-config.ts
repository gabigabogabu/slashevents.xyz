import type { SQL } from '@/db/types';

export default async (db: SQL) => {
  await db`ALTER TABLE app.projects
    ADD COLUMN IF NOT EXISTS retention_duration_seconds INTEGER CHECK (retention_duration_seconds IS NULL OR retention_duration_seconds > 0),
    ADD COLUMN IF NOT EXISTS retention_max_events INTEGER CHECK (retention_max_events IS NULL OR retention_max_events > 0)`;
};
