import assert from "node:assert/strict";

type AnyMatcher = {
  readonly __matcher: "any";
  readonly constructorFn: unknown;
};

const isAnyMatcher = (value: unknown): value is AnyMatcher =>
  Boolean(value) &&
  typeof value === "object" &&
  (value as { __matcher?: unknown }).__matcher === "any";

const matchesAny = (actual: unknown, constructorFn: unknown): boolean => {
  if (constructorFn === String) return typeof actual === "string" || actual instanceof String;
  if (constructorFn === Number) return typeof actual === "number" || actual instanceof Number;
  if (constructorFn === Boolean) return typeof actual === "boolean" || actual instanceof Boolean;
  if (constructorFn === Date) return actual instanceof Date;
  return typeof constructorFn === "function" && actual instanceof constructorFn;
};

const assertEqualWithMatchers = (actual: unknown, expected: unknown): void => {
  if (isAnyMatcher(expected)) {
    assert.ok(matchesAny(actual, expected.constructorFn), `Expected ${actual} to match expect.any()`);
    return;
  }

  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), "Expected value to be an array");
    assert.equal(actual.length, expected.length);
    expected.forEach((item, index) => assertEqualWithMatchers(actual[index], item));
    return;
  }

  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", "Expected value to be an object");
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    assert.deepEqual(Object.keys(actualRecord).sort(), Object.keys(expectedRecord).sort());
    for (const [key, value] of Object.entries(expectedRecord)) {
      assertEqualWithMatchers(actualRecord[key], value);
    }
    return;
  }

  assert.deepEqual(actual, expected);
};

const assertExpectedError = (
  error: unknown,
  expected?: string | RegExp | Error,
): void => {
  if (expected === undefined) return;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (typeof expected === "string") {
    assert.ok(message.includes(expected) || name === expected, `Expected error to include ${expected}`);
    return;
  }
  if (expected instanceof RegExp) {
    assert.match(message, expected);
    return;
  }
  assert.equal(error, expected);
};

const assertThrows = (
  action: () => unknown,
  expected?: string | RegExp | Error,
): void => {
  try {
    action();
  } catch (error) {
    assertExpectedError(error, expected);
    return;
  }
  assert.fail("Expected function to throw");
};

const assertRejects = async (
  action: Promise<unknown>,
  expected?: string | RegExp | Error,
): Promise<void> => {
  try {
    await action;
  } catch (error) {
    assertExpectedError(error, expected);
    return;
  }
  assert.fail("Expected promise to reject");
};

export const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
  toEqual: (expected: unknown) => assertEqualWithMatchers(actual, expected),
  toBeDefined: () => assert.notEqual(actual, undefined),
  toBeUndefined: () => assert.equal(actual, undefined),
  toBeNull: () => assert.equal(actual, null),
  toBeTruthy: () => assert.ok(actual),
  toContain: (expected: unknown) => {
    if (typeof actual === "string") assert.ok(actual.includes(String(expected)));
    else assert.ok(Array.isArray(actual) && actual.includes(expected));
  },
  toHaveProperty: (property: string) => {
    assert.ok(actual && typeof actual === "object" && property in actual);
  },
  toBeGreaterThan: (expected: number) => assert.ok(Number(actual) > expected),
  toBeGreaterThanOrEqual: (expected: number) => assert.ok(Number(actual) >= expected),
  toBeLessThanOrEqual: (expected: number) => assert.ok(Number(actual) <= expected),
  toThrow: (expected?: string | RegExp | Error) => {
    assert.ok(typeof actual === "function", "Expected a function");
    assertThrows(actual as () => unknown, expected);
  },
  rejects: {
    toThrow: (expected?: string | RegExp | Error) => assertRejects(actual as Promise<unknown>, expected),
  },
  not: {
    toContain: (expected: unknown) => {
      if (typeof actual === "string") assert.ok(!actual.includes(String(expected)));
      else assert.ok(Array.isArray(actual) && !actual.includes(expected));
    },
  },
});

expect.any = (constructorFn: unknown): AnyMatcher => ({ __matcher: "any", constructorFn });
expect.unreachable = (message?: string): never => assert.fail(message ?? "Unreachable");
