import { ExecutionContext } from '@nestjs/common';
import { AppException, ErrorCode } from '../errors/index.js';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../users/entities/index.js';
import { UsersService } from '../../users/users.service.js';
import type { AuthenticatedUser } from './jwtAuth.guard.js';
import { RolesGuard } from './roles.guard.js';

const USER_ID = '507f1f77bcf86cd799439011';

describe('RolesGuard', () => {
  let guard: RolesGuard;

  const reflector = { getAllAndOverride: vi.fn() };
  const usersService = { findById: vi.fn() };

  const buildContext = (user?: AuthenticatedUser): ExecutionContext =>
    ({
      getHandler: () => vi.fn(),
      getClass: () => vi.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    vi.resetAllMocks();
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: reflector },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
  });

  it('lets a route without @Roles() through without touching the database', async () => {
    expect(await guard.canActivate(buildContext({ id: USER_ID }))).toBe(true);

    reflector.getAllAndOverride.mockReturnValue([]);
    expect(await guard.canActivate(buildContext({ id: USER_ID }))).toBe(true);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('admits a caller whose current role is listed', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);
    usersService.findById.mockResolvedValue({ id: USER_ID, role: UserRole.Admin });

    expect(await guard.canActivate(buildContext({ id: USER_ID }))).toBe(true);
    expect(usersService.findById).toHaveBeenCalledWith(USER_ID);
  });

  it('rejects a caller with another role with 403', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);
    usersService.findById.mockResolvedValue({ id: USER_ID, role: UserRole.User });

    await expect(guard.canActivate(buildContext({ id: USER_ID }))).rejects.toThrow(
      new AppException(403, ErrorCode.Forbidden, 'Insufficient permissions'),
    );
  });

  it.each([
    ['no authenticated user on the request', undefined, null],
    ['an authenticated user whose account vanished', { id: USER_ID }, null],
  ])('answers 401 for %s', async (_label, caller, found) => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);
    usersService.findById.mockResolvedValue(found);

    await expect(guard.canActivate(buildContext(caller))).rejects.toThrow(
      new AppException(401, ErrorCode.Unauthenticated, 'Invalid or missing access token'),
    );
  });
});
