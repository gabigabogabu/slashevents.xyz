import { escapeHtml } from "./format";
import { pageStyle } from "./style";

export const renderDocument = (title: string, body: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${pageStyle}</style>
  </head>
  <body>
    <header><h1>slashevents.xyz</h1></header>
    ${body}
  </body>
</html>`;
