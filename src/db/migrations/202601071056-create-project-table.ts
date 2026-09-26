import type { SQL } from '@/db/types';

export default async (db: SQL) => {
  await db`CREATE TABLE IF NOT EXISTS app.projects (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

};
