import { describe, test } from "bun:test";
import { z } from "zod";

import { ErrorCode } from "@/lib/errors";
import { expect } from "./test-expect";
import { defRpc, RpcHandler } from "./rpc-handler";

type TestContext = {
  user: string;
};

describe("RpcHandler", () => {
  test("runs context-aware RPC definitions", async () => {
    const handler = new RpcHandler({
      echo: defRpc<{ message: string }, { user: string }, unknown, { message: string; user: string }, TestContext>({
        inputValidation: z.object({ message: z.string() }),
        outputValidation: z.object({ message: z.string(), user: z.string() }),
        auth: (_rpc, context) => ({ success: true, result: { user: context.user } }),
        handle: ({ params, authResult }) => ({
          message: params.message,
          user: authResult.result.user,
        }),
      }),
    });

    const result = await handler.handle({
      id: "request-1",
      method: "echo",
      params: { message: "hello" },
    }, { user: "agent" });

    expect(result).toEqual({
      id: "request-1",
      messages: [],
      result: { message: "hello", user: "agent" },
    });
  });

  test("returns RPC error envelopes", async () => {
    const handler = new RpcHandler({});

    const result = await handler.handle({
      id: null,
      method: "missing",
      params: {},
    }, undefined);

    expect(result).toEqual({
      id: null,
      messages: [],
      error: {
        code: ErrorCode.METHOD_NOT_DEFINED,
        hint: "Method not defined: missing",
      },
    });
  });

  test("treats invalid handler output as an internal error", async () => {
    const handler = new RpcHandler({
      badOutput: defRpc({
        inputValidation: z.object({}),
        outputValidation: z.object({ ok: z.boolean() }),
        handle: () => ({ ok: "yes" }) as unknown as { ok: boolean },
      }),
    });

    const result = await handler.handle({
      id: "request-2",
      method: "badOutput",
      params: {},
    }, undefined);

    expect(result).toEqual({
      id: "request-2",
      messages: [],
      error: {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        hint: "Invalid RPC output",
      },
    });
  });

  test("returns RPC error envelopes for rate limits", async () => {
    const handler = new RpcHandler({
      limited: defRpc({
        inputValidation: z.object({}),
        rateLimit: () => ({ success: false, result: "retry later" }),
        handle: () => ({ ok: true }),
      }),
    });

    const result = await handler.handle({
      id: "request-3",
      method: "limited",
      params: {},
    }, undefined);

    expect(result).toEqual({
      id: "request-3",
      messages: [],
      error: {
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        hint: "retry later",
      },
    });
  });
});
