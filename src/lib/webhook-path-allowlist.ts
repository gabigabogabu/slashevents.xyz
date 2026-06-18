import type { UUID } from "node:crypto";

export const ingressSubpath = (projectId: UUID, pathname: string): string => {
  const prefix = `/ingress/${projectId}`;
  if (pathname === prefix) return "/";
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return pathname;
};

export const isWebhookPathAllowed = (allowedPaths: readonly string[], path: string): boolean =>
  allowedPaths.includes(path);
