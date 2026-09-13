import { ExecutionContext } from '@nestjs/common';
import { AppException, ErrorCode } from '../errors/index.js';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokensService } from '../../auth/tokens.service.js';
import { AuthenticatedUser, JwtAuthGuard } from './jwtAuth.guard.js';

const USER_ID = '507f1f77bcf86cd799439011';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  const reflector = { getAllAndOverride: vi.fn() };
  const tokensService = { verifyAccessToken: vi.fn() };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: reflector },
        { provide: TokensService, useValue: tokensService },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('lets a @Public() route through without any token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context } = buildContext();

    expect(await guard.canActivate(context)).toBe(true);
    expect(tokensService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('attaches the authenticated user for a valid bearer token', async () => {
    tokensService.verifyAccessToken.mockResolvedValue({ sub: USER_ID });
    const { context, request } = buildContext('Bearer valid.access.jwt');

    expect(await guard.canActivate(context)).toBe(true);
    expect(tokensService.verifyAccessToken).toHaveBeenCalledWith('valid.access.jwt');
    expect(request.user).toEqual({ id: USER_ID });
  });

  it.each([
    ['a missing Authorization header', undefined],
    ['a non-bearer Authorization header', 'Basic dXNlcjpwYXNz'],
    ['an invalid bearer token', 'Bearer expired.or.forged'],
  ])('rejects %s with the same 401', async (_label, authorization) => {
    const { context } = buildContext(authorization);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new AppException(401, ErrorCode.Unauthenticated, 'Invalid or missing access token'),
    );
  });
});
