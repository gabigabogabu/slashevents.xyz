import { z } from "zod";
import type { RpcHandler } from "../rpc-handler";

export type ParamDoc = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  example?: unknown;
  children?: ParamDoc[]; // For nested objects/arrays
};

export type MethodDoc = {
  name: string;
  description?: string;
  params: ParamDoc[];
  returns: ParamDoc[];
};

export type ApiDoc = {
  name: string;
  description: string;
  baseUrl: string;
  methods: MethodDoc[];
};

// Helper to get the Zod type from _def.type or _zod.traits
function getZodType(schema: z.ZodSchema): string {
  const def = (schema as any)._def ?? (schema as any).def ?? {};
  if (def.type) return def.type;

  // Fallback to checking traits
  const traits = (schema as any)._zod?.traits;
  if (traits instanceof Set) {
    if (traits.has("ZodObject")) return "object";
    if (traits.has("ZodString")) return "string";
    if (traits.has("ZodNumber")) return "number";
    if (traits.has("ZodBoolean")) return "boolean";
    if (traits.has("ZodOptional")) return "optional";
    if (traits.has("ZodArray")) return "array";
    if (traits.has("ZodEnum")) return "enum";
  }
  return "unknown";
}

// Check if schema has a specific trait
function hasZodTrait(schema: z.ZodSchema, trait: string): boolean {
  const traits = (schema as any)._zod?.traits;
  return traits instanceof Set && traits.has(trait);
}

// Check if schema is an enum (native or regular)
function isEnumSchema(schema: z.ZodSchema): boolean {
  return getZodType(schema) === "enum" || hasZodTrait(schema, "ZodEnum");
}

/**
 * Extract documentation from a Zod schema
 */
function zodSchemaToParamDocs(schema: z.ZodSchema): ParamDoc[] {
  const params: ParamDoc[] = [];

  if (getZodType(schema) === "object") {
    // Access shape - in Zod v4 it's an object, in v3 it might be a function
    const defShape = (schema as any)._def?.shape;
    const shape = typeof defShape === "function" ? defShape() : (defShape ?? (schema as any).shape ?? {});
    for (const [key, value] of Object.entries(shape)) {
      params.push(zodFieldToParamDoc(key, value as z.ZodSchema));
    }
  }

  return params;
}

// Get example from Zod's global registry
function getSchemaExample(schema: z.ZodSchema): unknown {
  const meta = (z as any).globalRegistry?.get(schema);
  return meta?.example;
}

function zodFieldToParamDoc(name: string, schema: z.ZodSchema): ParamDoc {
  let type = getZodTypeName(schema);
  let required = true;
  let enumValues: string[] | undefined;
  let description: string | undefined;
  let example: unknown = getSchemaExample(schema);
  let children: ParamDoc[] | undefined;
  let zodType = getZodType(schema);
  let innerSchema = schema;

  // Extract description
  description = (schema as any).description;

  // Handle optional - unwrap to get the inner type
  if (zodType === "optional") {
    required = false;
    const inner = (schema as any)._def?.innerType ?? (schema as any).def?.innerType;
    if (inner) {
      innerSchema = inner;
      zodType = getZodType(inner);
      type = getZodTypeName(inner);
      // Get description from inner type if not set on optional wrapper
      if (!description) {
        description = (inner as any).description;
      }
      // Get example from inner type if not set on optional wrapper
      if (example === undefined) {
        example = getSchemaExample(inner);
      }
    }
  }

  // Handle enums
  if (isEnumSchema(innerSchema)) {
    enumValues = extractEnumValues(innerSchema);
  }

  // Handle arrays - extract children from element type
  if (zodType === "array") {
    const element = (innerSchema as any)._def?.element ?? (innerSchema as any).element;
    if (element && getZodType(element) === "object") {
      children = zodSchemaToParamDocs(element);
    }
  }

  // Handle objects - extract children from shape
  if (zodType === "object") {
    children = zodSchemaToParamDocs(innerSchema);
  }

  return {
    name,
    type,
    required,
    enumValues,
    description,
    example,
    children,
  };
}

