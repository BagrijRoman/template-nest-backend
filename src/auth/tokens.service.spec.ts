import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { TokensService } from './tokens.service.js';

const ACCESS_SECRET = 'test-access-secret-of-32-plus-characters';
const REFRESH_SECRET = 'test-refresh-secret-of-32-plus-characters';
const USER_ID = '507f1f77bcf86cd799439011';
const SESSION_ID = '65f1a2b3c4d5e6f7a8b9c0d1';

const envMock: Record<string, string> = {
  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_SECRET: REFRESH_SECRET,
  JWT_REFRESH_TTL: '30d',
};

describe('TokensService', () => {
  let service: TokensService;
  // Standalone instance for crafting adversarial tokens (expired, wrong secret) in tests.
  const jwtService = new JwtService({});

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { getOrThrow: (key: string) => envMock[key] } },
      ],
    }).compile();

    service = module.get<TokensService>(TokensService);
  });

  it('issues a pair whose tokens verify with their own secret and name the user and session', async () => {
    const { accessToken, refreshToken } = await service.issueTokenPair(USER_ID, SESSION_ID);

    const accessPayload = await service.verifyAccessToken(accessToken);
    expect(accessPayload?.sub).toBe(USER_ID);
    expect(accessPayload?.sid).toBe(SESSION_ID);

    const refreshPayload = await service.verifyRefreshToken(refreshToken);
    expect(refreshPayload?.sub).toBe(USER_ID);
    expect(refreshPayload?.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an access token presented as a refresh token and vice versa', async () => {
    const { accessToken, refreshToken } = await service.issueTokenPair(USER_ID, SESSION_ID);

    expect(await service.verifyRefreshToken(accessToken)).toBeNull();
    expect(await service.verifyAccessToken(refreshToken)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const expired = await jwtService.signAsync({ sub: USER_ID }, { secret: ACCESS_SECRET, expiresIn: '-1s' });

    expect(await service.verifyAccessToken(expired)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = await jwtService.signAsync(
      { sub: USER_ID },
      { secret: 'attacker-controlled-secret-32-chars!!', expiresIn: '15m' },
    );

    expect(await service.verifyAccessToken(forged)).toBeNull();
  });

  it('rejects garbage that is not a JWT at all', async () => {
    expect(await service.verifyAccessToken('not-a-jwt')).toBeNull();
    expect(await service.verifyRefreshToken('')).toBeNull();
  });

  it('issues distinct refresh tokens for the same user back-to-back', async () => {
    const [first, second] = await Promise.all([
      service.issueTokenPair(USER_ID, SESSION_ID),
      service.issueTokenPair(USER_ID, SESSION_ID),
    ]);

    expect(first.refreshToken).not.toBe(second.refreshToken);
  });

  it('never puts anything beyond sub/sid/jti and standard claims into payloads', async () => {
    const { accessToken, refreshToken } = await service.issueTokenPair(USER_ID, SESSION_ID);

    const decode = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(Object.keys(decode(accessToken)).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
    expect(Object.keys(decode(refreshToken)).sort()).toEqual(['exp', 'iat', 'jti', 'sub']);
  });
});
