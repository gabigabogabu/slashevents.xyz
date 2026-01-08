import type { UUID } from "crypto";

import jwt from "jsonwebtoken";
import { z } from "zod";

import { ErrorCode } from "@/lib/errors";
import { RpcError } from "@/server/rpc-handler";

const API_KEY_PERMISSION_READ_EVENTS = "PROJECT_READ_EVENTS" as const;

const apiKeyJwtSchema = z.object({
  projectId: z.uuid(),
  permissions: z.array(z.literal(API_KEY_PERMISSION_READ_EVENTS)).min(1),
});

export type ApiKeyJwt = z.infer<typeof apiKeyJwtSchema>;

export const createApiKeyJwt = (params: { projectId: UUID }, privateKey: string): string => {
  return jwt.sign(
    {
      projectId: params.projectId,
      permissions: [API_KEY_PERMISSION_READ_EVENTS],
    },
    privateKey,
    { algorithm: "RS256" }
  );
};

export const checkApiKeyJwt = (token: string, publicKey: string): ApiKeyJwt => {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, publicKey, { algorithms: ["RS256"] });
  } catch {
    throw new RpcError(ErrorCode.AUTHENTICATION_ERROR, 401, "Invalid API key");
  }

  const validated = apiKeyJwtSchema.safeParse(decoded);
  if (!validated.success) {
    throw new RpcError(ErrorCode.AUTHENTICATION_ERROR, 401, "Invalid API key");
  }

  return validated.data;
};

export const apiKeyHasReadEventsPermission = (claims: ApiKeyJwt): boolean => {
  return claims.permissions.includes(API_KEY_PERMISSION_READ_EVENTS);
};

