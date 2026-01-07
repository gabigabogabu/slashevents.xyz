import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { SQL } from "bun";
import crypto from "node:crypto";
import { getTestDb, resetTestDb } from "@/server/db/test-setup";
import { ErrorCode } from "@/lib/errors";
import type { Env } from "@/server/env";
import { userSignup, userLogin, checkUserJwt } from "./auth";

// Generate RSA key pair for testing
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const testEnv: Env = {
  NODE_ENV: "development",
  PORT: 3000,
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  JWT_PRIVATE_KEY: privateKey,
  JWT_PUBLIC_KEY: publicKey,
};

describe("user auth", () => {
  let db: SQL;
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = "testpassword123";

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);
  });

  afterAll(async () => {
    await db.close();
  });

  test("userSignup creates user and returns a valid JWT", async () => {
    const result = await userSignup(
      { email: testEmail, password: testPassword },
      { db, env: testEnv }
    );

    expect(result.jwt).toBeDefined();
    expect(typeof result.jwt).toBe("string");
    expect(result.jwt.length).toBeGreaterThan(0);
  });

  test("checkUserJwt verifies and decodes a valid JWT", async () => {
    // First signup to get a JWT
    const signupEmail = `verify-${Date.now()}@example.com`;
    const { jwt } = await userSignup(
      { email: signupEmail, password: testPassword },
      { db, env: testEnv }
    );

    // Verify the JWT - this would have failed with "jwt.verify is not a function"
    // if the parameter name shadowed the jwt library import
    const decoded = checkUserJwt(jwt, testEnv.JWT_PUBLIC_KEY);

    expect(decoded.userId).toBeDefined();
    expect(typeof decoded.userId).toBe("string");
  });

  test("userLogin returns a valid JWT for correct credentials", async () => {
    const result = await userLogin(
      { email: testEmail, password: testPassword },
      { db, env: testEnv }
    );

    expect(result.jwt).toBeDefined();

    // Verify the login JWT works
    const decoded = checkUserJwt(result.jwt, testEnv.JWT_PUBLIC_KEY);
    expect(decoded.userId).toBeDefined();
  });

  test("userLogin throws for invalid password", async () => {
    expect(
      userLogin(
        { email: testEmail, password: "wrongpassword" },
        { db, env: testEnv }
      )
    ).rejects.toThrow(ErrorCode.INVALID_CREDENTIALS);
  });

  test("userLogin throws for non-existent email", async () => {
    expect(
      userLogin(
        { email: "nonexistent@example.com", password: testPassword },
        { db, env: testEnv }
      )
    ).rejects.toThrow(ErrorCode.INVALID_CREDENTIALS);
  });

  test("checkUserJwt throws for invalid JWT", async () => {
    expect(() => checkUserJwt("invalid-token", testEnv.JWT_PUBLIC_KEY)).toThrow();
  });
});
