import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToggleValue } from '../config/env.validation.js';
import { BreachedPasswordsService } from './breachedPasswords.service.js';

const PASSWORD = 'Secret123';
const sha1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();
const SUFFIX = sha1.slice(5);

const buildService = async (mode?: ToggleValue): Promise<BreachedPasswordsService> => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [BreachedPasswordsService, { provide: ConfigService, useValue: { get: () => mode } }],
  }).compile();
  return module.get<BreachedPasswordsService>(BreachedPasswordsService);
};

const hibpResponse = (lines: string[]) => ({ ok: true, text: () => Promise.resolve(lines.join('\n')) });

describe('BreachedPasswordsService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a password whose hash suffix appears with a positive count', async () => {
    fetchMock.mockResolvedValue(hibpResponse(['ABCDEF:0', `${SUFFIX}:42`]));
    const service = await buildService();

    expect(await service.isBreached(PASSWORD)).toBe(true);
    // k-anonymity: only the 5-char prefix is ever sent.
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
  });

  it('ignores padded entries with a zero count', async () => {
    fetchMock.mockResolvedValue(hibpResponse([`${SUFFIX}:0`]));
    const service = await buildService();

    expect(await service.isBreached(PASSWORD)).toBe(false);
  });

  it('reports clean when the suffix is absent', async () => {
    fetchMock.mockResolvedValue(hibpResponse(['ABCDEF:10', '123456:3']));
    const service = await buildService();

    expect(await service.isBreached(PASSWORD)).toBe(false);
  });

  it('fails open on a network error and on a non-OK response', async () => {
    const service = await buildService();

    fetchMock.mockRejectedValue(new Error('timeout'));
    expect(await service.isBreached(PASSWORD)).toBe(false);

    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    expect(await service.isBreached(PASSWORD)).toBe(false);
  });

  it('does not call the API at all when disabled', async () => {
    const service = await buildService(ToggleValue.Disabled);

    expect(await service.isBreached(PASSWORD)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
