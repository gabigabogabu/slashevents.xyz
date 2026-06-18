import type { UUID } from "node:crypto";

import { AppError } from "@/lib/app-error";
import { ErrorCode } from "@/lib/errors";
import type { SQL } from "@/db/types";
import * as queries from "@/db/queries";
import {
  authenticateAgentSignedRequest,
  type AgentIdentity,
} from "@/services/agents/agents";

export type AuthenticatedUser = {
  id: UUID;
  displayName: string;
  fingerprintSha256: string;
};

const requiredHeader = (request: Request, name: string): string => {
  const value = request.headers.get(name)?.trim();
  if (!value) 
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, `Missing ${name} header`);
  return value;
}

const authenticateRequest = async (
  request: Request,
  { db, body }: { db: SQL; body: string },
): Promise<AgentIdentity> => {
  const url = new URL(request.url);
  return authenticateAgentSignedRequest({
    fingerprintSha256: requiredHeader(request, "x-slashevents-fingerprint"),
    timestamp: requiredHeader(request, "x-slashevents-timestamp"),
    signature: requiredHeader(request, "x-slashevents-signature"),
    method: request.method,
    pathWithQuery: `${url.pathname}${url.search}`,
    body,
  }, { db });
};

export const requireAgentUser = async (
  request: Request,
  { db, body }: { db: SQL; body: string },
): Promise<AuthenticatedUser> => {
  const agent = await authenticateRequest(request, { db, body });
  const user = await queries.getUserById(db, { id: agent.userId });
  if (!user)
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "Signed request user was not found");
  return {
    id: user.id,
    displayName: user.display_name,
    fingerprintSha256: agent.fingerprintSha256,
  };
};
