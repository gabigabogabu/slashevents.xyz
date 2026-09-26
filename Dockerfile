FROM oven/bun:1.3.14-slim AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-slim
LABEL org.opencontainers.image.title="SlashEvents" \
      org.opencontainers.image.description="Self-hosted webhook storage and polling" \
      org.opencontainers.image.source="https://github.com/gabigabogabu/slashevents.xyz" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json tsconfig.json LICENSE ./
COPY --chown=bun:bun src ./src
USER bun
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/readiness', { signal: AbortSignal.timeout(4000) }); process.exit(r.ok ? 0 : 1)"]
CMD ["bun", "src/index.ts"]
