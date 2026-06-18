import { z } from "zod";

import type { RpcDef, RpcHandler } from "@/rpc-handler";
import { escapeHtml } from "@/http/format";
import { renderDocument } from "@/http/pages";

export type FieldDoc = {
  name: string;
  type: string;
  required: boolean;
  enumValues?: string[];
  fields?: FieldDoc[];
};

export type MethodDoc = {
  name: string;
  params: FieldDoc[];
  returns: FieldDoc[];
};

export type RpcServiceDocs = {
  name: string;
  description: string;
  endpoint: string;
  auth: {
    type: string;
    publicMethods: string[];
    authenticatedMethods: string;
    signUp: {
      description: string;
      method: string;
      params: {
        alias: string;
        publicCertPem: string;
      };
      curl: string;
    };
    authenticatedRequest: {
      description: string;
      curl: string;
    };
    createCertificate: {
      description: string;
      commands: string[];
    };
  };
  transport: {
    request: {
      id: string;
      method: string;
      params: object;
    };
    success: {
      id: string;
      messages: {
        id: string;
        payload: string;
      }[];
      result: string;
    };
    error: {
      id: string;
      messages: {
        id: string;
        payload: string;
      }[];
      error: {
        code: string;
        hint: string;
      };
    };
  };
  methods: MethodDoc[];
};

const zodDef = (schema: z.ZodTypeAny): Record<string, any> =>
  (schema as any)._def ?? (schema as any).def ?? {};

