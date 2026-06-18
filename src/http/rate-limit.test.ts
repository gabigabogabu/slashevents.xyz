import { describe, test } from "bun:test";

import { ErrorCode } from "@/lib/errors";
import { expect } from "@/test-expect";
import { assertRateLimit, createFixedWindowRateLimiter, rateLimitHint } from "./rate-limit";

describe("rate limiting", () => {
  test("allows up to the fixed window limit", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 1_000 });

    const first = limiter.consume("agent-a", 10_000);
    const second = limiter.consume("agent-a", 10_100);
    const third = limiter.consume("agent-a", 10_200);

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(1);
  });

  test("resets after the window expires", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1_000 });

    expect(limiter.consume("ip-1", 10_000).allowed).toBe(true);
    expect(limiter.consume("ip-1", 10_100).allowed).toBe(false);
    expect(limiter.consume("ip-1", 11_001).allowed).toBe(true);
  });

  test("throws app errors for exceeded limits", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1_000 });
    limiter.consume("ip-1", 10_000);
    const exceeded = limiter.consume("ip-1", 10_100);

    expect(() => assertRateLimit("public RPC", exceeded)).toThrow(ErrorCode.RATE_LIMIT_EXCEEDED);
    expect(rateLimitHint("public RPC", exceeded)).toBe("Rate limit exceeded for public RPC; retry after 1 seconds.");
  });
});
