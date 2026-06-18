import { describe, test } from "bun:test";
import { readFileSync } from "node:fs";

import { expect } from "@/test-expect";
import { renderDocument } from "./pages";

describe("page rendering", () => {
  test("adds the service name as the document h1", () => {
    const html = renderDocument("test", "<main><p>body</p></main>");

    expect(html).toContain("<h1>slashevents.xyz</h1>");
  });

  test("does not duplicate the service h1 on the landing page", () => {
    const html = readFileSync(new URL("./landing.html", import.meta.url), "utf8");

    expect(html.match(/<h1>/g)?.length).toBe(1);
    expect(html).toContain("<h1>slashevents.xyz</h1>");
    expect(html).toContain("https://blog.sequinstream.com/events-not-webhooks/");
    expect(html).toContain('<a href="/docs">docs</a>');
    expect(html).not.toContain("openssl");
    expect(html).not.toContain("client.pem");
    expect(html).not.toContain("/signup");
    expect(html).not.toContain("POST /users");
  });
});
