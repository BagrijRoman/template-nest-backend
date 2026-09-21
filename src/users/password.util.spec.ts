import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPasswordHash } from './password.util.js';

// 16-byte salt and 64-byte key, hex-encoded, joined by a colon.
const STORED_HASH_PATTERN = /^[0-9a-f]{32}:[0-9a-f]{128}$/;

describe('password.util', () => {
  it('produces a salted salt:hash pair and never the plaintext', async () => {
    const stored = await hashPassword('Secret123');

    expect(stored).toMatch(STORED_HASH_PATTERN);
    expect(stored).not.toContain('Secret123');
  });

  it('salts every hash: the same password hashes differently but both verify', async () => {
    const first = await hashPassword('Secret123');
    const second = await hashPassword('Secret123');

    expect(first).not.toBe(second);
    expect(await verifyPasswordHash('Secret123', first)).toBe(true);
    expect(await verifyPasswordHash('Secret123', second)).toBe(true);
  });

  it('accepts the correct password and rejects a wrong one', async () => {
    const stored = await hashPassword('Secret123');

    expect(await verifyPasswordHash('Secret123', stored)).toBe(true);
    expect(await verifyPasswordHash('secret123', stored)).toBe(false);
    expect(await verifyPasswordHash('', stored)).toBe(false);
  });

  it('handles unicode passwords', async () => {
    const password = 'Пароль123-🔒';
    const stored = await hashPassword(password);

    expect(await verifyPasswordHash(password, stored)).toBe(true);
    expect(await verifyPasswordHash('Пароль123-🔓', stored)).toBe(false);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await verifyPasswordHash('Secret123', '')).toBe(false);
    expect(await verifyPasswordHash('Secret123', 'no-colon-at-all')).toBe(false);
    expect(await verifyPasswordHash('Secret123', ':missing-salt')).toBe(false);
    expect(await verifyPasswordHash('Secret123', 'missing-hash:')).toBe(false);
  });

  it('rejects a tampered or truncated stored hash', async () => {
    const stored = await hashPassword('Secret123');
    const [salt, hash] = stored.split(':');

    const flippedLastChar = hash.endsWith('0') ? `${hash.slice(0, -1)}1` : `${hash.slice(0, -1)}0`;
    expect(await verifyPasswordHash('Secret123', `${salt}:${flippedLastChar}`)).toBe(false);
    expect(await verifyPasswordHash('Secret123', `${salt}:${hash.slice(0, 64)}`)).toBe(false);
  });
});
