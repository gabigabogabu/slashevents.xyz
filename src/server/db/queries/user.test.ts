import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { SQL } from "bun";
import { insertUser, getUserPasswordHashAndSaltByEmail } from "./user";
import { getTestDb, resetTestDb } from "../test-setup";

describe("user queries", () => {
  let db: SQL;
  const testEmail = `test-${Date.now()}@example.com`;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);
  });

  afterAll(async () => {
    await db.close();
  });

  test("createUser inserts a user and returns the id", async () => {
    const userId = await insertUser(db, {
      email: testEmail,
      password_hash: "testhash123",
      password_salt: "testsalt123",
    });

    expect(userId).toBeDefined();
    if (!userId) throw new Error("Expected insertUser() to return a user id");
    expect(typeof userId).toBe("string");
    expect(userId.length).toBeGreaterThan(0);
  });

  test("getUserPasswordHashAndSaltByEmail returns the user data", async () => {
    const user = await getUserPasswordHashAndSaltByEmail(db, { email: testEmail });

    expect(user).toBeDefined();
    expect(user?.id).toBeDefined();
    expect(user?.password_hash).toBe("testhash123");
    expect(user?.password_salt).toBe("testsalt123");
  });

  test("getUserPasswordHashAndSaltByEmail returns undefined for non-existent user", async () => {
    const user = await getUserPasswordHashAndSaltByEmail(db, { email: "nonexistent@example.com" });

    expect(user).toBeUndefined();
  });
});

