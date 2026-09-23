import { createHash } from 'node:crypto';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionTokensService } from './actionTokens.service.js';
import { ActionToken, ActionTokenType } from './entities/index.js';

const USER_ID = '507f1f77bcf86cd799439011';
const TTL_MS = 30 * 60_000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const withLean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('ActionTokensService', () => {
  let service: ActionTokensService;

  const actionTokenModel = { create: vi.fn(), deleteMany: vi.fn(), findOneAndDelete: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    actionTokenModel.deleteMany.mockResolvedValue({ deletedCount: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [ActionTokensService, { provide: getModelToken(ActionToken.name), useValue: actionTokenModel }],
    }).compile();

    service = module.get<ActionTokensService>(ActionTokensService);
  });

  it('returns a random token and stores only its hash, under the requested action', async () => {
    const token = await service.issue(ActionTokenType.PasswordReset, USER_ID, TTL_MS);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const stored = actionTokenModel.create.mock.calls[0][0];
    expect(stored).toMatchObject({ tokenHash: sha256(token), type: ActionTokenType.PasswordReset, userId: USER_ID });
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('issues a distinct token every time', async () => {
    const [first, second] = await Promise.all([
      service.issue(ActionTokenType.EmailVerification, USER_ID, TTL_MS),
      service.issue(ActionTokenType.EmailVerification, USER_ID, TTL_MS),
    ]);

    expect(first).not.toBe(second);
  });

  it('drops the previous token of the same action only, leaving other actions alone', async () => {
    await service.issue(ActionTokenType.PasswordReset, USER_ID, TTL_MS);

    expect(actionTokenModel.deleteMany).toHaveBeenCalledWith({
      userId: USER_ID,
      type: ActionTokenType.PasswordReset,
    });
  });

  it('redeems a live token by hash and action, returning its owner', async () => {
    actionTokenModel.findOneAndDelete.mockReturnValue(
      withLean({ userId: USER_ID, expiresAt: new Date(Date.now() + 60_000) }),
    );

    expect(await service.redeem(ActionTokenType.PasswordReset, 'raw-token')).toBe(USER_ID);
    expect(actionTokenModel.findOneAndDelete).toHaveBeenCalledWith({
      tokenHash: sha256('raw-token'),
      type: ActionTokenType.PasswordReset,
    });
  });

  it('refuses an unknown token and one that expired before the TTL monitor got to it', async () => {
    actionTokenModel.findOneAndDelete.mockReturnValue(withLean(null));
    expect(await service.redeem(ActionTokenType.PasswordReset, 'forged')).toBeNull();

    actionTokenModel.findOneAndDelete.mockReturnValue(
      withLean({ userId: USER_ID, expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(await service.redeem(ActionTokenType.PasswordReset, 'stale')).toBeNull();
  });

  it('cannot redeem a token issued for another action', async () => {
    // The action is part of the lookup, so the wrong one simply finds nothing.
    actionTokenModel.findOneAndDelete.mockReturnValue(withLean(null));

    expect(await service.redeem(ActionTokenType.EmailVerification, 'a-reset-token')).toBeNull();
    expect(actionTokenModel.findOneAndDelete.mock.calls[0][0].type).toBe(ActionTokenType.EmailVerification);
  });

  it('drops every pending token of a deleted account, whatever the action', async () => {
    await service.deleteForUser(USER_ID);

    expect(actionTokenModel.deleteMany).toHaveBeenCalledWith({ userId: USER_ID });
  });
});
