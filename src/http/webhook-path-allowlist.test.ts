import { describe, expect, test } from 'bun:test';

import type { Log } from '@/log';

import { ingressSubpath, isValidWebhookPathPattern, isWebhookPathAllowed } from './webhook-path-allowlist';

import type { UUID } from 'node:crypto';


const projectId = '00000000-0000-0000-0000-000000000001' as UUID;
const log = { warn: () => undefined } as unknown as Log;
const isAllowed = isWebhookPathAllowed(log);
const isValidPattern = isValidWebhookPathPattern(log);

describe('webhook path allowlist', () => {
  test('uses the ingress path after the project id', () => {
    expect(ingressSubpath(projectId, `/ingress/${projectId}/provider/hooks`)).toBe('/provider/hooks');
    expect(ingressSubpath(projectId, `/ingress/${projectId}`)).toBe('/');
  });

  test('matches full ingress path patterns', () => {
    expect(isAllowed([], '/provider/hooks')).toBe(false);
    expect(isAllowed(['/provider'], '/provider/hooks')).toBe(false);
    expect(isAllowed(['/provider/hooks'], '/provider/hooks')).toBe(true);
    expect(isAllowed(['/customers/[^/]+/events'], '/customers/cus_123/events')).toBe(true);
    expect(isAllowed(['/customers/[^/]+/events'], '/customers/cus_123/events/extra')).toBe(false);
  });

  test('validates pattern syntax and fails closed for invalid patterns', () => {
    expect(isValidPattern('/customers/[^/]+/events')).toBe(true);
    expect(isValidPattern('/customers/[')).toBe(false);
    expect(isAllowed(['/customers/['], '/customers/123')).toBe(false);
  });
});
