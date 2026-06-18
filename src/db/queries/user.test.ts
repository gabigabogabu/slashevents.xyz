import { afterAll, beforeAll, describe, test } from "bun:test";

import { expect } from "@/test-expect";
import type { SQL } from "@/db/types";
import { insertUser, getUserById } from "./user";
import { getTestDb, resetTestDb } from "../test-setup";

describe("user queries", () => {
  let db: SQL;
  const testDisplayName = `test-${Date.now()}`;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);
  });

  afterAll(async () => {
    await db.end();
  });

  test("createUser inserts a user and returns the id", async () => {
    const userId = await insertUser(db, {
      display_name: testDisplayName,
    });

    expect(userId).toBeDefined();
    if (!userId) throw new Error("Expected insertUser() to return a user id");
    expect(typeof userId).toBe("string");
    expect(userId.length).toBeGreaterThan(0);
    const user = await getUserById(db, { id: userId as `${string}-${string}-${string}-${string}-${string}` });
    expect(user?.display_name).toBe(testDisplayName);
  });
});
