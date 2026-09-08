import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// Async scrypt runs in the libuv thread pool: hashing takes tens of milliseconds, and the
// sync variant would block the event loop for every request — a DoS amplification vector.
const scryptAsync = promisify<string, string, number, Buffer>(scrypt);

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const hash = (await scryptAsync(password, salt, KEY_LENGTH)).toString('hex');
  return `${salt}:${hash}`;
};

export const verifyPasswordHash = async (password: string, storedHash: string): Promise<boolean> => {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) {
    return false;
  }
  const candidate = await scryptAsync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};
