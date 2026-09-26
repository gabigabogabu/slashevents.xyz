import type { SQL } from '@/db/types';

export default async (db: SQL) => {
  await db`ALTER TABLE IF EXISTS app.projects ALTER COLUMN id SET DEFAULT uuidv7()`;
  await db`ALTER TABLE IF EXISTS app.events ALTER COLUMN id SET DEFAULT uuidv7()`;
};
