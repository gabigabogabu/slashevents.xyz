import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { ErrorCode } from '@/errors';

import { RpcHandler, defRpc } from './handler';

type TestContext = {
  client: string;
};

describe('RpcHandler', () => {
  test('runs context-aware RPC definitions', async () => {
    const handler = new RpcHandler({
      echo: defRpc<{ message: string }, { client: string }, unknown, { message: string; client: string }, TestContext>({
        inputValidation: z.object({ message: z.string() }),
        outputValidation: z.object({ message: z.string(), client: z.string() }),
        auth: (_rpc, context) => ({ success: true, result: { client: context.client } }),
        handle: ({ params, authResult }) => ({
          message: params.message,
          client: authResult.result.client,
        }),
      }),
    });

    const result = await handler.handle({
      id: 'request-1',
      method: 'echo',
      params: { message: 'hello' },
    }, { client: 'test-client' });

    expect(result).toEqual({
      id: 'request-1',
      result: { message: 'hello', client: 'test-client' },
    });
  });

  test('returns RPC error envelopes', async () => {
    const handler = new RpcHandler({});

    const result = await handler.handle({
      id: null,
      method: 'missing',
      params: {},
    }, undefined);

    expect(result).toEqual({
      id: null,
      error: {
        code: ErrorCode.METHOD_NOT_DEFINED,
        hint: 'Method not defined: missing',
      },
    });
  });

  test('treats invalid handler output as an internal error', async () => {
    const handler = new RpcHandler({
      badOutput: defRpc({
        inputValidation: z.object({}),
        outputValidation: z.object({ ok: z.boolean() }),
        handle: () => ({ ok: 'yes' }) as unknown as { ok: boolean },
      }),
    });

    const result = await handler.handle({
      id: 'request-2',
      method: 'badOutput',
      params: {},
    }, undefined);

    expect(result).toEqual({
      id: 'request-2',
      error: {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        hint: 'Invalid RPC output',
      },
    });
  });

  test('returns RPC error envelopes for rate limits', async () => {
    const handler = new RpcHandler({
      limited: defRpc({
        inputValidation: z.object({}),
        rateLimit: () => ({ success: false, result: 'retry later' }),
        handle: () => ({ ok: true }),
      }),
    });

    const result = await handler.handle({
      id: 'request-3',
      method: 'limited',
      params: {},
    }, undefined);

    expect(result).toEqual({
      id: 'request-3',
      error: {
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        hint: 'retry later',
      },
    });
  });
});
