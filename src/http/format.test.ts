import { describe, test } from "bun:test";

import { expect } from "@/test-expect";
import { AppError } from "@/lib/app-error";
import { ErrorCode } from "@/lib/errors";
import { htmlResponse, jsonResponse, respondError } from "./format";

const jsonRequest = (): Request =>
  new Request("http://localhost/test", { headers: { accept: "application/json" } });

const htmlRequest = (referer?: string): Request =>
  new Request("http://localhost/test", {
    headers: {
      accept: "text/html",
      ...(referer ? { referer } : {}),
    },
  });

describe("response formatting", () => {
  test("returns JSON responses", async () => {
    const response = jsonResponse({ ok: true }, { status: 201 });

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  test("returns HTML responses", async () => {
    const response = htmlResponse("<main>body</main>");

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("<main>body</main>");
  });

  test("returns JSON errors by default", async () => {
    const response = respondError(
      jsonRequest(),
      new AppError(ErrorCode.NOT_FOUND, 404, "Missing"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: {
        code: ErrorCode.NOT_FOUND,
        hint: "Missing",
      },
    });
  });

  test("includes page styling in HTML errors", async () => {
    const response = respondError(
      htmlRequest(),
      new AppError(ErrorCode.NOT_FOUND, 404, "Missing"),
      { defaultFormat: "html" },
    );

    const body = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("<style>");
    expect(body).toContain("font-family: ui-monospace");
    expect(body).toContain("<h1>slashevents.xyz</h1>");
    expect(body).toContain("<h2>NOT_FOUND</h2>");
  });

  test("links HTML errors back to the same-origin referrer", async () => {
    const response = respondError(
      htmlRequest("http://localhost/rpc?cursor=abc"),
      new AppError(ErrorCode.NOT_FOUND, 404, "Missing"),
      { defaultFormat: "html" },
    );

    const body = await response.text();
    expect(body).toContain('<a href="/rpc?cursor=abc" onclick="if (history.length > 1) { event.preventDefault(); history.back(); }">Back</a>');
    expect(body).not.toContain("<p><a");
  });

  test("does not link HTML errors to external referrers", async () => {
    const response = respondError(
      htmlRequest("https://example.com/rpc"),
      new AppError(ErrorCode.NOT_FOUND, 404, "Missing"),
      { defaultFormat: "html" },
    );

    expect(await response.text()).toContain('<a href="/" onclick="if (history.length > 1) { event.preventDefault(); history.back(); }">Back</a>');
  });
});
