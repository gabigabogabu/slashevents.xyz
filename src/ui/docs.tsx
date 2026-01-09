import { Link } from "@/ui/router";
import type { ApiDoc, ParamDoc } from "@/server/docs/generate-docs";

type DocsUIProps = {
  doc: ApiDoc;
};

function PropTable({ params, showRequired = true, showExample = true }: { params: ParamDoc[]; showRequired?: boolean; showExample?: boolean }) {
  if (params.length === 0) {
    return <p className="text-muted-foreground italic">None</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-4 font-medium">Field</th>
            <th className="text-left py-2 pr-4 font-medium">Type</th>
            {showRequired && <th className="text-left py-2 pr-4 font-medium">Required</th>}
            <th className="text-left py-2 font-medium">Description</th>
            {showExample && <th className="text-left py-2 font-medium">Example</th>}
          </tr>
        </thead>
        <tbody>
          {params.map((param) => (
            <tr key={param.name} className="border-b border-border/50">
              <td className="py-2 pr-4">
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm">{param.name}</code>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {param.type}
                {!param.required && !showRequired && <span className="text-xs ml-1">(optional)</span>}
              </td>
              {showRequired && (
                <td className="py-2 pr-4">
                  {param.required ? (
                    <span className="text-amber-600 dark:text-amber-400">Yes</span>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </td>
              )}
              <td className="py-2 text-muted-foreground">
                {param.description}
                {param.enumValues && (
                  <span className="block text-xs mt-1">
                    One of:{" "}
                    {param.enumValues.map((v, i) => (
                      <span key={v}>
                        <code className="bg-muted px-1 py-0.5 rounded">{v}</code>
                        {i < param.enumValues!.length - 1 && ", "}
                      </span>
                    ))}
                  </span>
                )}
              </td>
              {showExample && (
                <td className="py-2 text-muted-foreground">
                  <code className="bg-muted px-1.5 py-0.5 rounded text-sm">{JSON.stringify(generateExampleValue(param), null, 2)}</code>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function flattenParams(params: ParamDoc[], prefix: string = ""): { param: ParamDoc; displayName: string; depth: number }[] {
  const result: { param: ParamDoc; displayName: string; depth: number }[] = [];
  const depth = prefix.split(".").filter(Boolean).length;
  
  for (const param of params) {
    const displayName = prefix + param.name;
    result.push({ param, displayName, depth });
    
    if (param.children) {
      const childPrefix = param.type.endsWith("[]") ? `${displayName}[].` : `${displayName}.`;
      result.push(...flattenParams(param.children, childPrefix));
    }
  }
  
  return result;
}

function ReturnsTable({ returns }: { returns: ParamDoc[] }) {
  if (returns.length === 0) {
    return <p className="text-muted-foreground italic">void</p>;
  }

  const flattened = flattenParams(returns);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-4 font-medium">Field</th>
            <th className="text-left py-2 pr-4 font-medium">Type</th>
            <th className="text-left py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {flattened.map(({ param, displayName, depth }) => (
            <tr key={displayName} className="border-b border-border/50">
              <td className="py-2 pr-4">
                <code 
                  className="bg-muted px-1.5 py-0.5 rounded text-sm"
                  style={{ marginLeft: depth * 12 }}
                >
                  {displayName}
                </code>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {param.type}
                {!param.required && <span className="text-xs ml-1">(optional)</span>}
              </td>
              <td className="py-2 text-muted-foreground">
                {param.description}
                {param.enumValues && (
                  <span className="block text-xs mt-1">
                    One of:{" "}
                    {param.enumValues.map((v, i) => (
                      <span key={v}>
                        <code className="bg-muted px-1 py-0.5 rounded">{v}</code>
                        {i < param.enumValues!.length - 1 && ", "}
                      </span>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ children, language }: { children: string; language?: string }) {
  return (
    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
      <code>{children}</code>
    </pre>
  );
}

function generateExampleValue(param: ParamDoc): unknown {
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
        obj[child.name] = generateExampleValue(child);
      }
      return [obj];
    } else {
      // Plain object
      const obj: Record<string, unknown> = {};
      for (const child of param.children) {
        obj[child.name] = generateExampleValue(child);
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
    case "string/email":
      return "user@example.com";
    case "string/jwt":
      return "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...";
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

function ExampleRequest({ methodName, params }: { methodName: string; params: ParamDoc[] }) {
  const requiredParams = params.filter((p) => p.required);
  const exampleObj: Record<string, unknown> = {};

  for (const param of requiredParams) {
    exampleObj[param.name] = generateExampleValue(param);
  }

  const example = {
    id: "1",
    method: methodName,
    params: exampleObj,
  };

  return <CodeBlock language="json">{JSON.stringify(example, null, 2)}</CodeBlock>;
}

function ExampleResponse({ returns }: { returns: ParamDoc[] }) {
  if (returns.length === 0) {
    return <CodeBlock language="json">{`{\n  "id": "1",\n  "result": null\n}`}</CodeBlock>;
  }

  const resultObj: Record<string, unknown> = {};
  for (const ret of returns) {
    resultObj[ret.name] = generateExampleValue(ret);
  }

  const example = {
    id: "1",
    result: resultObj,
  };

  return <CodeBlock language="json">{JSON.stringify(example, null, 2)}</CodeBlock>;
}

function Sidebar({ doc }: { doc: ApiDoc }) {
  return (
    <aside className="w-56 shrink-0">
      <nav className="sticky top-8">
        <div className="text-sm font-medium text-muted-foreground mb-2">Overview</div>
        <ul className="space-y-1 mb-6">
          <li>
            <a
              href="#base-url"
              className="block py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Base URL
            </a>
          </li>
          <li>
            <a
              href="#authentication"
              className="block py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Authentication
            </a>
          </li>
          <li>
            <a
              href="#request-format"
              className="block py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Request Format
            </a>
          </li>
          <li>
            <a
              href="#response-format"
              className="block py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Response Format
            </a>
          </li>
        </ul>

        <div className="text-sm font-medium text-muted-foreground mb-2">Methods</div>
        <ul className="space-y-1">
          {doc.methods.map((method) => (
            <li key={method.name}>
              <a
                href={`#${method.name}`}
                className="block py-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-mono"
              >
                {method.name}
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-6 pt-6 border-t">
          <a
            href="/docs/api.md"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View as Markdown
          </a>
        </div>
      </nav>
    </aside>
  );
}

export function DocsUI({ doc }: DocsUIProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <Link 
            to="/" 
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to home
          </Link>
          <h1 className="text-3xl font-bold mt-2">{doc.name}</h1>
          <p className="text-muted-foreground mt-1">{doc.description}</p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 flex gap-12">
        <Sidebar doc={doc} />

        <main className="flex-1 min-w-0">
          <section id="base-url" className="mb-12 scroll-mt-8">
            <h2 className="text-2xl font-semibold mb-4">Base URL</h2>
            <CodeBlock>{doc.baseUrl}</CodeBlock>
          </section>

          <section id="authentication" className="mb-12 scroll-mt-8">
            <h2 className="text-2xl font-semibold mb-4">Authentication</h2>
            <p className="text-muted-foreground mb-4">
              All API requests require an <code className="bg-muted px-1.5 py-0.5 rounded">apiKey</code> parameter. 
              You can obtain your API key from the project settings in the dashboard.
            </p>
          </section>

          <section id="request-format" className="mb-12 scroll-mt-8">
            <h2 className="text-2xl font-semibold mb-4">Request Format</h2>
            <p className="text-muted-foreground mb-4">
              All requests should be sent as POST requests with a JSON body:
            </p>
            <CodeBlock language="json">{`{
  "id": "optional-request-id",
  "method": "methodName",
  "params": { ... }
}`}</CodeBlock>
          </section>

          <section id="response-format" className="mb-12 scroll-mt-8">
            <h2 className="text-2xl font-semibold mb-4">Response Format</h2>
            <p className="text-muted-foreground mb-2">Successful responses:</p>
            <CodeBlock language="json">{`{
  "id": "request-id",
  "result": { ... }
}`}</CodeBlock>
            <p className="text-muted-foreground mt-4 mb-2">Error responses:</p>
            <CodeBlock language="json">{`{
  "id": "request-id",
  "error": {
    "code": "ERROR_CODE",
    "hint": "Human readable hint"
  }
}`}</CodeBlock>
          </section>

          <section id="methods" className="scroll-mt-8">
            <h2 className="text-2xl font-semibold mb-6">Methods</h2>
            
            <div className="space-y-10">
              {doc.methods.map((method) => (
                <div key={method.name} id={method.name} className="border rounded-lg p-6 bg-card scroll-mt-8">
                  <h3 className="text-xl font-semibold mb-2">
                    <code className="bg-primary/10 text-primary px-2 py-1 rounded">{method.name}</code>
                  </h3>
                  {method.description && (
                    <p className="text-muted-foreground mb-4">{method.description}</p>
                  )}

                  <div className="space-y-6">
                    <div>
                      <h4 className="font-medium mb-3">Parameters</h4>
                      <PropTable params={method.params} />
                    </div>

                    <div>
                      <h4 className="font-medium mb-3">Returns</h4>
                      <ReturnsTable returns={method.returns} />
                    </div>

                    <div>
                      <h4 className="font-medium mb-3">Example Request</h4>
                      <ExampleRequest methodName={method.name} params={method.params} />
                    </div>

                    <div>
                      <h4 className="font-medium mb-3">Example Response</h4>
                      <ExampleResponse returns={method.returns} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>

      <footer className="border-t mt-12">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>slashevents.io API Documentation</p>
        </div>
      </footer>
    </div>
  );
}
