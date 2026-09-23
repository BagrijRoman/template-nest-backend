import { describe, expect, it } from 'vitest';
import { isTrustProxyValue, parseTrustProxy } from './trustProxy.util.js';

describe('parseTrustProxy', () => {
  it('treats an unset, empty or "false" value as disabled', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('reads a hop count as a number', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('reads a comma-separated whitelist as a trimmed list', () => {
    expect(parseTrustProxy('10.0.0.0/8, 192.168.0.1')).toEqual(['10.0.0.0/8', '192.168.0.1']);
    expect(parseTrustProxy('loopback')).toEqual(['loopback']);
  });
});

describe('isTrustProxyValue', () => {
  it.each(['false', '1', '10', 'loopback', 'linklocal', 'uniquelocal', '10.0.0.0/8', '::1, 192.168.0.1'])(
    'accepts %s',
    (value) => {
      expect(isTrustProxyValue(value)).toBe(true);
    },
  );

  it.each([
    ['true', 'it would let any client forge its own IP'],
    ['0', 'a zero hop count is the disabled state spelled confusingly'],
    ['yes', 'not an address, preset or count'],
    ['10.0.0.0/8, nonsense!', 'one bad entry invalidates the list'],
    ['', 'an empty string is expressed by leaving the variable unset'],
  ])('rejects %s because %s', (value) => {
    expect(isTrustProxyValue(value)).toBe(false);
  });
});
