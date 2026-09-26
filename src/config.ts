import { z } from 'zod';

const rateLimit = (fallback: number) => z.coerce.number().int().min(0).default(fallback);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().refine((value) => /^postgres(ql)?:\/\//.test(value), 'Use a PostgreSQL connection URL'),
  SLASHEVENTS_API_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/, 'Set a random API token of 32–256 letters, digits, underscores or hyphens'),
  PUBLIC_URL: z.string().url().default('http://localhost:3000').refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  }, 'Use an HTTP(S) origin without a path or credentials').transform((value) => new URL(value).origin),
  TRUSTED_PROXY_CIDRS: z.string().default(''),
  RPC_RATE_LIMIT_PER_MINUTE: rateLimit(120),
  INGRESS_RATE_LIMIT_PER_MINUTE: rateLimit(120),
  PUBLIC_RATE_LIMIT_PER_MINUTE: rateLimit(60),
  AUTH_FAILURE_RATE_LIMIT_PER_MINUTE: rateLimit(20),
  MAX_REQUEST_BODY_BYTES: z.coerce.number().int().min(1).default(1_048_576),
  RETENTION_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(60),
});

export type Env = z.infer<typeof envSchema>;