function extractEnumValues(schema: z.ZodSchema): string[] | undefined {
  // Zod v4 uses `entries` for enum values
  const entries = (schema as any)._def?.entries ?? (schema as any).def?.entries;
  if (entries && typeof entries === "object") {
    return Object.values(entries).filter((v) => typeof v === "string") as string[];
  }
  // Fallback to older `values` property
  const values = (schema as any)._def?.values ?? (schema as any).def?.values;
  if (values && typeof values === "object") {
    return Object.values(values).filter((v) => typeof v === "string") as string[];
  }
  // Try `options` array (also in Zod v4)
  const options = (schema as any).options;
  if (Array.isArray(options)) {
    return options.filter((v) => typeof v === "string");
  }
  return undefined;
}

function getZodTypeName(schema: z.ZodSchema): string {
  const zodType = getZodType(schema);

  if (zodType === "string") {
    // Check for special string formats (Zod v4)
    const format = (schema as any).format ?? (schema as any)._def?.format;
    if (format === "uuid") return "string/uuid";
    if (format === "email") return "string/email";
    if (format === "jwt") return "string/jwt";

    // Check _def.checks for older Zod format
    const checks = (schema as any)._def?.checks ?? [];
    if (Array.isArray(checks)) {
      if (checks.some((c: any) => c.kind === "uuid")) return "string/uuid";
      if (checks.some((c: any) => c.kind === "email")) return "string/email";
      if (checks.some((c: any) => c.kind === "jwt")) return "string/jwt";
    }
    return "string";
  }

  if (zodType === "number") {
    const checks = (schema as any)._def?.checks ?? [];
    if (Array.isArray(checks)) {
      // Zod v3 style
      if (checks.some((c: any) => c.kind === "int")) {
        return "number/integer";
      }
      // Zod v4 style - checks are schema objects with isInt property
      if (checks.some((c: any) => c.isInt === true)) {
        return "number/integer";
      }
    }
    return "number";
  }

  if (zodType === "boolean") return "boolean";

  if (zodType === "array") {
    const element = (schema as any)._def?.element ?? (schema as any).element;
    if (element) {
      const inner = getZodTypeName(element);
      return `${inner}[]`;
    }
    return "array";
  }

  if (isEnumSchema(schema)) {
    return "string/enum";
  }

  if (zodType === "optional") {
    const inner = (schema as any)._def?.innerType ?? (schema as any).def?.innerType;
    if (inner) return getZodTypeName(inner);
    return "unknown";
  }

  if (zodType === "object") return "object";
  if (zodType === "union") return "union";

  return "unknown";
}

type DocsConfig = {
  name: string;
  description: string;
  baseUrl: string;
};

function generateExampleObject(param: ParamDoc): unknown {
  // Use schema-defined example if available
  if (param.example !== undefined) {
    return param.example;
  }

  // If has children, build nested object
  if (param.children && param.children.length > 0) {
    if (param.type.endsWith("[]")) {
      // Array of objects
      const obj: Record<string, unknown> = {};
      for (const child of param.children) {
        obj[child.name] = generateExampleObject(child);
      }
      return [obj];
    } else {
      // Plain object
      const obj: Record<string, unknown> = {};
      for (const child of param.children) {
        obj[child.name] = generateExampleObject(child);
      }
      return obj;
    }
  }

  // Fall back to type-based defaults
  switch (param.type) {
    case "string":
      return "example";
    case "string/uuid":
      return "a8471df2-d595-4914-a00c-a3791c579690";
    case "string/jwt":
      return "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...";
    case "string/email":
      return "user@example.com";
    case "string/enum":
      return param.enumValues?.[0] ?? "value";
    case "number/integer":
      return 10;
    case "number":
      return 0.5;
    case "boolean":
      return true;
    case "object":
      return {};
    case "object[]":
      return [{}];
    case "string[]":
      return ["example"];
    default:
      if (param.type.endsWith("[]")) {
        return [];
      }
      return "...";
  }
}

function generateExampleValue(param: ParamDoc): string {
  return JSON.stringify(generateExampleObject(param));
}

/**
 * Generate documentation from an RPC handler
 */
export function generateDocs(handler: RpcHandler<any>, config: DocsConfig): ApiDoc {
  const rpcs = handler.getRpcDefs();
  const methods: MethodDoc[] = [];

  for (const [methodName, rpc] of Object.entries(rpcs)) {
    const params = zodSchemaToParamDocs((rpc as any).inputValidation);
    const outputSchema = (rpc as any).outputValidation;
    const returns = outputSchema ? zodSchemaToParamDocs(outputSchema) : [];

    methods.push({
      name: methodName,
      params,
      returns,
    });
  }

  return {
    name: config.name,
    description: config.description,
    baseUrl: config.baseUrl,
    methods,
  };
}

