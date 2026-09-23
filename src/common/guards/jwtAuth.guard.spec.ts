import { ExecutionContext } from '@nestjs/common';
import { AppException, ErrorCode } from '../errors/index.js';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokensService } from '../../auth/tokens.service.js';
import { UserRole } from '../../users/entities/index.js';
import { UsersService } from '../../users/users.service.js';
import { AuthenticatedUser, JwtAuthGuard } from './jwtAuth.guard.js';

const USER_ID = '507f1f77bcf86cd799439011';
const MS_PER_SECOND = 1000;
const NOW_SECONDS = Math.floor(Date.now() / MS_PER_SECOND);

const USER: AuthenticatedUser = {
  id: USER_ID,
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  emailVerified: false,
  role: UserRole.User,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  const reflector = { getAllAndOverride: vi.fn() };
  const tokensService = { verifyAccessToken: vi.fn() };
  const usersService = { findForAuthentication: vi.fn() };

  const buildContext = (authorization?: string) => {
    const request: { headers: Record<string, string>; user?: AuthenticatedUser } = {
      headers: authorization ? { authorization } : {},
    };
    const context = {
      getHandler: () => vi.fn(),
      getClass: () => vi.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);
    tokensService.verifyAccessToken.mockResolvedValue(null);
    usersService.findForAuthentication.mockResolvedValue({ user: USER, sessionsValidFrom: null });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: reflector },
        { provide: TokensService, useValue: tokensService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('lets a @Public() route through without any token or lookup', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context } = buildContext();

    expect(await guard.canActivate(context)).toBe(true);
    expect(tokensService.verifyAccessToken).not.toHaveBeenCalled();
    expect(usersService.findForAuthentication).not.toHaveBeenCalled();
  });

  it('attaches the account the store holds right now, not the token payload', async () => {
    tokensService.verifyAccessToken.mockResolvedValue({ sub: USER_ID, iat: NOW_SECONDS });
    const { context, request } = buildContext('Bearer valid.access.jwt');

    expect(await guard.canActivate(context)).toBe(true);
    expect(tokensService.verifyAccessToken).toHaveBeenCalledWith('valid.access.jwt');
    expect(usersService.findForAuthentication).toHaveBeenCalledWith(USER_ID);
    expect(request.user).toBe(USER);
  });

  it.each([
    ['a missing Authorization header', undefined],
    ['a non-bearer Authorization header', 'Basic dXNlcjpwYXNz'],
    ['an invalid bearer token', 'Bearer expired.or.forged'],
  ])('rejects %s with the same 401, without a lookup', async (_label, authorization) => {
    const { context } = buildContext(authorization);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new AppException(401, ErrorCode.Unauthenticated, 'Invalid or missing access token'),
    );
    expect(usersService.findForAuthentication).not.toHaveBeenCalled();
  });

  it('rejects a signature-valid token whose account is gone', async () => {
    tokensService.verifyAccessToken.mockResolvedValue({ sub: USER_ID, iat: NOW_SECONDS });
    usersService.findForAuthentication.mockResolvedValue(null);
    const { context } = buildContext('Bearer orphaned.access.jwt');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new AppException(401, ErrorCode.Unauthenticated, 'Invalid or missing access token'),
    );
  });

  it('rejects a token issued before the account revoked its sessions', async () => {
    tokensService.verifyAccessToken.mockResolvedValue({ sub: USER_ID, iat: NOW_SECONDS - 60 });
    usersService.findForAuthentication.mockResolvedValue({ user: USER, sessionsValidFrom: new Date() });
    const { context } = buildContext('Bearer retired.access.jwt');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new AppException(401, ErrorCode.Unauthenticated, 'Invalid or missing access token'),
    );
  });

  it('admits a token issued in the same second as the revocation — the pair a password change hands back', async () => {
    const cutoff = new Date();
    tokensService.verifyAccessToken.mockResolvedValue({
      sub: USER_ID,
      iat: Math.floor(cutoff.getTime() / MS_PER_SECOND),
    });
    usersService.findForAuthentication.mockResolvedValue({ user: USER, sessionsValidFrom: cutoff });
    const { context } = buildContext('Bearer fresh.access.jwt');

    expect(await guard.canActivate(context)).toBe(true);
  });
});
