import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";

import { ErrorCode } from "@/lib/errors";
import { checkApiKeyJwt, createApiKeyJwt } from "./api-keys";

describe("api keys", () => {
  // Generate RSA key pair for testing
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  test("createApiKeyJwt signs a JWT that checkApiKeyJwt can verify", () => {
    const projectId = crypto.randomUUID();
    const token = createApiKeyJwt({ projectId }, privateKey);
    const claims = checkApiKeyJwt(token, publicKey);

    expect(claims.projectId).toBe(projectId);
    expect(claims.permissions).toEqual(["PROJECT_READ_EVENTS"]);
  });

  test("checkApiKeyJwt throws for invalid token", () => {
    expect(() => checkApiKeyJwt("not-a-jwt", publicKey)).toThrow(ErrorCode.AUTHENTICATION_ERROR);
  });
});

