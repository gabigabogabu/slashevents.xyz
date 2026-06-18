import { AppError } from "@/lib/app-error";
import { ErrorCode } from "@/lib/errors";

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
};

type RateLimitBucket = {
  count: number;
  resetAtMs: number;
};

type FixedWindowRateLimiter = {
  check: (key: string, nowMs?: number) => RateLimitDecision;
  consume: (key: string, nowMs?: number) => RateLimitDecision;
};

const normalizeKey = (key: string): string => key.trim() || "unknown";

const decision = (
  bucket: RateLimitBucket,
  limit: number,
  nowMs: number,
  allowed: boolean,
): RateLimitDecision => ({
  allowed,
  limit,
  remaining: Math.max(0, limit - bucket.count),
  retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000)),
  resetAt: new Date(bucket.resetAtMs),
});

export const createFixedWindowRateLimiter = (
  { limit, windowMs }: { limit: number; windowMs: number },
): FixedWindowRateLimiter => {
  const buckets = new Map<string, RateLimitBucket>();
  let lastSweepMs = 0;

  const bucketFor = (key: string, nowMs: number): RateLimitBucket => {
    if (nowMs - lastSweepMs > windowMs) {
      lastSweepMs = nowMs;
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAtMs <= nowMs) buckets.delete(bucketKey);
      }
    }

    const normalizedKey = normalizeKey(key);
    const existing = buckets.get(normalizedKey);
    if (existing && existing.resetAtMs > nowMs) return existing;

    const next = { count: 0, resetAtMs: nowMs + windowMs };
    buckets.set(normalizedKey, next);
    return next;
  };

  return {
    check: (key, nowMs = Date.now()) => {
      const bucket = bucketFor(key, nowMs);
      return decision(bucket, limit, nowMs, bucket.count < limit);
    },
    consume: (key, nowMs = Date.now()) => {
      const bucket = bucketFor(key, nowMs);
      if (bucket.count >= limit) return decision(bucket, limit, nowMs, false);
      bucket.count += 1;
      return decision(bucket, limit, nowMs, true);
    },
  };
};

export const rateLimitHint = (scope: string, decision: RateLimitDecision): string =>
  `Rate limit exceeded for ${scope}; retry after ${decision.retryAfterSeconds} seconds.`;

export const assertRateLimit = (scope: string, decision: RateLimitDecision): void => {
  if (!decision.allowed) {
    throw new AppError(ErrorCode.RATE_LIMIT_EXCEEDED, 429, rateLimitHint(scope, decision));
  }
};
