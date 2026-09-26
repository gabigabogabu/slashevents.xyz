import { describe, expect, test } from 'bun:test';

import { envSchema } from '@/config';

import { createTokenAuthenticator } from './auth';

const token = 'test-token-with-at-least-32-characters';
const authenticate = createTokenAuthenticator(token);
const request = (authorization?: string) => new Request('http://localhost/rpc', {
  headers: authorization ? { authorization } : {},
});

describe('instance authentication', () => {
  test('accepts the exact token with case-insensitive Bearer scheme', () => {
    expect(() => authenticate(request(`Bearer ${token}`))).not.toThrow();
    expect(() => authenticate(request(`bearer ${token}`))).not.toThrow();
  });
  test('rejects absent, incorrect, or malformed credentials', () => {
    for (const value of [undefined, `Basic ${token}`, 'Bearer wrong', `Bearer ${token}extra`, `Bearer ${token} ${token}`])
      expect(() => authenticate(request(value))).toThrow('AUTHENTICATION_ERROR');
    expect(() => createTokenAuthenticator('')).toThrow();
  });
  test('requires explicit credentials at startup and supplies operational defaults', () => {
    const database = { DATABASE_URL: 'postgres://localhost/slashevents' };
    expect(envSchema.safeParse(database).success).toBe(false);
    expect(envSchema.safeParse({ ...database, SLASHEVENTS_API_TOKEN: 'short' }).success).toBe(false);
    const config = envSchema.parse({ ...database, SLASHEVENTS_API_TOKEN: token });
    expect(config.PORT).toBe(3000);
    expect(config.PUBLIC_URL).toBe('http://localhost:3000');
    expect(config.TRUSTED_PROXY_CIDRS).toBe('');
    expect(envSchema.safeParse({ ...config, PUBLIC_URL: 'https://example.com/path' }).success).toBe(false);
  });
});
