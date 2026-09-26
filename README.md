# SlashEvents

Self-hosted webhook storage and polling. Receive webhooks, retain their payloads in Postgres, and let clients read or long-poll an events API.

SlashEvents is MIT licensed, single-owner software. One instance API token grants access to all projects, and Postgres is the only external dependency. The supported release artifact is a Docker image for Linux AMD64 and ARM64.

## Run with Docker Compose

Download [`docker-compose.yml`](https://raw.githubusercontent.com/gabigabogabu/slashevents.xyz/main/docker-compose.yml) and [`.env.example`](https://raw.githubusercontent.com/gabigabogabu/slashevents.xyz/main/.env.example) into a directory, then:

```sh
cp .env.example .env
openssl rand -hex 32  # use the result as POSTGRES_PASSWORD
openssl rand -hex 32  # use a different result as SLASHEVENTS_API_TOKEN
# Fill in both values in .env, then:
chmod 600 .env
docker compose up -d
docker compose ps
curl --fail http://localhost:3000/health/readiness
```

Open `http://localhost:3000/docs` for the API reference. Compose pulls `ghcr.io/gabigabogabu/slashevents:0.2.0`, starts Postgres 18, and stores database data in the `postgres-data` volume. It publishes the app on loopback by default and keeps the database on the internal Docker network.

The app runs as a non-root user with a read-only filesystem. Schema migrations run automatically before the HTTP listener starts. Configuration or migration failures stop the process with a nonzero exit code.

## Use an existing database

Postgres 18 is the supported database version; the schema uses its `uuidv7()` function. The database role needs permission to create schemas and tables. Use a direct/session connection: long polling uses PostgreSQL LISTEN/NOTIFY, so transaction-mode poolers are unsuitable.

Create a private environment file containing `DATABASE_URL`, `SLASHEVENTS_API_TOKEN`, and `PUBLIC_URL`, then:

```sh
docker run -d --name slashevents --restart unless-stopped \
  --env-file ./runtime.env \
  -p 127.0.0.1:3000:3000 \
  ghcr.io/gabigabogabu/slashevents:0.2.0
```

Use a dedicated database. `DATABASE_URL` is a PostgreSQL connection URL with URL-encoded credentials. Compose constructs this URL from `POSTGRES_PASSWORD`; generate that password as hex to avoid escaping issues.

## First webhook

Set `SLASHEVENTS_API_TOKEN` in your client shell to the same value configured on the server. Anyone with this token has full access to every project.

```sh
curl http://localhost:3000/rpc \
  -H "Authorization: Bearer $SLASHEVENTS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"method":"createProject","params":{"name":"My webhooks"}}'
```

Copy `result.projectId` from the response into `PROJECT_ID`:

```sh
PROJECT_ID=your-project-id
curl http://localhost:3000/rpc \
  -H "Authorization: Bearer $SLASHEVENTS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"method\":\"setProjectWebhookPathAllowlist\",\"params\":{\"projectId\":\"$PROJECT_ID\",\"paths\":[\"/hooks\"]}}"

curl "http://localhost:3000/ingress/$PROJECT_ID/hooks" \
  -H 'Content-Type: application/json' -d '{"hello":"world"}'

curl http://localhost:3000/rpc \
  -H "Authorization: Bearer $SLASHEVENTS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"method\":\"getEvents\",\"params\":{\"projectId\":\"$PROJECT_ID\",\"type\":\"WEBHOOK_RECEIVED\",\"longPollDurationSeconds\":30}}"
```

New projects reject all ingress until an allowlist is set. Patterns are full-match regular expressions against the path after `/ingress/{projectId}`. Webhook ingress does not require the management token; anyone who knows an allowed URL can submit events. Validate provider signatures in the consuming client.

RPC responses contain `result` or `error`; inspect the JSON even when HTTP status is 200. Projects also record a `PROJECT_CREATED` activity event. Retention duration and maximum event count default to unlimited; configure them per project with `setProjectRetentionConfig` to control disk usage.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required outside Compose | Postgres connection URL |
| `SLASHEVENTS_API_TOKEN` | Required | Random token, 32–256 letters, digits, `_` or `-` |
| `PUBLIC_URL` | `http://localhost:3000` | Public HTTP(S) origin for generated API examples; no path prefix |
| `PORT` | `3000` | Container HTTP port; in Compose, the host port |
| `BIND_ADDRESS` | `127.0.0.1` | Compose host bind address |
| `POSTGRES_PASSWORD` | Required by Compose | Postgres password |
| `SLASHEVENTS_IMAGE` | `ghcr.io/gabigabogabu/slashevents:0.2.0` | Compose image version or digest |
| `TRUSTED_PROXY_CIDRS` | Empty | Comma-separated trusted proxy IPs/CIDRs for `X-Forwarded-For` |
| `RPC_RATE_LIMIT_PER_MINUTE` | `120` | Shared across authenticated RPC clients |
| `INGRESS_RATE_LIMIT_PER_MINUTE` | `120` | Per source IP |
| `PUBLIC_RATE_LIMIT_PER_MINUTE` | `60` | Landing page, docs, and unknown routes, per IP |
| `AUTH_FAILURE_RATE_LIMIT_PER_MINUTE` | `20` | Failed authentication attempts, per IP |
| `MAX_REQUEST_BODY_BYTES` | `1048576` | Maximum request body size |
| `RETENTION_INTERVAL_SECONDS` | `60` | Background cleanup interval |
| `NODE_ENV` | `production` in the image | Runtime environment |

Set an individual rate limit to `0` to disable it. Limits are held in memory per app process and reset on restart. All holders share the same management token; rotate it by updating the configuration, recreating the app container, and updating clients. There is no per-client revocation or identity tracking.

## HTTPS and reverse proxies

Terminate TLS at your reverse proxy, forward to port 3000, and set `PUBLIC_URL` to the public origin. Keep the app reachable only through your proxy, except for local administration. Preserve the request path, body, and `Authorization` header. Set proxy read timeouts above 65 seconds for long polling.

Forwarded IP headers are ignored by default. Set `TRUSTED_PROXY_CIDRS` to the actual proxy addresses/subnets and have the proxy append the connecting peer to `X-Forwarded-For`. SlashEvents walks that chain from the trusted socket toward the first untrusted address. Avoid trusting all addresses. `sourcePort` is unavailable when the client is behind a proxy.

`/health/liveness` checks the HTTP process; `/health/readiness` checks database connectivity after migrations. The image health check uses readiness. SIGTERM cancels long polls, stops retention workers, and closes database connections, with a 10-second shutdown deadline. Compose allows 15 seconds.

## Backups and upgrades

Back up the database and keep the environment file separately in secure storage. For a final export with no concurrent writes, stop the app first:

```sh
docker compose stop app
docker compose exec -T db pg_dump -U slashevents -d slashevents -Fc > slashevents.dump
docker compose start app
```

Verify backups by restoring them into a separate, empty Postgres 18 database. For recovery into an empty Compose database, keep the app stopped and run:

```sh
docker compose exec -T db pg_restore -U slashevents -d slashevents \
  --no-owner --no-acl --exit-on-error < slashevents.dump
docker compose start app
```

For upgrades, back up first, review release notes, change `SLASHEVENTS_IMAGE` to a specific version/digest, then:

```sh
docker compose pull app
docker compose up -d app
```

The database volume survives container recreation and `docker compose down`. `docker compose down -v` deletes it. Image downgrades are only safe when the schema remains compatible; otherwise restore the matching pre-upgrade backup to an empty database.

Startup rejects databases containing migrations that are missing from the image. Use an image version compatible with the database, or restore a matching backup into an empty database.

## Development and contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and tests, and [SECURITY.md](SECURITY.md) for reporting vulnerabilities. Releases publish the application Docker image only. Source is available under the [MIT license](LICENSE).
