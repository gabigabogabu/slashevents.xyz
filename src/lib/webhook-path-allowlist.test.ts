import { describe, test } from "bun:test";

import { expect } from "@/test-expect";
import type { UUID } from "node:crypto";
import { ingressSubpath, isWebhookPathAllowed } from "./webhook-path-allowlist";

const projectId = "00000000-0000-0000-0000-000000000001" as UUID;

describe("webhook path allowlist", () => {
  test("uses the ingress path after the project id", () => {
    expect(ingressSubpath(projectId, `/ingress/${projectId}/stripe/hooks`)).toBe("/stripe/hooks");
    expect(ingressSubpath(projectId, `/ingress/${projectId}`)).toBe("/");
  });

  test("fails closed unless the exact ingress path is allowlisted", () => {
    expect(isWebhookPathAllowed([], "/stripe/hooks")).toBe(false);
    expect(isWebhookPathAllowed(["/stripe"], "/stripe/hooks")).toBe(false);
    expect(isWebhookPathAllowed(["/stripe/hooks"], "/stripe/hooks")).toBe(true);
  });
});
