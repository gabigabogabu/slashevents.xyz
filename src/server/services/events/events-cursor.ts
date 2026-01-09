import type { UUID } from "crypto";
import { z } from "zod";

import { ErrorCode } from "@/lib/errors";
import { RpcError } from "@/server/rpc-handler";

const eventsCursorV1Schema = z.object({
  v: z.literal(1),
  id: z.uuid(),
});

export type EventsCursor = {
  id: UUID;
};

const base64Encode = (value: string): string => Buffer.from(value, "utf8").toString("base64");
const base64Decode = (value: string): string => Buffer.from(value, "base64").toString("utf8");

export const encodeEventsCursor = (cursor: EventsCursor): string => {
  const payload = {
    v: 1 as const,
    id: cursor.id,
  };
  return base64Encode(JSON.stringify(payload));
};

export const decodeEventsCursor = (cursor: string): EventsCursor => {
  let parsed: unknown;
  try {
    const json = base64Decode(cursor);
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new RpcError(ErrorCode.INVALID_INPUT, 400, "INVALID_CURSOR");
  }

  const validated = eventsCursorV1Schema.safeParse(parsed);
  if (!validated.success) {
    throw new RpcError(ErrorCode.INVALID_INPUT, 400, "INVALID_CURSOR");
  }

  return {
    id: validated.data.id as UUID,
  };
};

