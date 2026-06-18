import { AppError, toAppError } from "@/lib/app-error";
import { ErrorCode } from "@/lib/errors";
import { pageStyle } from "./style";

export type ResponseFormat = "json" | "html";

export const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const safeJsonStringify = (value: unknown, space = 2): string =>
  JSON.stringify(
    value,
    (_key, inner) => {
      if (inner instanceof Date) return inner.toISOString();
      if (typeof inner === "bigint") return inner.toString();
      return inner;
    },
    space,
  );

export const jsonResponse = (
  payload: unknown,
  init: {
    status?: number;
    headers?: HeadersInit;
  } = {},
): Response => new Response(safeJsonStringify(payload, 2), {
  status: init.status ?? 200,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    ...init.headers,
  },
});

export const htmlResponse = (
  html: string,
  init: {
    status?: number;
    headers?: HeadersInit;
  } = {},
): Response => new Response(html, {
  status: init.status ?? 200,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    ...init.headers,
  },
});

const errorBackHref = (request: Request): string => {
  const referer = request.headers.get("referer");
  if (!referer) return "/";

  try {
    const current = new URL(request.url);
    const target = new URL(referer, current);
    if (target.origin !== current.origin) return "/";
    return `${target.pathname}${target.search}${target.hash}` || "/";
  } catch {
    return "/";
  }
};

export const respondError = (
  request: Request,
  error: unknown,
  init: { defaultFormat?: ResponseFormat } = {},
): Response => {
  const appError = toAppError(error);
  const payload = {
    error: {
      code: appError.name,
      hint: appError.hint,
    },
  };
  const backHref = errorBackHref(request);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(appError.name)}</title>
    <style>${pageStyle}</style>
  </head>
  <body>
    <header><h1>slashevents.xyz</h1></header>
    <main>
      <h2>${escapeHtml(appError.name)}</h2>
      ${appError.hint ? `<p>${escapeHtml(appError.hint)}</p>` : ""}
      <a href="${escapeHtml(backHref)}" onclick="if (history.length > 1) { event.preventDefault(); history.back(); }">Back</a>
    </main>
  </body>
</html>`;
  return init.defaultFormat === "html"
    ? htmlResponse(html, { status: appError.status })
    : jsonResponse(payload, { status: appError.status });
};

export const notFound = (request: Request): Response =>
  respondError(request, new AppError(ErrorCode.NOT_FOUND, 404, "Not found"), {
    defaultFormat: "html",
  });
