import { serve } from "bun";
import index from "./index.html";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    // app-facing RPC for the customer facing UI to use
    "/app-rpc": (req) => {
      // TODO: implement app RPC
      return new Response("Hello, world!");
    },

    // internal RPC for the admin to use
    "/admin-rpc": (req) => {
      // TODO: implement admin RPC
      return new Response("Hello, world!");
    },

    // customer-facing API to fetch stored webhooks
    "/api-rpc": (req) => {
      // TODO: implement API RPC
      return new Response("Hello, world!");
    },

    // world-facing API for ingestion, webhooks should land here
    "/ingestion/:customerId/l/:latchId": (req) => {
      // TODO: implement customer creation
      // TODO: implement latch creation
      // TODO: store the webhook
      return new Response("Hello, world!");
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
