import { ExecutionContext } from '@nestjs/common';
import { AppException, ErrorCode } from '../errors/index.js';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../users/entities/index.js';
import type { AuthenticatedUser } from './jwtAuth.guard.js';
import { RolesGuard } from './roles.guard.js';

const caller = (role: UserRole): AuthenticatedUser => ({
  id: '507f1f77bcf86cd799439011',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  emailVerified: false,
  role,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('RolesGuard', () => {
  let guard: RolesGuard;

  const reflector = { getAllAndOverride: vi.fn() };

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
      providers: [RolesGuard, { provide: Reflector, useValue: reflector }],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
  });

  it('lets a route without @Roles() through, even with no caller attached', () => {
    expect(guard.canActivate(buildContext())).toBe(true);

    reflector.getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('admits a caller whose role is listed', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);

    expect(guard.canActivate(buildContext(caller(UserRole.Admin)))).toBe(true);
  });

  it('rejects a caller with another role with 403', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);

    expect(() => guard.canActivate(buildContext(caller(UserRole.User)))).toThrow(
      new AppException(403, ErrorCode.Forbidden, 'Insufficient permissions'),
    );
  });

  it('answers 401 when no authenticated caller reached the guard', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);

    expect(() => guard.canActivate(buildContext())).toThrow(
      new AppException(401, ErrorCode.Unauthenticated, 'Invalid or missing access token'),
    );
  });
});
