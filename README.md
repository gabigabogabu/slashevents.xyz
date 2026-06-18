---
description: README.md
alwaysApply: true
---
# slashevents.xyz

Never lose a webhook.

slashevents.xyz receives webhook requests, stores them as project events, and exposes agent operations through a JSON RPC endpoint.

## Interface

- `/` serves human usage docs with curl examples.
- `/docs` serves generated agent-facing HTML docs.
- `/rpc` accepts JSON RPC-style method calls.
- `/ingress/:projectId/*` accepts incoming webhook requests for exact allowlisted project paths. Projects fail closed until their allowlist is configured.
- `/` and `/docs` return HTML.
- `/rpc` and `/ingress/:projectId/*` return JSON.
- Errors render as JSON for resource routes and HTML for page routes.
- `longPollDurationSeconds` on `getEvents` waits for matching new events for up to 60 seconds.

RPC request bodies use a single JSON object:

```json
{ "id": "optional-id", "method": "methodName", "params": {} }
```

Successful responses contain `{ "id": "...", "messages": [], "result": ... }`. Errors contain `{ "id": "...", "messages": [], "error": { "code": "...", "hint": "..." } }`.

Each message is `{ "id": "<uuidv7>", "payload": "..." }`. Agents should log non-empty messages, flag them for human review, and acknowledge them with `ackMessages`.

## Authentication

The service is agent-first. Authenticated routes require application-layer certificate signatures. Agents register a public certificate and sign each authenticated RPC request with the matching private key.

Create a local client certificate:

```sh
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout client.key -out client.pem -days 365 -nodes -subj "/CN=agent-name"
openssl x509 -in client.pem -noout -fingerprint -sha256
```

Create an agent account:

```sh
curl https://slashevents.xyz/rpc \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --rawfile cert client.pem '{method:"createUser", params:{alias:"agent-name", publicCertPem:$cert}}')"
```

Use the private key to sign authenticated requests:

```sh
body='{"method":"getProjects","params":{}}'
fingerprint="$(openssl x509 -in client.pem -noout -fingerprint -sha256 | cut -d= -f2)"
timestamp="$(date +%s)"
body_sha256="$(printf '%s' "$body" | openssl dgst -sha256 -hex | awk '{print $2}')"
signing_string="$(printf 'POST\n/rpc\n%s\n%s' "$timestamp" "$body_sha256")"
signature="$(printf '%s' "$signing_string" | openssl dgst -sha256 -sign client.key | openssl base64 -A)"

curl https://slashevents.xyz/rpc \
  -H "X-SlashEvents-Fingerprint: $fingerprint" \
  -H "X-SlashEvents-Timestamp: $timestamp" \
  -H "X-SlashEvents-Signature: $signature" \
  -H 'Content-Type: application/json' \
  -d "$body"
```

The signature payload is `METHOD`, path with query, timestamp, and SHA-256 hex of the exact request body, joined with newline characters. Missing, unknown, revoked, expired, not-yet-valid, and invalidly signed certificates are rejected.

## Core RPC Methods

- `createUser`: create an agent account from `alias` and `publicCertPem`.
- `ackMessages`: acknowledge operator-facing messages after they have been logged and surfaced.
- `getProjects`: list visible projects.
- `createProject`: create a project.
- `getProject`: get a project.
- `getProjectUsers`: list project users.
- `addUserToProject`: add an agent account to a project.
- `updateProjectUserPermissions`: replace a project user's permissions.
- `removeUserFromProject`: remove a user from a project.
- `setProjectWebhookPathAllowlist`: replace the exact ingress paths accepted for a project, such as `/stripe`.
- `getEvents`: retrieve project events, optionally with long polling.
- `ANY /ingress/:projectId/*`: capture an incoming webhook request.
- `GET /health/liveness`: database liveness check.
- `GET /health/readiness`: database and migration readiness check.

## Environment

- `DATABASE_URL`: Postgres connection string.
- `PORT`: server port.

## Runtime

The service runs on Bun and uses `Bun.serve({ routes })`.

## Database

Primary keys use PostgreSQL 18 `uuidv7()` defaults.

- `users`: agent identities. Stores display name, certificate fingerprint, public cert PEM, subject, validity metadata, and revoked state.
- `projects`: projects created by users.
- `project_user_permissions`: many-to-many project permissions for users.
- `events`: unified webhook and project activity events. Event-specific payloads are stored in `data JSONB`.
- `migrations.migrations`: applied migration names.

Users do not have a `project_id` column. Project membership and authorization are represented only through `project_user_permissions`.

## Commands

```sh
npm run dev      # Start the Bun server in watch mode
npm run start    # Start the production server
npm run build    # Typecheck with tsc
npm test         # Run tests with Bun
npm run test:dev # Run tests in watch mode
```

DB-backed tests require local Postgres. The current migrations expect PostgreSQL 18 or newer because they use `uuidv7()`.
