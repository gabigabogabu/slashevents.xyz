import { serve } from "bun";
import index from "./index.html";
import * as s from "./server";
import { generateDocs, generateMarkdownDocs } from "./server/docs/generate-docs";
export type { AppRpc, AdminRpc, ApiRpc } from "./server";

enum HttpStatus {
  OK = 200,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  SERVER_ERROR = 500,
}

type RpcHandlerLike = {
  handle: (request: unknown) => Promise<unknown>;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const handleBunServe = (handler: RpcHandlerLike) => {
  return async (req: Request): Promise<Response> => {
    try {
      const rpcReq = await req.json();
      const result = await handler.handle(rpcReq);

      if (isObject(result) && "error" in result) {
        return Response.json(result, { status: HttpStatus.BAD_REQUEST });
      }

      const id = isObject(result) ? result.id : undefined;
      if (id === null || id === undefined) {
        return new Response(null, { status: HttpStatus.NO_CONTENT });
      }

      return Response.json(result, { status: HttpStatus.OK });
    } catch (error) {
      console.error("Unhandled error in RPC handler", error);
      return new Response(null, { status: HttpStatus.SERVER_ERROR });
    }
  };
};

const apiDocs = generateDocs(s.apiRpcHandler, {
  name: "slashevents.io API",
  description: "RPC API for retrieving webhook events from your projects.",
  baseUrl: "/api-rpc",
});
const apiDocsMarkdown = generateMarkdownDocs(apiDocs);

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    // app-facing RPC for the customer facing UI to use
    "/app-rpc": handleBunServe(s.appRpcHandler),
    // internal RPC for customer support and operations to use
    "/admin-rpc": handleBunServe(s.adminRpcHandler),
    // customer-facing API
    "/api-rpc": handleBunServe(s.apiRpcHandler),

    // world-facing API for ingestion, webhooks should land here
    "/ingress/:projectId/*": (req, server) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      // Path format: /ingress/:projectId/rest/of/path
      const projectId = pathParts[2];
      if (!projectId)
        return new Response(JSON.stringify({ error: "WRONG_INGRESS_PATH" }), { status: 400 });
      const restOfPath = pathParts.slice(3).join("/");
      return s.handleWebhook(req, server, projectId, restOfPath);
    },

    "/health/liveness": s.isAppAlive,
    "/health/readiness": s.isAppReady,

    // API documentation endpoints
    "/docs/api.json": () => Response.json(apiDocs),
    "/docs/api.md": () => new Response(apiDocsMarkdown, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    }),
  },
  error: (error) => {
    console.error('Unhandled error in server', error);
    console.dir({ message: 'Unhandled error in server', error }, { depth: null });
    return new Response(null, { status: 500 });
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);

const shutdown = async (signal: string) => {
  console.log(`Shutting down server on ${signal}`);
  await s.closeServer();
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
