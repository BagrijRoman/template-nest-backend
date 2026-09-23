import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailService } from '../common/mail/mail.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { UsersService } from '../users/users.service.js';
import { RefreshToken } from './entities/index.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

const REFRESH_SECRET = 'test-refresh-secret-of-32-plus-characters';
const USER_ID = '507f1f77bcf86cd799439011';
const SESSION_ID = '65f1a2b3c4d5e6f7a8b9c0d1';

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

  const securityEvents = { record: vi.fn() };
  const usersService = { findById: vi.fn() };
  const mailService = { send: vi.fn() };
  const sessionsService = { delete: vi.fn(), deleteAllForUser: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    refreshTokenModel.deleteMany.mockResolvedValue({ deletedCount: 0 });
    usersService.findById.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokensService,
        TokensService,
        { provide: JwtService, useValue: new JwtService({}) },
        { provide: ConfigService, useValue: { getOrThrow: (key: string) => envMock[key] } },
        { provide: getModelToken(RefreshToken.name), useValue: refreshTokenModel },
        { provide: SecurityEventsService, useValue: securityEvents },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
        { provide: SessionsService, useValue: sessionsService },
      ],
    }).compile();

    service = module.get<RefreshTokensService>(RefreshTokensService);
    tokensService = module.get<TokensService>(TokensService);
  });

  const issueRefreshToken = async () => (await tokensService.issueTokenPair(USER_ID, SESSION_ID)).refreshToken;

  it('persists the hash of the token inside the given session, never the token itself', async () => {
    const refreshToken = await issueRefreshToken();

    await service.persist(refreshToken, SESSION_ID);

    const stored = refreshTokenModel.create.mock.calls[0][0];
    expect(stored.tokenHash).toBe(sha256(refreshToken));
    expect(stored.userId).toBe(USER_ID);
    expect(stored.sessionId).toBe(SESSION_ID);
    expect(stored.consumedAt).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(refreshToken);
  });

  it('persists an expiry that mirrors the token exp claim and reports it back', async () => {
    const refreshToken = await issueRefreshToken();
    const payload = await tokensService.verifyRefreshToken(refreshToken);
    const expected = new Date((payload?.exp ?? 0) * 1000);

    // The caller keeps the session alive exactly as long as the token it just stored.
    expect(await service.persist(refreshToken, SESSION_ID)).toEqual(expected);
    expect(refreshTokenModel.create.mock.calls[0][0].expiresAt).toEqual(expected);
  });

  it('refuses to persist an invalid token', async () => {
    await expect(service.persist('not-a-jwt', SESSION_ID)).rejects.toThrow();
    expect(refreshTokenModel.create).not.toHaveBeenCalled();
  });

  it('consumes an unconsumed token: marks it consumed by hash and returns owner and session', async () => {
    const refreshToken = await issueRefreshToken();
    refreshTokenModel.findOneAndUpdate.mockReturnValue(withLean({ userId: USER_ID, sessionId: SESSION_ID }));

    expect(await service.consume(refreshToken)).toEqual({ userId: USER_ID, sessionId: SESSION_ID });

    const [filter, update] = refreshTokenModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ tokenHash: sha256(refreshToken), consumedAt: null });
    expect(update.consumedAt).toBeInstanceOf(Date);
    expect(refreshTokenModel.deleteMany).not.toHaveBeenCalled();
  });

  it('detects reuse of a consumed token: revokes the whole session and returns null', async () => {
    const refreshToken = await issueRefreshToken();
    refreshTokenModel.findOneAndUpdate.mockReturnValue(withLean(null));
    refreshTokenModel.findOne.mockReturnValue(
      withLean({ userId: USER_ID, sessionId: SESSION_ID, consumedAt: new Date() }),
    );

    expect(await service.consume(refreshToken)).toBeNull();
    // The session goes with its tokens: nothing redeemable and no stale row in the device list.
    expect(refreshTokenModel.deleteMany).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    expect(sessionsService.delete).toHaveBeenCalledWith(SESSION_ID);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.RefreshTokenReuseDetected, {
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
  });

  it('emails the owner when reuse terminates their session', async () => {
    const refreshToken = await issueRefreshToken();
    refreshTokenModel.findOneAndUpdate.mockReturnValue(withLean(null));
    refreshTokenModel.findOne.mockReturnValue(
      withLean({ userId: USER_ID, sessionId: SESSION_ID, consumedAt: new Date() }),
    );
    usersService.findById.mockResolvedValue({ id: USER_ID, email: 'jane@example.com' });

    await service.consume(refreshToken);

    expect(mailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com', subject: expect.stringContaining('Suspicious') }),
    );
  });

  it('returns null for an unknown token without revoking anything', async () => {
    const refreshToken = await issueRefreshToken();
    refreshTokenModel.findOneAndUpdate.mockReturnValue(withLean(null));
    refreshTokenModel.findOne.mockReturnValue(withLean(null));

    expect(await service.consume(refreshToken)).toBeNull();
    expect(refreshTokenModel.deleteMany).not.toHaveBeenCalled();
  });

  it('revokes every session of a user at once, rows and tokens alike', async () => {
    await service.revokeAllForUser(USER_ID);

    expect(refreshTokenModel.deleteMany).toHaveBeenCalledWith({ userId: USER_ID });
    expect(sessionsService.deleteAllForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('revokes one session on request, rows and tokens alike', async () => {
    await service.revokeSession(SESSION_ID);

    expect(refreshTokenModel.deleteMany).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    expect(sessionsService.delete).toHaveBeenCalledWith(SESSION_ID);
  });

  it('returns null for an invalid token without touching the database', async () => {
    expect(await service.consume('not-a-jwt')).toBeNull();
    expect(refreshTokenModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(refreshTokenModel.findOne).not.toHaveBeenCalled();
  });
});
