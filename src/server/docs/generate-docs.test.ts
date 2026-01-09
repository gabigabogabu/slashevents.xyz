import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { RpcHandler, defRpc } from "../rpc-handler";
import { generateDocs, generateMarkdownDocs } from "./generate-docs";

enum TestEnum {
  VALUE_A = "VALUE_A",
  VALUE_B = "VALUE_B",
}

describe("generateDocs", () => {
  test("extracts method name from handler", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({}),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, {
      name: "Test API",
      description: "Test description",
      baseUrl: "/test",
    });

    expect(docs.name).toBe("Test API");
    expect(docs.description).toBe("Test description");
    expect(docs.baseUrl).toBe("/test");
    expect(docs.methods).toHaveLength(1);
    expect(docs.methods[0].name).toBe("testMethod");
  });

  test("extracts required string param", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          name: z.string(),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods[0].params).toEqual([
      { name: "name", type: "string", required: true },
    ]);
  });

  test("extracts optional param", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          name: z.string().optional(),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods[0].params).toEqual([
      { name: "name", type: "string", required: false },
    ]);
  });

  test("extracts uuid type", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          id: z.uuid(),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods[0].params[0].type).toBe("string/uuid");
  });

  test("extracts number and integer types", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          count: z.number().int(),
          amount: z.number(),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    const countParam = docs.methods[0].params.find((p) => p.name === "count");
    const amountParam = docs.methods[0].params.find((p) => p.name === "amount");

    expect(countParam?.type).toBe("number/integer");
    expect(amountParam?.type).toBe("number");
  });

  test("extracts enum with values", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          status: z.nativeEnum(TestEnum),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods[0].params[0].type).toBe("string/enum");
    expect(docs.methods[0].params[0].enumValues).toEqual(["VALUE_A", "VALUE_B"]);
  });

  test("extracts optional enum with values", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          status: z.nativeEnum(TestEnum).optional(),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods[0].params[0].name).toBe("status");
    expect(docs.methods[0].params[0].type).toBe("string/enum");
    expect(docs.methods[0].params[0].required).toBe(false);
    expect(docs.methods[0].params[0].enumValues).toEqual(["VALUE_A", "VALUE_B"]);
  });

  test("extracts array type", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          ids: z.array(z.string()),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods[0].params[0].type).toBe("string[]");
  });

  test("extracts jwt type", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          token: z.jwt(),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods[0].params[0].type).toBe("string/jwt");
  });

  test("extracts description from schema", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          name: z.string().describe("The user's name"),
          age: z.number().optional().describe("The user's age"),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    const nameParam = docs.methods[0].params.find((p) => p.name === "name");
    const ageParam = docs.methods[0].params.find((p) => p.name === "age");

    expect(nameParam?.description).toBe("The user's name");
    expect(ageParam?.description).toBe("The user's age");
  });

  test("extracts example from schema meta", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          apiKey: z.string().meta({ example: "my-api-key-123" }),
          count: z.number().meta({ example: 42 }),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    const apiKeyParam = docs.methods[0].params.find((p) => p.name === "apiKey");
    const countParam = docs.methods[0].params.find((p) => p.name === "count");

    expect(apiKeyParam?.example).toBe("my-api-key-123");
    expect(countParam?.example).toBe(42);
  });

  test("extracts output validation as returns", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({}),
        outputValidation: z.object({
          id: z.uuid(),
          count: z.number().int(),
        }),
        handle: async () => ({ id: "test", count: 1 }),
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods[0].returns).toHaveLength(2);
    
    const idReturn = docs.methods[0].returns.find((r) => r.name === "id");
    expect(idReturn?.type).toBe("string/uuid");
    expect(idReturn?.required).toBe(true);

    const countReturn = docs.methods[0].returns.find((r) => r.name === "count");
    expect(countReturn?.type).toBe("number/integer");
    expect(countReturn?.required).toBe(true);
  });

  test("extracts nested object array children", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({}),
        outputValidation: z.object({
          items: z.array(z.object({
            id: z.uuid().meta({ example: "abc-123" }),
            name: z.string().describe("The item name"),
          })),
        }),
        handle: async () => ({ items: [] }),
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    const itemsReturn = docs.methods[0].returns.find((r) => r.name === "items");
    expect(itemsReturn?.type).toBe("object[]");
    expect(itemsReturn?.children).toHaveLength(2);

    const idChild = itemsReturn?.children?.find((c) => c.name === "id");
    expect(idChild?.type).toBe("string/uuid");
    expect(idChild?.example).toBe("abc-123");

    const nameChild = itemsReturn?.children?.find((c) => c.name === "name");
    expect(nameChild?.type).toBe("string");
    expect(nameChild?.description).toBe("The item name");
  });

  test("returns empty array when no outputValidation", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({}),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods[0].returns).toEqual([]);
  });

  test("handles multiple methods", () => {
    const handler = new RpcHandler({
      methodA: defRpc({
        inputValidation: z.object({ a: z.string() }),
        handle: async () => {},
      }),
      methodB: defRpc({
        inputValidation: z.object({ b: z.number() }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });

    expect(docs.methods).toHaveLength(2);
    const names = docs.methods.map((m) => m.name);
    expect(names).toContain("methodA");
    expect(names).toContain("methodB");
  });
});

describe("generateMarkdownDocs", () => {
  test("generates markdown with headers", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          apiKey: z.string(),
        }),
        outputValidation: z.object({
          result: z.string(),
        }),
        handle: async () => ({ result: "ok" }),
      }),
    });

    const docs = generateDocs(handler, {
      name: "Test API",
      description: "Test description",
      baseUrl: "/api",
    });

    const md = generateMarkdownDocs(docs);

    expect(md).toContain("# Test API");
    expect(md).toContain("Test description");
    expect(md).toContain("**Base URL:** `/api`");
    expect(md).toContain("## Authentication");
    expect(md).toContain("## Request Format");
    expect(md).toContain("## Response Format");
    expect(md).toContain("## Methods");
    expect(md).toContain("### testMethod");
  });

  test("generates parameter table", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          name: z.string(),
          age: z.number().optional(),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });
    const md = generateMarkdownDocs(docs);

    expect(md).toContain("| Parameter | Type | Required | Description |");
    expect(md).toContain("| `name` | string | Yes |");
    expect(md).toContain("| `age` | number | No |");
  });

  test("generates returns table", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({}),
        outputValidation: z.object({
          id: z.uuid(),
        }),
        handle: async () => ({ id: "test" }),
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });
    const md = generateMarkdownDocs(docs);

    expect(md).toContain("**Returns:**");
    expect(md).toContain("| Field | Type | Description |");
    expect(md).toContain("| `id` | string/uuid |");
  });

  test("shows void for empty returns", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({}),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });
    const md = generateMarkdownDocs(docs);

    expect(md).toContain("**Returns:**\n\nvoid");
  });

  test("includes enum values in table", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          status: z.nativeEnum(TestEnum),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });
    const md = generateMarkdownDocs(docs);

    expect(md).toContain("`VALUE_A`");
    expect(md).toContain("`VALUE_B`");
  });

  test("generates example request JSON", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({
          apiKey: z.string(),
        }),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });
    const md = generateMarkdownDocs(docs);

    expect(md).toContain("**Example Request:**");
    expect(md).toContain('"method": "testMethod"');
    expect(md).toContain('"apiKey": "example"');
  });

  test("generates example response JSON", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({}),
        outputValidation: z.object({
          id: z.uuid(),
          count: z.number().int(),
        }),
        handle: async () => ({ id: "test", count: 1 }),
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });
    const md = generateMarkdownDocs(docs);

    expect(md).toContain("**Example Response:**");
    expect(md).toContain('"result"');
    expect(md).toContain('"id": "a8471df2-d595-4914-a00c-a3791c579690"');
    expect(md).toContain('"count": 10');
  });

  test("generates nested object array in returns table and example", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({}),
        outputValidation: z.object({
          events: z.array(z.object({
            id: z.uuid().meta({ example: "event-uuid-123" }),
            type: z.string().meta({ example: "WEBHOOK" }),
          })),
        }),
        handle: async () => ({ events: [] }),
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });
    const md = generateMarkdownDocs(docs);

    // Check returns table shows nested fields
    expect(md).toContain("| `events` | object[]");
    expect(md).toContain("| `events[].id` | string/uuid");
    expect(md).toContain("| `events[].type` | string");

    // Check example response includes nested values (JSON is inline)
    expect(md).toContain('"events"');
    expect(md).toContain('"event-uuid-123"');
    expect(md).toContain('"WEBHOOK"');
  });

  test("generates null result for void returns", () => {
    const handler = new RpcHandler({
      testMethod: defRpc({
        inputValidation: z.object({}),
        handle: async () => {},
      }),
    });

    const docs = generateDocs(handler, { name: "", description: "", baseUrl: "" });
    const md = generateMarkdownDocs(docs);

    expect(md).toContain('"result": null');
  });
});
