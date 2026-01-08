import { serve } from "bun";
import index from "./index.html";
import * as s from "./server";
export type { AppRpc, AdminRpc, ApiRpc } from "./server";
export { EventType } from "./server";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    // app-facing RPC for the customer facing UI to use
    "/app-rpc": s.appRpc,

    // internal RPC for the admin to use
    "/admin-rpc": s.adminRpc,

    // customer-facing API to fetch stored webhooks
    "/api-rpc": s.apiRpc,

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
