import { describe, test } from "bun:test";
import { z } from "zod";

import { expect } from "@/test-expect";
import { defRpc, RpcHandler } from "@/rpc-handler";
import { generateRpcDocs, renderRpcDocsHtml } from "./generate-docs";

describe("RPC docs", () => {
  test("describes methods from an RPC handler", () => {
    const handler = new RpcHandler({
      createThing: defRpc({
        inputValidation: z.object({
          name: z.string(),
          count: z.number().int().default(1),
        }),
        outputValidation: z.object({
          id: z.uuid(),
          ok: z.boolean(),
        }),
        handle: () => ({ id: "01900000-0000-7000-8000-000000000000", ok: true }),
      }),
    });

    const docs = generateRpcDocs(handler);

    expect(docs.endpoint).toBe("/rpc");
    expect(docs.auth.type).toBe("Application-layer certificate signatures");
    expect(docs.auth.publicMethods).toEqual(["createUser"]);
    expect(docs.auth.signUp.method).toBe("createUser");
    expect(docs.auth.signUp.curl).toContain("https://slashevents.xyz/rpc");
    expect(docs.auth.signUp.curl).toContain("--rawfile cert client.pem");
    expect(docs.auth.authenticatedRequest.curl).toContain("X-SlashEvents-Fingerprint");
    expect(docs.auth.authenticatedRequest.curl).toContain("openssl dgst -sha256 -sign client.key");
    expect(docs.methods[0]?.name).toBe("createThing");
    expect(docs.methods[0]?.params.some((field) => field.name === "name" && field.required)).toBe(true);
    expect(docs.methods[0]?.params.some((field) => field.name === "count" && !field.required)).toBe(true);
    expect(docs.methods[0]?.returns.some((field) => field.name === "id" && field.type === "string/uuid")).toBe(true);
  });

  test("describes nested object arrays", () => {
    const handler = new RpcHandler({
      listThings: defRpc({
        inputValidation: z.object({}),
        outputValidation: z.object({
          things: z.array(z.object({
            id: z.uuid(),
            name: z.string(),
          })),
        }),
        handle: () => ({ things: [] }),
      }),
    });

    const docs = generateRpcDocs(handler);
    const things = docs.methods[0]?.returns.find((field) => field.name === "things");

    expect(things?.type).toBe("object[]");
    expect(things?.fields?.some((field) => field.name === "id")).toBe(true);
  });

  test("describes accepted values for enum array fields", () => {
    const handler = new RpcHandler({
      setPermissions: defRpc({
        inputValidation: z.object({
          permissions: z.array(z.enum(["READ", "WRITE"])),
        }),
        outputValidation: z.object({
          ok: z.boolean(),
        }),
        handle: () => ({ ok: true }),
      }),
    });

    const docs = generateRpcDocs(handler);
    const permissions = docs.methods[0]?.params.find((field) => field.name === "permissions");
    const html = renderRpcDocsHtml(docs);

    expect(permissions?.type).toBe("string/enum[]");
    expect(permissions?.enumValues).toEqual(["READ", "WRITE"]);
    expect(html).toContain("<code>READ</code>");
    expect(html).toContain("<code>WRITE</code>");
  });

  test("describes UUIDv7 array fields", () => {
    const handler = new RpcHandler({
      ackMessages: defRpc({
        inputValidation: z.object({
          messageIds: z.array(z.uuidv7()),
        }),
        outputValidation: z.object({
          ok: z.boolean(),
        }),
        handle: () => ({ ok: true }),
      }),
    });

    const docs = generateRpcDocs(handler);
    const messageIds = docs.methods[0]?.params.find((field) => field.name === "messageIds");
    const html = renderRpcDocsHtml(docs);

    expect(messageIds?.type).toBe("string/uuidv7[]");
    expect(html).toContain("<code>messageIds</code>");
    expect(html).toContain("<code>string/uuidv7[]</code>");
  });

  test("renders agent-facing HTML docs", () => {
    const handler = new RpcHandler({
      createThing: defRpc({
        inputValidation: z.object({
          name: z.string(),
        }),
        outputValidation: z.object({
          id: z.uuid(),
        }),
        handle: () => ({ id: "01900000-0000-7000-8000-000000000000" }),
      }),
    });

    const html = renderRpcDocsHtml(generateRpcDocs(handler));

    expect(html).toContain("<h1>slashevents.xyz</h1>");
    expect(html).toContain("<h2>Auth</h2>");
    expect(html).toContain("openssl req -x509");
    expect(html).toContain("X-SlashEvents-Signature");
    expect(html).toContain("<h2>Rate Limits</h2>");
    expect(html).toContain("Agents should log non-empty messages, flag them for human review, then acknowledge them with <code>ackMessages</code>.");
    expect(html).toContain("<summary><strong>createThing</strong></summary>");
    expect(html).toContain("<code>name</code>");
  });
});
