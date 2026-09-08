import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshToken } from './entities/index.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { TokensService } from './tokens.service.js';

const REFRESH_SECRET = 'test-refresh-secret-of-32-plus-characters';
const USER_ID = '507f1f77bcf86cd799439011';
const FAMILY_ID = 'e2a4b9a2-1c3d-4e5f-8a7b-9c0d1e2f3a4b';

const envMock: Record<string, string> = {
  JWT_ACCESS_SECRET: 'test-access-secret-of-32-plus-characters',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_SECRET: REFRESH_SECRET,
  JWT_REFRESH_TTL: '30d',
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const withLean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('RefreshTokensService', () => {
  let service: RefreshTokensService;
  let tokensService: TokensService;

  const refreshTokenModel = {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    refreshTokenModel.deleteMany.mockResolvedValue({ deletedCount: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokensService,
        TokensService,
        { provide: JwtService, useValue: new JwtService({}) },
        { provide: ConfigService, useValue: { getOrThrow: (key: string) => envMock[key] } },
        { provide: getModelToken(RefreshToken.name), useValue: refreshTokenModel },
      ],
    }).compile();

    service = module.get<RefreshTokensService>(RefreshTokensService);
    tokensService = module.get<TokensService>(TokensService);
  });

  const issueRefreshToken = async () => (await tokensService.issueTokenPair(USER_ID)).refreshToken;

  it('persists the hash of the token inside the given family, never the token itself', async () => {
    const refreshToken = await issueRefreshToken();

    await service.persist(refreshToken, FAMILY_ID);

    const stored = refreshTokenModel.create.mock.calls[0][0];
    expect(stored.tokenHash).toBe(sha256(refreshToken));
    expect(stored.userId).toBe(USER_ID);
    expect(stored.familyId).toBe(FAMILY_ID);
    expect(stored.consumedAt).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(refreshToken);
  });

  it('persists an expiry that mirrors the token exp claim', async () => {
    const refreshToken = await issueRefreshToken();
    const payload = await tokensService.verifyRefreshToken(refreshToken);

    await service.persist(refreshToken, FAMILY_ID);

    const stored = refreshTokenModel.create.mock.calls[0][0];
    expect(stored.expiresAt).toEqual(new Date((payload?.exp ?? 0) * 1000));
  });

  it('refuses to persist an invalid token', async () => {
    await expect(service.persist('not-a-jwt', FAMILY_ID)).rejects.toThrow();
    expect(refreshTokenModel.create).not.toHaveBeenCalled();
  });

  it('consumes an unconsumed token: marks it consumed by hash and returns owner and family', async () => {
    const refreshToken = await issueRefreshToken();
    refreshTokenModel.findOneAndUpdate.mockReturnValue(withLean({ userId: USER_ID, familyId: FAMILY_ID }));

    expect(await service.consume(refreshToken)).toEqual({ userId: USER_ID, familyId: FAMILY_ID });

    const [filter, update] = refreshTokenModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ tokenHash: sha256(refreshToken), consumedAt: null });
    expect(update.consumedAt).toBeInstanceOf(Date);
    expect(refreshTokenModel.deleteMany).not.toHaveBeenCalled();
  });

  it('detects reuse of a consumed token: revokes the whole family and returns null', async () => {
    const refreshToken = await issueRefreshToken();
    refreshTokenModel.findOneAndUpdate.mockReturnValue(withLean(null));
    refreshTokenModel.findOne.mockReturnValue(
      withLean({ userId: USER_ID, familyId: FAMILY_ID, consumedAt: new Date() }),
    );

    expect(await service.consume(refreshToken)).toBeNull();
    expect(refreshTokenModel.deleteMany).toHaveBeenCalledWith({ familyId: FAMILY_ID });
  });

  it('returns null for an unknown token without revoking anything', async () => {
    const refreshToken = await issueRefreshToken();
    refreshTokenModel.findOneAndUpdate.mockReturnValue(withLean(null));
    refreshTokenModel.findOne.mockReturnValue(withLean(null));

    expect(await service.consume(refreshToken)).toBeNull();
    expect(refreshTokenModel.deleteMany).not.toHaveBeenCalled();
  });

  it('returns null for an invalid token without touching the database', async () => {
    expect(await service.consume('not-a-jwt')).toBeNull();
    expect(refreshTokenModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(refreshTokenModel.findOne).not.toHaveBeenCalled();
  });
});
