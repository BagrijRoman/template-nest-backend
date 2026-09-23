import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  NAME_MAX_LENGTH,
  nameSchema,
  PASSWORD_MAX_LENGTH,
  passwordSchema,
  requiredStringSchema,
} from './fieldSchemas.js';

const messagesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('emailSchema', () => {
  it('trims and lower-cases a valid address', () => {
    expect(emailSchema.parse('  Jane@Example.COM ')).toBe('jane@example.com');
  });

  it('rejects a malformed, missing or non-string address with field-named messages', () => {
    expect(messagesOf(emailSchema.safeParse('not-an-email'))).toEqual(['email must be a valid email address']);
    expect(messagesOf(emailSchema.safeParse(undefined))).toEqual(['email must not be empty']);
    expect(messagesOf(emailSchema.safeParse(42))).toEqual(['email must be a string']);
  });

  it('rejects an address whose local part or total length exceeds the RFC limits', () => {
    const tooLongLocalPart = `${'a'.repeat(65)}@example.com`;
    const tooLongOverall = `a@${'b'.repeat(250)}.com`;

    expect(emailSchema.safeParse(`${'a'.repeat(64)}@example.com`).success).toBe(true);
    expect(messagesOf(emailSchema.safeParse(tooLongLocalPart))).toEqual(['email must be a valid email address']);
    expect(messagesOf(emailSchema.safeParse(tooLongOverall))).toEqual(['email must be a valid email address']);
  });
});

describe('requiredStringSchema', () => {
  it('keeps the value verbatim and only rejects an empty string', () => {
    const schema = requiredStringSchema('token');

    expect(schema.parse('  abc ')).toBe('  abc ');
    expect(messagesOf(schema.safeParse(''))).toEqual(['token must not be empty']);
  });
});

describe('nameSchema', () => {
  it('trims, rejects blank input and caps the length', () => {
    const schema = nameSchema('firstName');

    expect(schema.parse('  Jane ')).toBe('Jane');
    expect(messagesOf(schema.safeParse('   '))).toEqual(['firstName must not be empty']);
    expect(messagesOf(schema.safeParse('x'.repeat(NAME_MAX_LENGTH + 1)))).toEqual([
      `firstName must be shorter than or equal to ${NAME_MAX_LENGTH} characters`,
    ]);
  });
});

describe('passwordSchema', () => {
  const schema = passwordSchema('newPassword');

  it('accepts a password that satisfies every rule', () => {
    expect(schema.safeParse('Secret123').success).toBe(true);
  });

  it('reports every failed rule at once, named after the field', () => {
    expect(messagesOf(schema.safeParse('short'))).toEqual([
      'newPassword must be at least 8 characters long',
      'newPassword must contain at least one uppercase letter',
      'newPassword must contain at least one digit',
    ]);
  });

  it('caps the length', () => {
    expect(messagesOf(schema.safeParse(`Aa1${'x'.repeat(PASSWORD_MAX_LENGTH)}`))).toEqual([
      `newPassword must be shorter than or equal to ${PASSWORD_MAX_LENGTH} characters`,
    ]);
  });
});