/**
 * Generate markdown documentation from ApiDoc
 */
export function generateMarkdownDocs(doc: ApiDoc): string {
  let md = `# ${doc.name}\n\n`;
  md += `${doc.description}\n\n`;
  md += `**Base URL:** \`${doc.baseUrl}\`\n\n`;
  md += `## Authentication\n\n`;
  md += `All API requests require an \`apiKey\` parameter. You can obtain your API key from the project settings in the dashboard.\n\n`;
  md += `## Request Format\n\n`;
  md += `All requests should be sent as POST requests with a JSON body:\n\n`;
  md += "```json\n";
  md += `{\n  "id": "optional-request-id",\n  "method": "methodName",\n  "params": { ... }\n}\n`;
  md += "```\n\n";
  md += `## Response Format\n\n`;
  md += `Successful responses:\n`;
  md += "```json\n";
  md += `{\n  "id": "request-id",\n  "result": { ... }\n}\n`;
  md += "```\n\n";
  md += `Error responses:\n`;
  md += "```json\n";
  md += `{\n  "id": "request-id",\n  "error": {\n    "code": "ERROR_CODE",\n    "hint": "Human readable hint"\n  }\n}\n`;
  md += "```\n\n";
  md += `## Methods\n\n`;

  for (const method of doc.methods) {
    md += `### ${method.name}\n\n`;
    if (method.description) {
      md += `${method.description}\n\n`;
    }

    md += `**Parameters:**\n\n`;
    if (method.params.length === 0) {
      md += `None\n\n`;
    } else {
      md += `| Parameter | Type | Required | Description |\n`;
      md += `|-----------|------|----------|-------------|\n`;
      for (const param of method.params) {
        const enumNote = param.enumValues
          ? ` One of: ${param.enumValues.map((v) => `\`${v}\``).join(", ")}`
          : "";
        md += `| \`${param.name}\` | ${param.type} | ${param.required ? "Yes" : "No"} | ${param.description ?? ""}${enumNote} |\n`;
      }
      md += `\n`;
    }

    md += `**Returns:**\n\n`;
    if (method.returns.length === 0) {
      md += `void\n\n`;
    } else {
      md += `| Field | Type | Description |\n`;
      md += `|-------|------|-------------|\n`;
      const renderReturnRow = (ret: ParamDoc, prefix: string = "") => {
        const enumNote = ret.enumValues
          ? ` One of: ${ret.enumValues.map((v) => `\`${v}\``).join(", ")}`
          : "";
        md += `| \`${prefix}${ret.name}\` | ${ret.type}${ret.required ? "" : " (optional)"} | ${ret.description ?? ""}${enumNote} |\n`;
        // Render children with indentation
        if (ret.children) {
          const childPrefix = ret.type.endsWith("[]") ? `${prefix}${ret.name}[].` : `${prefix}${ret.name}.`;
          for (const child of ret.children) {
            renderReturnRow(child, childPrefix);
          }
        }
      };
      for (const ret of method.returns) {
        renderReturnRow(ret);
      }
      md += `\n`;
    }

    md += `**Example Request:**\n\n`;
    md += "```json\n";
    md += `{\n  "id": "1",\n  "method": "${method.name}",\n  "params": {\n`;
    const exampleParams = method.params
      .filter((p) => p.required)
      .map((p) => `    "${p.name}": ${generateExampleValue(p)}`)
      .join(",\n");
    md += exampleParams ? exampleParams + "\n" : "";
    md += `  }\n}\n`;
    md += "```\n\n";

    md += `**Example Response:**\n\n`;
    md += "```json\n";
    if (method.returns.length === 0) {
      md += `{\n  "id": "1",\n  "result": null\n}\n`;
    } else {
      md += `{\n  "id": "1",\n  "result": {\n`;
      const exampleReturns = method.returns
        .map((r) => `    "${r.name}": ${generateExampleValue(r)}`)
        .join(",\n");
      md += exampleReturns + "\n";
      md += `  }\n}\n`;
    }
    md += "```\n\n";
  }

  return md;
}
