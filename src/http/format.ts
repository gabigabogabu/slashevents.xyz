import { AppError, ErrorCode, toAppError } from '@/errors';

const faviconHref = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%2F%3C/text%3E%3C/svg%3E";
const faviconLink = `<link rel="icon" href="${faviconHref}" />`;

const pageStyle = `
body {
  margin: 40px auto;
  max-width: 650px;
  line-height: 1.6;
  font-size: 18px;
  color: #444;
  padding: 0 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}
h1, h2, h3 {
  line-height: 1.2;
}
summary {
  cursor: pointer;
}
summary strong {
  font-size: 1.17em;
  line-height: 1.2;
}
a { color: #07c; }
code, pre {
  overflow: auto;
}
pre {
  padding: 0.75em;
  background: #f7f7f7;
}
input, button, select, textarea {
  font: inherit;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  border-bottom: 1px solid #ddd;
  padding: 0.35em;
  text-align: left;
  vertical-align: top;
}
`;

type ResponseFormat = 'json' | 'html';

export const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const renderDocument = (title: string, body: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${faviconLink}
    <title>${escapeHtml(title)}</title>
    <style>${pageStyle}</style>
  </head>
  <body>
    <header><h1>SlashEvents</h1></header>
    ${body}
  </body>
</html>`;

const safeJsonStringify = (value: unknown, space = 2): string =>
  JSON.stringify(
    value,
    (_key, inner) => {
      if (inner instanceof Date) return inner.toISOString();
      if (typeof inner === 'bigint') return inner.toString();
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
    'Content-Type': 'application/json; charset=utf-8',
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
    'Content-Type': 'text/html; charset=utf-8',
    ...init.headers,
  },
});

const errorBackHref = (request: Request): string => {
  const referer = request.headers.get('referer');
  if (!referer) return '/';

  try {
    const current = new URL(request.url);
    const target = new URL(referer, current);
    if (target.origin !== current.origin) return '/';
    return `${target.pathname}${target.search}${target.hash}` || '/';
  } catch {
    return '/';
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
  const html = renderDocument(
    appError.name,
    `<main>
      <h2>${escapeHtml(appError.name)}</h2>
      ${appError.hint ? `<p>${escapeHtml(appError.hint)}</p>` : ''}
      <a href="${escapeHtml(backHref)}" onclick="if (history.length > 1) { event.preventDefault(); history.back(); }">Back</a>
    </main>`,
  );
  return init.defaultFormat === 'html'
    ? htmlResponse(html, { status: appError.status })
    : jsonResponse(payload, { status: appError.status });
};

export const notFound = (request: Request): Response =>
  respondError(request, new AppError(ErrorCode.NOT_FOUND, 404, 'Not found'), {
    defaultFormat: 'html',
  });
