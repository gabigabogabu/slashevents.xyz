import type { Log } from '@/log';

import type { UUID } from 'node:crypto';

export const ingressSubpath = (projectId: UUID, pathname: string): string => {
  const prefix = `/ingress/${projectId}`;
  if (pathname === prefix) return '/';
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return pathname;
};

const webhookPathPatternRegex = (pattern: string): RegExp =>
  new RegExp(`^(?:${pattern})$`);

export const isValidWebhookPathPattern = (log: Log) => (pattern: string): boolean => {
  try {
    webhookPathPatternRegex(pattern);
    return true;
  } catch (err) {
    log.warn({ err, pattern }, 'Invalid webhook path allowlist pattern');
    return false;
  }
};

export const isWebhookPathAllowed = (log: Log) => (allowedPathPatterns: readonly string[], path: string): boolean =>
  allowedPathPatterns.some((pattern) => {
    try {
      return webhookPathPatternRegex(pattern).test(path);
    } catch (err) {
      log.warn({ err, pattern }, 'Invalid stored webhook path allowlist pattern');
      return false;
    }
  });
