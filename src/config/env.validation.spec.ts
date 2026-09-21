// class-transformer/class-validator decorators need the Reflect metadata polyfill;
// specs that boot Nest get it transitively, this one tests the function directly.
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

const validConfig = (): Record<string, unknown> => ({
  NODE_ENV: 'test',
  PORT: '3000',
  MONGODB_URI: 'mongodb://localhost:27017/template-backend',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_REFRESH_TTL: '30d',
});

describe('validateEnv', () => {
  it('accepts a valid configuration and coerces types', () => {
    const validated = validateEnv(validConfig());

    expect(validated.PORT).toBe(3000);
    expect(validated.NODE_ENV).toBe('test');
  });

  it('rejects equal access and refresh secrets', () => {
    const secret = 's'.repeat(32);

    expect(() => validateEnv({ ...validConfig(), JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret })).toThrow(
      /JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ/,
    );
  });

  it('rejects a missing secret', () => {
    const config = validConfig();
    delete config.JWT_ACCESS_SECRET;

    expect(() => validateEnv(config)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a too-short secret', () => {
    expect(() => validateEnv({ ...validConfig(), JWT_REFRESH_SECRET: 'short' })).toThrow(
      /JWT_REFRESH_SECRET must be a string of at least 32 characters/,
    );
  });

  it('rejects a TTL without a unit', () => {
    expect(() => validateEnv({ ...validConfig(), JWT_ACCESS_TTL: '900' })).toThrow(/JWT_ACCESS_TTL/);
  });

  it('rejects a malformed MONGODB_URI', () => {
    expect(() => validateEnv({ ...validConfig(), MONGODB_URI: 'redis://nope' })).toThrow(/MONGODB_URI/);
  });

  it('validates CORS_ORIGINS when present and allows it to be absent', () => {
    expect(() => validateEnv({ ...validConfig(), CORS_ORIGINS: 'not-an-origin' })).toThrow(/CORS_ORIGINS/);
    expect(
      validateEnv({ ...validConfig(), CORS_ORIGINS: 'http://localhost:5173,https://app.example.com' }).CORS_ORIGINS,
    ).toBe('http://localhost:5173,https://app.example.com');
    expect(validateEnv(validConfig()).CORS_ORIGINS).toBeUndefined();
  });

  it('collects multiple problems into one readable error', () => {
    expect(() => validateEnv({ ...validConfig(), PORT: '99999', JWT_REFRESH_TTL: 'abc' })).toThrow(
      /PORT[\s\S]*JWT_REFRESH_TTL|JWT_REFRESH_TTL[\s\S]*PORT/,
    );
  });
});
