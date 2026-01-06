import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { SQL } from "bun";
import { getTestDb, resetTestDb } from "@/server/db/test-setup";

describe("user auth", () => {
  let db: SQL;
  const testEmail = `test-${Date.now()}@example.com`;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);
  });

  afterAll(async () => {
    await db.close();
  });
});

