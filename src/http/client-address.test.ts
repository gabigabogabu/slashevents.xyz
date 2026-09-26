import { describe, expect, test } from 'bun:test';

import { createClientAddressResolver } from './client-address';

const request = (chain: string) => new Request('http://localhost', { headers: { 'x-forwarded-for': chain } });

describe('proxy trust', () => {
  test('ignores spoofed headers on direct connections', () => {
    expect(createClientAddressResolver('')(request('1.2.3.4'), '5.6.7.8')).toBe('5.6.7.8');
  });
  test('walks trusted hops from the socket toward the client', () => {
    const resolve = createClientAddressResolver('10.0.0.0/8');
    expect(resolve(request('1.2.3.4, 10.0.0.2'), '10.0.0.1')).toBe('1.2.3.4');
    expect(resolve(request('9.9.9.9, 1.2.3.4'), '10.0.0.1')).toBe('1.2.3.4');
    expect(resolve(request('1.2.3.4'), '::ffff:10.0.0.1')).toBe('1.2.3.4');
  });
  test('handles IPv6 and ignores malformed forwarding chains', () => {
    const resolve = createClientAddressResolver('::1/128');
    expect(resolve(request('2001:db8::1'), '::1')).toBe('2001:db8::1');
    expect(resolve(request('not-an-ip'), '::1')).toBe('::1');
    expect(() => createClientAddressResolver('10.0.0.0/99')).toThrow();
  });
});
