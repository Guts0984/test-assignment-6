// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clientAddress } from './client-address';

describe('clientAddress', () => {
  it("trusts nothing when no proxy of ours is in front (the header is then the client's own words)", () => {
    expect(clientAddress('1.2.3.4', 0)).toBeNull();
    expect(clientAddress('1.2.3.4, 5.6.7.8', 0)).toBeNull();
    expect(clientAddress(null, 0)).toBeNull();
  });

  it('with one proxy, the last entry is the address that proxy saw', () => {
    expect(clientAddress('203.0.113.7', 1)).toBe('203.0.113.7');
    expect(clientAddress('forged, 203.0.113.7', 1)).toBe('203.0.113.7');
    expect(clientAddress('1.1.1.1, 2.2.2.2, 203.0.113.7', 1)).toBe('203.0.113.7');
  });

  it('with two proxies, the second from the end: what the outer proxy saw, not what the inner one added', () => {
    expect(clientAddress('forged, 203.0.113.7, 10.0.0.5', 2)).toBe('203.0.113.7');
  });

  it('fewer entries than proxies is not something our proxies would send: no address', () => {
    expect(clientAddress('203.0.113.7', 2)).toBeNull();
    expect(clientAddress('', 1)).toBeNull();
    expect(clientAddress(null, 1)).toBeNull();
  });

  it('only things that look like an address are accepted; IPv6 is normalised to lower case', () => {
    expect(clientAddress('<script>', 1)).toBeNull();
    expect(clientAddress('a'.repeat(60), 1)).toBeNull();
    expect(clientAddress('2001:DB8::1', 1)).toBe('2001:db8::1');
    expect(clientAddress(' 203.0.113.7 ,  198.51.100.2 ', 1)).toBe('198.51.100.2');
  });
});
