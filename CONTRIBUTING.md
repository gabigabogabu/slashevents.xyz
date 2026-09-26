# Contributing

Use Bun 1.3.14 and Postgres 18. Clone the repository and run `bun install --frozen-lockfile`.

For an isolated development/test database:

```sh
docker run -d --name slashevents-dev-db \
  -e POSTGRES_USER=slashevents -e POSTGRES_PASSWORD=slashevents \
  -e POSTGRES_DB=slashevents_test -p 127.0.0.1:5432:5432 postgres:18
# Wait until pg_isready succeeds:
docker exec slashevents-dev-db pg_isready -U slashevents
docker exec slashevents-dev-db createdb -U slashevents slashevents
```

Set `DATABASE_URL=postgres://slashevents:slashevents@localhost:5432/slashevents` and a random `SLASHEVENTS_API_TOKEN` in `.env`. `bun run dev` starts the app. Bun loads `.env` for local development.

Before submitting a change:

```sh
bun run lint
bun run build
TEST_DB_URL=postgres://slashevents:slashevents@localhost:5432/slashevents_test bun test ./src
docker build -t slashevents:dev .
```

Tests reset the `app` and `migrations` schemas in `TEST_DB_URL`. Always use a disposable test database, separate from application data. The build command type-checks TypeScript; the Docker image runs TypeScript directly with Bun.

`bun run test:smoke` exercises a running disposable app at `SMOKE_URL` (default `http://127.0.0.1:3000`) using `SLASHEVENTS_API_TOKEN`. Run that app with `RETENTION_INTERVAL_SECONDS=1`. The smoke test creates projects/events; `bun run test:smoke -- --verify` checks their persistence after restart. See `.github/workflows/ci.yml` for the complete container workflow.

Keep changes focused and explain behavior and validation in pull requests. Add tests for changes to persistence, authentication, or API behavior. Never commit `.env`, database dumps, private keys, or credentials. New schema changes require new migrations.

Maintainers publish releases by pushing a `vX.Y.Z` tag after updating package/Compose/example versions. CI verifies the release, then publishes AMD64 and ARM64 manifests to `ghcr.io/gabigabogabu/slashevents`, with version, major.minor, commit, and latest stable tags. No npm package is published.