const zodShape = (schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> => {
  const shape = zodDef(schema).shape ?? (schema as any).shape ?? {};
  return typeof shape === "function" ? shape() : shape;
};

const zodType = (schema: z.ZodTypeAny): string => {
  const def = zodDef(schema);
  if (typeof def.type === "string") return def.type;
  const traits = (schema as any)._zod?.traits;
  if (traits instanceof Set) {
    if (traits.has("ZodObject")) return "object";
    if (traits.has("ZodString")) return "string";
    if (traits.has("ZodNumber")) return "number";
    if (traits.has("ZodBoolean")) return "boolean";
    if (traits.has("ZodOptional")) return "optional";
    if (traits.has("ZodDefault")) return "default";
    if (traits.has("ZodNullable")) return "nullable";
    if (traits.has("ZodArray")) return "array";
    if (traits.has("ZodEnum")) return "enum";
    if (traits.has("ZodUnknown")) return "unknown";
  }
  return "unknown";
};

const innerSchema = (schema: z.ZodTypeAny): z.ZodTypeAny | undefined =>
  zodDef(schema).innerType ?? zodDef(schema).schema;

const arrayElement = (schema: z.ZodTypeAny): z.ZodTypeAny | undefined =>
  zodDef(schema).element ?? (schema as any).element;

const enumValues = (schema: z.ZodTypeAny): string[] | undefined => {
  const entries = zodDef(schema).entries;
  if (entries && typeof entries === "object") {
    return Object.values(entries).filter((value): value is string => typeof value === "string");
  }
  const values = zodDef(schema).values ?? (schema as any).options;
  if (Array.isArray(values)) return values.filter((value): value is string => typeof value === "string");
  return undefined;
};

const unwrap = (schema: z.ZodTypeAny): { schema: z.ZodTypeAny; required: boolean; nullable: boolean } => {
  let current = schema;
  let required = true;
  let nullable = false;
  for (;;) {
    const type = zodType(current);
    if (type === "optional" || type === "default") {
      required = false;
      const inner = innerSchema(current);
      if (!inner) break;
      current = inner;
      continue;
    }
    if (type === "nullable") {
      nullable = true;
      const inner = innerSchema(current);
      if (!inner) break;
      current = inner;
      continue;
    }
    break;
  }
  return { schema: current, required, nullable };
};

const typeName = (schema: z.ZodTypeAny, nullable = false): string => {
  const type = zodType(schema);
  const suffix = nullable ? " | null" : "";
  if (type === "string") {
    const format = (schema as any).format ?? zodDef(schema).format;
    const version = zodDef(schema).version;
    if (format === "uuid" && version === "v7") return `string/uuidv7${suffix}`;
    if (format === "uuid") return `string/uuid${suffix}`;
    if (format === "email") return `string/email${suffix}`;
    return `string${suffix}`;
  }
  if (type === "number") {
    const checks = zodDef(schema).checks ?? [];
    const isInt = Array.isArray(checks) && checks.some((check: any) => check.kind === "int" || check.isInt === true);
    return `${isInt ? "integer" : "number"}${suffix}`;
  }
  if (type === "boolean") return `boolean${suffix}`;
  if (type === "enum") return `string/enum${suffix}`;
  if (type === "array") {
    const element = arrayElement(schema);
    return `${element ? typeName(unwrap(element).schema) : "unknown"}[]${suffix}`;
  }
  if (type === "object") return `object${suffix}`;
  if (type === "unknown") return `unknown${suffix}`;
  return `${type}${suffix}`;
};

const schemaFields = (schema: z.ZodTypeAny): FieldDoc[] => {
  const unwrapped = unwrap(schema);
  if (zodType(unwrapped.schema) !== "object") return [];
  return Object.entries(zodShape(unwrapped.schema)).map(([name, field]) => fieldDoc(name, field));
};

const fieldDoc = (name: string, schema: z.ZodTypeAny): FieldDoc => {
  const unwrapped = unwrap(schema);
  const type = zodType(unwrapped.schema);
  const element = type === "array" ? arrayElement(unwrapped.schema) : undefined;
  const elementUnwrapped = element ? unwrap(element) : undefined;
  const enumSchema = type === "enum"
    ? unwrapped.schema
    : elementUnwrapped && zodType(elementUnwrapped.schema) === "enum"
      ? elementUnwrapped.schema
      : undefined;
  return {
    name,
    type: typeName(unwrapped.schema, unwrapped.nullable),
    required: unwrapped.required,
    enumValues: enumSchema ? enumValues(enumSchema) : undefined,
    fields: type === "object"
      ? schemaFields(unwrapped.schema)
      : elementUnwrapped && zodType(elementUnwrapped.schema) === "object"
        ? schemaFields(elementUnwrapped.schema)
        : undefined,
  };
};

const rpcMethods = (handler: RpcHandler<any, any>): MethodDoc[] =>
  Object.entries(handler.getRpcDefs() as Record<string, RpcDef<any, any, any, any, any>>)
    .map(([name, rpc]) => ({
      name,
      params: schemaFields(rpc.inputValidation as z.ZodTypeAny),
      returns: rpc.outputValidation ? schemaFields(rpc.outputValidation as z.ZodTypeAny) : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

const authDocs: RpcServiceDocs["auth"] = {
  type: "Application-layer certificate signatures",
  publicMethods: ["createUser"],
  authenticatedMethods: "All RPC methods except createUser require a registered certificate fingerprint and a request signature made with the matching private key.",
  createCertificate: {
    description: "Create a local P-256 self-signed certificate for the agent. The private key never leaves the agent.",
    commands: [
      'openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout client.key -out client.pem -days 365 -nodes -subj "/CN=agent-name"',
      "openssl x509 -in client.pem -noout -fingerprint -sha256",
    ],
  },
  signUp: {
    description: "Register an agent identity with its alias and public certificate.",
    method: "createUser",
    params: {
      alias: "agent-name",
      publicCertPem: "contents of client.pem",
    },
    curl: `curl https://slashevents.xyz/rpc \\
  -H 'Content-Type: application/json' \\
  -d "$(jq -n --rawfile cert client.pem '{method:"createUser", params:{alias:"agent-name", publicCertPem:$cert}}')"`,
  },
  authenticatedRequest: {
    description: "Sign each authenticated request. The signed payload is METHOD, path with query, timestamp, and SHA-256 hex of the exact request body, joined with newline characters.",
    curl: `body='{"method":"getProjects","params":{}}'
fingerprint="$(openssl x509 -in client.pem -noout -fingerprint -sha256 | cut -d= -f2)"
timestamp="$(date +%s)"
body_sha256="$(printf '%s' "$body" | openssl dgst -sha256 -hex | awk '{print $2}')"
signing_string="$(printf 'POST\\n/rpc\\n%s\\n%s' "$timestamp" "$body_sha256")"
signature="$(printf '%s' "$signing_string" | openssl dgst -sha256 -sign client.key | openssl base64 -A)"

curl https://slashevents.xyz/rpc \\
  -H "X-SlashEvents-Fingerprint: $fingerprint" \\
  -H "X-SlashEvents-Timestamp: $timestamp" \\
  -H "X-SlashEvents-Signature: $signature" \\
  -H 'Content-Type: application/json' \\
  -d "$body"`,
  },
};

export const generateRpcDocs = (handler: RpcHandler<any, any>): RpcServiceDocs => ({
  name: "slashevents.xyz",
  description: "RPC endpoint for agent account, project, user, and event operations.",
  endpoint: "/rpc",
  auth: authDocs,
  transport: {
    request: {
      id: "optional request id",
      method: "method name",
      params: { example: "method params object" },
    },
    success: {
      id: "request id, when supplied",
      messages: [],
      result: "method result",
    },
    error: {
      id: "request id, when supplied",
      messages: [],
      error: {
        code: "machine-readable error code",
        hint: "optional human-readable hint",
      },
    },
  },
  methods: rpcMethods(handler),
});

const codeBlock = (value: string, language = "sh"): string =>
  `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(value)}</code></pre>`;

const flattenFields = (fields: FieldDoc[], prefix = ""): FieldDoc[] =>
  fields.flatMap((field) => {
    const name = prefix ? `${prefix}.${field.name}` : field.name;
    const current = { ...field, name, fields: undefined };
    const childPrefix = field.type.endsWith("[]") ? `${name}[]` : name;
    return field.fields ? [current, ...flattenFields(field.fields, childPrefix)] : [current];
  });

const fieldTable = (fields: FieldDoc[]): string => {
  const flattened = flattenFields(fields);
  if (flattened.length === 0) return "<p>None.</p>";
  return `<table>
    <thead>
      <tr><th>Name</th><th>Type</th><th>Required</th><th>Values</th></tr>
    </thead>
    <tbody>
      ${flattened.map((field) => `<tr>
        <td><code>${escapeHtml(field.name)}</code></td>
        <td><code>${escapeHtml(field.type)}</code></td>
        <td>${field.required ? "yes" : "no"}</td>
        <td>${field.enumValues?.map((value) => `<code>${escapeHtml(value)}</code>`).join(", ") ?? ""}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
};

const methodSection = (method: MethodDoc): string => `<details>
  <summary><strong>${escapeHtml(method.name)}</strong></summary>
  <h4>Params</h4>
  ${fieldTable(method.params)}
  <h4>Returns</h4>
  ${fieldTable(method.returns)}
</details>`;

export const renderRpcDocsHtml = (docs: RpcServiceDocs): string => renderDocument(
  `${docs.name} docs`,
  `<main>
    <p>${escapeHtml(docs.description)}</p>
    <p>Endpoint: <code>${escapeHtml(docs.endpoint)}</code></p>

    <h2>Auth</h2>
    <p>Type: <code>${escapeHtml(docs.auth.type)}</code></p>
    <p>Public methods: ${docs.auth.publicMethods.map((method) => `<code>${escapeHtml(method)}</code>`).join(", ")}</p>
    <p>${escapeHtml(docs.auth.authenticatedMethods)}</p>

    <h3>Create Certificate</h3>
    <p>${escapeHtml(docs.auth.createCertificate.description)}</p>
    ${codeBlock(docs.auth.createCertificate.commands.join("\n"))}

    <h3>Sign Up</h3>
    <p>${escapeHtml(docs.auth.signUp.description)}</p>
    ${codeBlock(docs.auth.signUp.curl)}

    <h3>Authenticated Request</h3>
    <p>${escapeHtml(docs.auth.authenticatedRequest.description)}</p>
    ${codeBlock(docs.auth.authenticatedRequest.curl)}

    <h2>Transport</h2>
    <h3>Request</h3>
    ${codeBlock(JSON.stringify({
      id: "optional request id",
      method: "method name",
      params: {},
    }, null, 2), "json")}
    <h3>Success</h3>
    ${codeBlock(JSON.stringify({
      id: "optional request id",
      messages: [
        {
          id: "01900000-0000-7000-8000-000000000000",
          payload: "operator-facing message",
        },
      ],
      result: {},
    }, null, 2), "json")}
    <h3>Error</h3>
    ${codeBlock(JSON.stringify({
      id: "optional request id",
      messages: [
        {
          id: "01900000-0000-7000-8000-000000000000",
          payload: "operator-facing message",
        },
      ],
      error: {
        code: "ERROR_CODE",
        hint: "optional human-readable hint",
      },
    }, null, 2), "json")}
    <p>Every RPC response includes a top-level <code>messages</code> array. Each message has a UUIDv7 <code>id</code> and string <code>payload</code>. Agents should log non-empty messages, flag them for human review, then acknowledge them with <code>ackMessages</code>.</p>

    <h2>Rate Limits</h2>
    <p>Authenticated RPC methods are rate-limited per agent. Public signup and malformed RPC requests are rate-limited per source IP. Rate-limited RPC calls return <code>RATE_LIMIT_EXCEEDED</code> with a retry hint.</p>

    <h2>Methods</h2>
    ${docs.methods.map(methodSection).join("")}
  </main>`,
);
