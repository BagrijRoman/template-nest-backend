import { HttpException } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors/index.js';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialsService } from '../users/credentials.service.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { EmailVerificationService } from './emailVerification.service.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { SignInLockoutService } from './signInLockout.service.js';
import { TokensService } from './tokens.service.js';

const USER = {
  id: '507f1f77bcf86cd799439011',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TOKEN_PAIR = { accessToken: 'access.token.jwt', refreshToken: 'refresh.token.jwt' };
const FAMILY_ID = 'e2a4b9a2-1c3d-4e5f-8a7b-9c0d1e2f3a4b';

describe('AuthService', () => {
  let service: AuthService;

  const usersService = { create: vi.fn(), findByEmail: vi.fn(), findById: vi.fn() };
  const credentialsService = { updatePassword: vi.fn(), verifyPassword: vi.fn() };
  const tokensService = { issueTokenPair: vi.fn() };
  const refreshTokensService = { consume: vi.fn(), persist: vi.fn(), revokeAllForUser: vi.fn() };
  const signInLockoutService = { assertNotLocked: vi.fn(), recordFailure: vi.fn(), reset: vi.fn() };
  const securityEvents = { record: vi.fn() };
  const emailVerificationService = { sendVerification: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    tokensService.issueTokenPair.mockResolvedValue(TOKEN_PAIR);
    refreshTokensService.persist.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: TokensService, useValue: tokensService },
        { provide: RefreshTokensService, useValue: refreshTokensService },
        { provide: SignInLockoutService, useValue: signInLockoutService },
        { provide: SecurityEventsService, useValue: securityEvents },
        { provide: EmailVerificationService, useValue: emailVerificationService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('signs up: creates the user, persists the refresh token, returns tokens with the user', async () => {
    usersService.create.mockResolvedValue(USER);

    const response = await service.signUp({
      email: USER.email,
      firstName: USER.firstName,
      lastName: USER.lastName,
      password: 'Secret123',
    });

    expect(response).toEqual({ ...TOKEN_PAIR, user: USER });
    expect(tokensService.issueTokenPair).toHaveBeenCalledWith(USER.id);
    expect(refreshTokensService.persist).toHaveBeenCalledWith(TOKEN_PAIR.refreshToken, expect.any(String));
    expect(emailVerificationService.sendVerification).toHaveBeenCalledWith(USER);
  });

  it('signs in with valid credentials and starts a session in a fresh token family', async () => {
    usersService.findByEmail.mockResolvedValue(USER);
    credentialsService.verifyPassword.mockResolvedValue(true);

    const response = await service.signIn({ email: USER.email, password: 'Secret123' });

    expect(response).toEqual({ ...TOKEN_PAIR, user: USER });
    expect(usersService.findByEmail).toHaveBeenCalledWith(USER.email);
    expect(credentialsService.verifyPassword).toHaveBeenCalledWith(USER.id, 'Secret123');
    expect(refreshTokensService.persist).toHaveBeenCalledWith(TOKEN_PAIR.refreshToken, expect.any(String));
  });

  it('starts a distinct token family for every sign-in', async () => {
    usersService.findByEmail.mockResolvedValue(USER);
    credentialsService.verifyPassword.mockResolvedValue(true);

    await service.signIn({ email: USER.email, password: 'Secret123' });
    await service.signIn({ email: USER.email, password: 'Secret123' });

    const [, firstFamily] = refreshTokensService.persist.mock.calls[0];
    const [, secondFamily] = refreshTokensService.persist.mock.calls[1];
    expect(firstFamily).not.toBe(secondFamily);
  });

  it('rejects bad credentials with a generic 401, records the failure and issues no tokens', async () => {
    usersService.findByEmail.mockResolvedValue(USER);
    credentialsService.verifyPassword.mockResolvedValue(false);

    await expect(service.signIn({ email: USER.email, password: 'Wrong123' })).rejects.toThrow(
      new AppException(401, ErrorCode.InvalidCredentials, 'Invalid email or password'),
    );
    expect(signInLockoutService.recordFailure).toHaveBeenCalledWith(USER.email);
    expect(signInLockoutService.reset).not.toHaveBeenCalled();
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.SignInFailed, { email: USER.email });
    expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
    expect(refreshTokensService.persist).not.toHaveBeenCalled();
  });

  it('still runs the password verification for an unknown email, against no account', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    credentialsService.verifyPassword.mockResolvedValue(false);

    await expect(service.signIn({ email: 'missing@example.com', password: 'Secret123' })).rejects.toThrow(
      new AppException(401, ErrorCode.InvalidCredentials, 'Invalid email or password'),
    );
    expect(credentialsService.verifyPassword).toHaveBeenCalledWith(null, 'Secret123');
  });

  it('checks the lockout before verifying credentials and resets it after success', async () => {
    usersService.findByEmail.mockResolvedValue(USER);
    credentialsService.verifyPassword.mockResolvedValue(true);

    await service.signIn({ email: USER.email, password: 'Secret123' });

    expect(signInLockoutService.assertNotLocked).toHaveBeenCalledWith(USER.email);
    expect(signInLockoutService.reset).toHaveBeenCalledWith(USER.email);
    expect(signInLockoutService.recordFailure).not.toHaveBeenCalled();
  });

  it('does not verify the password at all while the email is locked', async () => {
    const locked = new HttpException('Too many failed sign-in attempts, try again later', 429);
    signInLockoutService.assertNotLocked.mockRejectedValue(locked);

    await expect(service.signIn({ email: USER.email, password: 'Secret123' })).rejects.toThrow(locked);
    expect(credentialsService.verifyPassword).not.toHaveBeenCalled();
    expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
  });

  it('rotates: consumes the presented refresh token and issues the next pair in the same family', async () => {
    refreshTokensService.consume.mockResolvedValue({ userId: USER.id, familyId: FAMILY_ID });
    usersService.findById.mockResolvedValue(USER);

    const response = await service.refresh({ refreshToken: 'valid.refresh.jwt' });

    expect(response).toEqual({ ...TOKEN_PAIR, user: USER });
    expect(refreshTokensService.consume).toHaveBeenCalledWith('valid.refresh.jwt');
    expect(refreshTokensService.persist).toHaveBeenCalledWith(TOKEN_PAIR.refreshToken, FAMILY_ID);
  });

  it('rejects a refresh token that cannot be consumed with a generic 401 and issues nothing', async () => {
    refreshTokensService.consume.mockResolvedValue(null);

    await expect(service.refresh({ refreshToken: 'dead.refresh.jwt' })).rejects.toThrow(
      new AppException(401, ErrorCode.InvalidRefreshToken, 'Invalid refresh token'),
    );
    expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
  });

  it('rejects a refresh token whose account no longer exists with the same generic 401', async () => {
    refreshTokensService.consume.mockResolvedValue({ userId: USER.id, familyId: FAMILY_ID });
    usersService.findById.mockResolvedValue(null);

    await expect(service.refresh({ refreshToken: 'orphaned.refresh.jwt' })).rejects.toThrow(
      new AppException(401, ErrorCode.InvalidRefreshToken, 'Invalid refresh token'),
    );
    expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
  });

  it('changes the password: revokes every session, resets the lockout and hands back a fresh session', async () => {
    usersService.findById.mockResolvedValue(USER);
    credentialsService.updatePassword.mockResolvedValue(true);

    const response = await service.changePassword(USER.id, {
      currentPassword: 'OldSecret123',
      newPassword: 'NewSecret123',
    });

    expect(response).toEqual({ ...TOKEN_PAIR, user: USER });
    expect(credentialsService.updatePassword).toHaveBeenCalledWith(USER.id, 'OldSecret123', 'NewSecret123');
    expect(refreshTokensService.revokeAllForUser).toHaveBeenCalledWith(USER.id);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.PasswordChanged, { userId: USER.id });
    expect(signInLockoutService.reset).toHaveBeenCalledWith(USER.email);
  });

  it('rejects a wrong current password with 400, counts it toward the lockout and revokes nothing', async () => {
    usersService.findById.mockResolvedValue(USER);
    credentialsService.updatePassword.mockResolvedValue(false);

    await expect(
      service.changePassword(USER.id, { currentPassword: 'Wrong1234', newPassword: 'NewSecret123' }),
    ).rejects.toMatchObject({
      code: ErrorCode.WrongCurrentPassword,
      message: 'Current password is incorrect',
      details: [{ field: 'currentPassword' }],
    });
    expect(signInLockoutService.recordFailure).toHaveBeenCalledWith(USER.email);
    expect(refreshTokensService.revokeAllForUser).not.toHaveBeenCalled();
    expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
  });

  it('refuses to change the password while the email is locked, before verifying anything', async () => {
    usersService.findById.mockResolvedValue(USER);
    const locked = new HttpException('Too many failed sign-in attempts, try again later', 429);
    signInLockoutService.assertNotLocked.mockRejectedValue(locked);

    await expect(
      service.changePassword(USER.id, { currentPassword: 'OldSecret123', newPassword: 'NewSecret123' }),
    ).rejects.toThrow(locked);
    expect(credentialsService.updatePassword).not.toHaveBeenCalled();
  });

  it('logs out by consuming the token, and stays idempotent for an unredeemable one', async () => {
    refreshTokensService.consume.mockResolvedValue({ userId: USER.id, familyId: FAMILY_ID });
    await expect(service.logout({ refreshToken: 'valid.refresh.jwt' })).resolves.toBeUndefined();

    refreshTokensService.consume.mockResolvedValue(null);
    await expect(service.logout({ refreshToken: 'already.dead.jwt' })).resolves.toBeUndefined();

    expect(refreshTokensService.consume).toHaveBeenCalledTimes(2);
    expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
  });
});
