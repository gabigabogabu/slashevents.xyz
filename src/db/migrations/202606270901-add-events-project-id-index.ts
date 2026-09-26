import type { SQL } from '@/db/types';

export default async (db: SQL) => {
  await db`CREATE INDEX IF NOT EXISTS idx_events_project_id
    ON app.events (project_id, id)`;
};
