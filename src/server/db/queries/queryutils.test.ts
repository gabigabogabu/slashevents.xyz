import { describe, expect, test } from "bun:test";
import { camelCaseKeys, snakeCaseKeys } from "./queryutils";

describe("queryutils", () => {
  test("snakeCaseKeys converts keys to snake_case", () => {
    const input = {
      email: "a@example.com",
      passwordHash: "hash",
      passwordSalt: "salt",
    };

    expect(snakeCaseKeys(input)).toEqual({
      email: "a@example.com",
      password_hash: "hash",
      password_salt: "salt",
    });
  });

  test("camelCaseKeys converts keys to camelCase", () => {
    const input = {
      email: "a@example.com",
      password_hash: "hash",
      password_salt: "salt",
    };

    expect(camelCaseKeys(input)).toEqual({
      email: "a@example.com",
      passwordHash: "hash",
      passwordSalt: "salt",
    });
  });
});


