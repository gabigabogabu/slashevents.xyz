import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { RpcHandler, defRpc } from '@/lib/rpc/handler';

import { generateRpcDocs, renderRpcDocsHtml } from './generate-docs';

describe('RPC docs', () => {
  test('describes methods from an RPC handler', () => {
    const handler = new RpcHandler({
      createThing: defRpc({
        description: 'Creates a thing for testing.',
        inputValidation: z.object({
          name: z.string(),
          count: z.number().int().default(1),
        }),
        outputValidation: z.object({
          id: z.uuidv7(),
          ok: z.boolean(),
        }),
        handle: () => ({ id: '01900000-0000-7000-8000-000000000000', ok: true }),
      }),
    });

    const docs = generateRpcDocs(handler);

    expect(docs.endpoint).toBe('/rpc');
    expect(docs.auth.type).toBe('Bearer token');
    expect(docs.auth.authenticatedRequest.curl).toContain('http://localhost:3000/rpc');
    expect(docs.auth.authenticatedRequest.curl).toContain('Authorization: Bearer $SLASHEVENTS_API_TOKEN');
    expect(docs.methods[0]?.name).toBe('createThing');
    expect(docs.methods[0]?.description).toBe('Creates a thing for testing.');
    expect(docs.methods[0]?.params.some((field) => field.name === 'name' && field.required)).toBe(true);
    expect(docs.methods[0]?.params.some((field) => field.name === 'count' && !field.required)).toBe(true);
    expect(docs.methods[0]?.returns.some((field) => field.name === 'id' && field.type === 'string/uuidv7')).toBe(true);
  });

  test('describes nested object arrays', () => {
    const handler = new RpcHandler({
      listThings: defRpc({
        inputValidation: z.object({}),
        outputValidation: z.object({
          things: z.array(z.object({
            id: z.uuidv7(),
            name: z.string(),
          })),
        }),
        handle: () => ({ things: [] }),
      }),
    });

    const docs = generateRpcDocs(handler);
    const things = docs.methods[0]?.returns.find((field) => field.name === 'things');

    expect(things?.type).toBe('object[]');
    expect(things?.fields?.some((field) => field.name === 'id')).toBe(true);
  });

  test('describes accepted values for enum array fields', () => {
    const handler = new RpcHandler({
      setValues: defRpc({
        inputValidation: z.object({
          values: z.array(z.enum(['READ', 'WRITE'])),
        }),
        outputValidation: z.object({
          ok: z.boolean(),
        }),
        handle: () => ({ ok: true }),
      }),
    });

    const docs = generateRpcDocs(handler);
    const values = docs.methods[0]?.params.find((field) => field.name === 'values');
    const html = renderRpcDocsHtml(docs);

    expect(values?.type).toBe('string/enum[]');
    expect(values?.enumValues).toEqual(['READ', 'WRITE']);
    expect(html).toContain('<code>READ</code>');
    expect(html).toContain('<code>WRITE</code>');
  });

  test('describes UUIDv7 array fields', () => {
    const handler = new RpcHandler({
      removeItems: defRpc({
        inputValidation: z.object({
          itemIds: z.array(z.uuidv7()),
        }),
        outputValidation: z.object({
          ok: z.boolean(),
        }),
        handle: () => ({ ok: true }),
      }),
    });

    const docs = generateRpcDocs(handler);
    const itemIds = docs.methods[0]?.params.find((field) => field.name === 'itemIds');
    const html = renderRpcDocsHtml(docs);

    expect(itemIds?.type).toBe('string/uuidv7[]');
    expect(html).toContain('<code>itemIds</code>');
    expect(html).toContain('<code>string/uuidv7[]</code>');
  });

  test('renders agent-facing HTML docs', () => {
    const handler = new RpcHandler({
      createThing: defRpc({
        description: 'Creates a thing for testing.',
        inputValidation: z.object({
          name: z.string(),
        }),
        outputValidation: z.object({
          id: z.uuidv7(),
        }),
        handle: () => ({ id: '01900000-0000-7000-8000-000000000000' }),
      }),
    });

    const html = renderRpcDocsHtml(generateRpcDocs(handler));

    expect(html).toContain('<h1>SlashEvents</h1>');
    expect(html).toContain('<h2>Auth</h2>');
    expect(html).toContain('Authorization: Bearer $SLASHEVENTS_API_TOKEN');
    expect(html).toContain('<h2>Rate Limits</h2>');
    expect(html).toContain('<summary><strong>createThing</strong></summary>');
    expect(html).toContain('<p>Creates a thing for testing.</p>');
    expect(html).toContain('<code>name</code>');
  });
});
