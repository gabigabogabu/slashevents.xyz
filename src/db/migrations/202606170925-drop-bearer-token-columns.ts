import type { SQL } from "@/db/types";

export default async (db: SQL) => {
  await db`ALTER TABLE app.users DROP COLUMN IF EXISTS bearer_token_hash`;
  await db`ALTER TABLE app.users DROP COLUMN IF EXISTS bearer_token_created_at`;
};
