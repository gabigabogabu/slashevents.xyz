# slashevents.xyz

## Commands

```sh
npm run dev      # Start the Bun server in watch mode
npm run start    # Start the production server
npm run build    # Typecheck with tsc
npm test         # Run tests with Bun
npm run test:dev # Run tests in watch mode
```

Prerequisite for DB-backed tests: `docker compose up -d` to start local Postgres on port 5432.

## Architecture

The app is a Bun HTTP server started from `src/index.ts` using `Bun.serve({ routes })`.

- `src/index.ts` defines the RPC method table, the small HTTP router, and handlers.
- `src/db/init.ts` uses `bun.SQL` for database access.
- Tests use Bun's built-in test runner.

## Current Direction

- No React frontend.
- Use the RPC surface for agent operations.
- Authenticated RPC uses application-layer certificate signatures. There is no bearer-token auth and no TLS client certificate auth.
- No Express.
- Use Bun as the JavaScript runtime and package manager.
- Public HTTP paths are limited to `/`, `/rpc`, `/docs`, `/ingress/:projectId/*`, and health checks.
- `/` and `/docs` return HTML; `/rpc` and `/ingress/:projectId/*` return JSON.
