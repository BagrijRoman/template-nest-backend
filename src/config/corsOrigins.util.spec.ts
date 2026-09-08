import { describe, expect, it } from 'vitest';
import { parseCorsOrigins } from './corsOrigins.util.js';

describe('parseCorsOrigins', () => {
  it('splits a comma-separated list and trims whitespace', () => {
    expect(parseCorsOrigins('https://app.example.com, https://admin.example.com')).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('returns a single origin as a one-element list', () => {
    expect(parseCorsOrigins('http://localhost:5173')).toEqual(['http://localhost:5173']);
  });

  it('returns an empty list when the variable is unset or empty', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('')).toEqual([]);
    expect(parseCorsOrigins(' , ')).toEqual([]);
  });
});
