import { z } from 'zod';

import { escapeHtml, renderDocument } from '@/http/format';
import type { RpcDef, RpcHandler } from '@/lib/rpc/handler';

export type FieldDoc = {
  name: string;
  type: string;
  required: boolean;
  enumValues?: string[];
  fields?: FieldDoc[];
};

export type MethodDoc = {
  name: string;
  description?: string;
  params: FieldDoc[];
  returns: FieldDoc[];
};

export type RpcServiceDocs = {
  name: string;
  description: string;
  endpoint: string;
  auth: {
    type: string;
    authenticatedRequest: { description: string; curl: string };
  };
  methods: MethodDoc[];
};

const zodDef = (schema: z.ZodTypeAny): Record<string, any> =>
  (schema as any)._def ?? (schema as any).def ?? {};

const zodShape = (schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> => {
  const shape = zodDef(schema).shape ?? (schema as any).shape ?? {};
  return typeof shape === 'function' ? shape() : shape;
};

const zodType = (schema: z.ZodTypeAny): string => {
  const def = zodDef(schema);
  if (typeof def.type === 'string') return def.type;
  const traits = (schema as any)._zod?.traits;
  if (traits instanceof Set) {
    if (traits.has('ZodObject')) return 'object';
    if (traits.has('ZodString')) return 'string';
    if (traits.has('ZodNumber')) return 'number';
    if (traits.has('ZodBoolean')) return 'boolean';
    if (traits.has('ZodOptional')) return 'optional';
    if (traits.has('ZodDefault')) return 'default';
    if (traits.has('ZodNullable')) return 'nullable';
    if (traits.has('ZodArray')) return 'array';
    if (traits.has('ZodEnum')) return 'enum';
    if (traits.has('ZodUnknown')) return 'unknown';
  }
  return 'unknown';
};

const innerSchema = (schema: z.ZodTypeAny): z.ZodTypeAny | undefined =>
  zodDef(schema).innerType ?? zodDef(schema).schema;

const arrayElement = (schema: z.ZodTypeAny): z.ZodTypeAny | undefined =>
  zodDef(schema).element ?? (schema as any).element;

const enumValues = (schema: z.ZodTypeAny): string[] | undefined => {
  const entries = zodDef(schema).entries;
  if (entries && typeof entries === 'object') {
    return Object.values(entries).filter((value): value is string => typeof value === 'string');
  }
  const values = zodDef(schema).values ?? (schema as any).options;
  if (Array.isArray(values)) return values.filter((value): value is string => typeof value === 'string');
  return undefined;
};

const unwrap = (schema: z.ZodTypeAny): { schema: z.ZodTypeAny; required: boolean; nullable: boolean } => {
  let current = schema;
  let required = true;
  let nullable = false;
  for (;;) {
    const type = zodType(current);
    if (type === 'optional' || type === 'default') {
      required = false;
      const inner = innerSchema(current);
      if (!inner) break;
      current = inner;
      continue;
    }
    if (type === 'nullable') {
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
  const suffix = nullable ? ' | null' : '';
  if (type === 'string') {
    const format = (schema as any).format ?? zodDef(schema).format;
    const version = zodDef(schema).version;
    if (format === 'uuid' && version === 'v7') return `string/uuidv7${suffix}`;
    if (format === 'uuid') return `string/uuid${suffix}`;
    if (format === 'email') return `string/email${suffix}`;
    return `string${suffix}`;
  }
  if (type === 'number') {
    const checks = zodDef(schema).checks ?? [];
    const isInt = Array.isArray(checks) && checks.some((check: any) => check.kind === 'int' || check.isInt === true);
    return `${isInt ? 'integer' : 'number'}${suffix}`;
  }
  if (type === 'boolean') return `boolean${suffix}`;
  if (type === 'enum') return `string/enum${suffix}`;
  if (type === 'array') {
    const element = arrayElement(schema);
    return `${element ? typeName(unwrap(element).schema) : 'unknown'}[]${suffix}`;
  }
  if (type === 'object') return `object${suffix}`;
  if (type === 'unknown') return `unknown${suffix}`;
  return `${type}${suffix}`;
};

const schemaFields = (schema: z.ZodTypeAny): FieldDoc[] => {
  const unwrapped = unwrap(schema);
  if (zodType(unwrapped.schema) !== 'object') return [];
  return Object.entries(zodShape(unwrapped.schema)).map(([name, field]) => fieldDoc(name, field));
};

const fieldDoc = (name: string, schema: z.ZodTypeAny): FieldDoc => {
  const unwrapped = unwrap(schema);
  const type = zodType(unwrapped.schema);
  const element = type === 'array' ? arrayElement(unwrapped.schema) : undefined;
  const elementUnwrapped = element ? unwrap(element) : undefined;
  const enumSchema = type === 'enum'
    ? unwrapped.schema
    : elementUnwrapped && zodType(elementUnwrapped.schema) === 'enum'
      ? elementUnwrapped.schema
      : undefined;
  return {
    name,
    type: typeName(unwrapped.schema, unwrapped.nullable),
    required: unwrapped.required,
    enumValues: enumSchema ? enumValues(enumSchema) : undefined,
    fields: type === 'object'
      ? schemaFields(unwrapped.schema)
      : elementUnwrapped && zodType(elementUnwrapped.schema) === 'object'
        ? schemaFields(elementUnwrapped.schema)
        : undefined,
  };
};

const rpcMethods = (handler: RpcHandler<any, any>): MethodDoc[] =>
  Object.entries(handler.getRpcDefs() as Record<string, RpcDef<any, any, any, any, any>>)
    .map(([name, rpc]) => ({
      name,
      description: rpc.description,
      params: schemaFields(rpc.inputValidation as z.ZodTypeAny),
      returns: rpc.outputValidation ? schemaFields(rpc.outputValidation as z.ZodTypeAny) : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export const generateRpcDocs = (handler: RpcHandler<any, any>, publicUrl = 'http://localhost:3000'): RpcServiceDocs => ({
  name: 'SlashEvents',
  description: 'Self-hosted webhook storage and polling for a single owner and their clients.',
  endpoint: '/rpc',
  auth: {
    type: 'Bearer token',
    authenticatedRequest: {
      description: 'Every RPC method requires the instance API token. Every holder has full access to all projects.',
      curl: `curl ${shellQuote(new URL('/rpc', publicUrl).href)} \\
  -H "Authorization: Bearer $SLASHEVENTS_API_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"method":"getProjects","params":{}}'`,
    },
  },
  methods: rpcMethods(handler),
});

const codeBlock = (value: string, language = 'sh'): string =>
  `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(value)}</code></pre>`;

const flattenFields = (fields: FieldDoc[], prefix = ''): FieldDoc[] =>
  fields.flatMap((field) => {
    const name = prefix ? `${prefix}.${field.name}` : field.name;
    const current = { ...field, name, fields: undefined };
    const childPrefix = field.type.endsWith('[]') ? `${name}[]` : name;
    return field.fields ? [current, ...flattenFields(field.fields, childPrefix)] : [current];
  });

const fieldTable = (fields: FieldDoc[]): string => {
  const flattened = flattenFields(fields);
  if (flattened.length === 0) return '<p>None.</p>';
  return `<table>
    <thead>
      <tr><th>Name</th><th>Type</th><th>Required</th><th>Values</th></tr>
    </thead>
    <tbody>
      ${flattened.map((field) => `<tr>
        <td><code>${escapeHtml(field.name)}</code></td>
        <td><code>${escapeHtml(field.type)}</code></td>
        <td>${field.required ? 'yes' : 'no'}</td>
        <td>${field.enumValues?.map((value) => `<code>${escapeHtml(value)}</code>`).join(', ') ?? ''}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
};

const methodSection = (method: MethodDoc): string => `<details>
  <summary><strong>${escapeHtml(method.name)}</strong></summary>
  ${method.description ? `<p>${escapeHtml(method.description)}</p>` : ''}
  <h4>Params</h4>
  ${fieldTable(method.params)}
  <h4>Returns</h4>
  ${fieldTable(method.returns)}
</details>`;

export const renderRpcDocsHtml = (docs: RpcServiceDocs): string => renderDocument(
  `${docs.name} API`,
  `<main>
    <p>${escapeHtml(docs.description)}</p>
    <h2>Auth</h2>
    <p>${escapeHtml(docs.auth.authenticatedRequest.description)} Set <code>SLASHEVENTS_API_TOKEN</code> in your client's environment. Rotate it by changing the server configuration, recreating the container, and updating every client.</p>
    ${codeBlock(docs.auth.authenticatedRequest.curl)}
    <h2>Webhooks</h2>
    <p>Create a project, then configure its path allowlist with <code>setProjectWebhookPathAllowlist</code>. New projects reject all ingress until a path is allowed. Send webhooks to <code>/ingress/{projectId}/{path}</code>. Ingress does not use the management API token. Anyone who knows an allowed URL can submit events; validate provider signatures when consuming them.</p>
    <p>Use <code>getEvents</code> to read stored events, optionally long-polling for up to 60 seconds. Use the returned cursor to fetch more pages when <code>hasMore</code> is true. Reading does not acknowledge or delete events; use <code>removeEvent</code> after processing if you want queue-like consumption. Project-created activity is included unless you filter by <code>WEBHOOK_RECEIVED</code>. Configure retention by duration or event count per project; both default to disabled.</p>
    <h2>Transport</h2>
    <p>POST a single JSON object to <code>/rpc</code>. Authentication failures use HTTP 401, rate limits use HTTP 429. Method errors are returned in the JSON <code>error</code> envelope; check it even when the HTTP response is 200.</p>
    <h3>Request</h3>
    ${codeBlock(JSON.stringify({ id: 'optional-id', method: 'getProjects', params: {} }, null, 2), 'json')}
    <h3>Success</h3>
    ${codeBlock(JSON.stringify({ id: 'optional-id', result: { projects: [] } }, null, 2), 'json')}
    <h3>Error</h3>
    ${codeBlock(JSON.stringify({ id: 'optional-id', error: { code: 'ERROR_CODE', hint: 'optional explanation' } }, null, 2), 'json')}
    <h2>Rate Limits</h2>
    <p>RPC requests share an instance limit. Webhook ingress, public pages, and failed authentication attempts are limited by source IP. Limits are configurable through environment variables; 0 disables a limit. Forwarded IPs are accepted only from explicitly trusted proxies.</p>
    <h2>Methods</h2>
    ${docs.methods.map(methodSection).join('')}
  </main>`,
);
