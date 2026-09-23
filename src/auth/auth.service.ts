import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ErrorCode, unauthenticatedException } from '../common/errors/index.js';
import { CredentialsService } from '../users/credentials.service.js';
import type { UserProfile } from '../users/entities/index.js';
import { UsersService } from '../users/users.service.js';
import {
  AuthResponseDto,
  ChangePasswordDto,
  DeleteAccountDto,
  RefreshTokenDto,
  SignInDto,
  SignUpDto,
} from './dto/index.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { EmailVerificationService } from './emailVerification.service.js';
import { MailService } from '../common/mail/mail.service.js';
import { PasswordResetService } from './passwordReset.service.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { SignInLockoutService } from './signInLockout.service.js';
import { TokensService } from './tokens.service.js';

// One generic message for unknown email and wrong password — no account enumeration.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
// One generic message for expired, revoked, already-used and forged tokens alike.
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid refresh token';
const WRONG_CURRENT_PASSWORD_MESSAGE = 'Current password is incorrect';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly credentialsService: CredentialsService,
    private readonly tokensService: TokensService,
    private readonly refreshTokensService: RefreshTokensService,
    private readonly signInLockoutService: SignInLockoutService,
    private readonly securityEvents: SecurityEventsService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordResetService: PasswordResetService,
    private readonly mailService: MailService,
  ) {}

  async signUp(signUpDto: SignUpDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create(signUpDto);
    this.securityEvents.record(SecurityEvent.UserSignedUp, { userId: user.id });
    await this.emailVerificationService.sendVerification(user);
    return this.issueSession(user);
  }

  async signIn(signInDto: SignInDto): Promise<AuthResponseDto> {
    await this.signInLockoutService.assertNotLocked(signInDto.email);

    const user = await this.usersService.findByEmail(signInDto.email);
    // Runs for an unknown email too: the dummy verification inside keeps response timing uniform.
    const isValid = await this.credentialsService.verifyPassword(user?.id ?? null, signInDto.password);
    if (!user || !isValid) {
      await this.signInLockoutService.recordFailure(signInDto.email);
      this.securityEvents.record(SecurityEvent.SignInFailed, { email: signInDto.email });
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.InvalidCredentials, INVALID_CREDENTIALS_MESSAGE);
    }

    await this.signInLockoutService.reset(signInDto.email);
    this.securityEvents.record(SecurityEvent.SignInSucceeded, { userId: user.id });
    return this.issueSession(user);
  }

  /** Rotation: redeeming the presented token destroys it, and a fresh pair is issued in the same family. */
  async refresh(refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    const consumed = await this.refreshTokensService.consume(refreshTokenDto.refreshToken);
    if (!consumed) {
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.InvalidRefreshToken, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const user = await this.usersService.findById(consumed.userId);
    if (!user) {
      // The account is gone; the token has already been consumed, so nothing is left to revoke.
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.InvalidRefreshToken, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    this.securityEvents.record(SecurityEvent.TokenRefreshed, { userId: user.id, familyId: consumed.familyId });
    return this.issueSession(user, consumed.familyId);
  }

  /**
   * Idempotent: an already-revoked or invalid token still ends in "logged out" — a retry after a
   * network failure must succeed, and probing token validity here would tell an attacker nothing
   * they could use (redeeming happens only through refresh, which does answer 401).
   */
  async logout(refreshTokenDto: RefreshTokenDto): Promise<void> {
    const consumed = await this.refreshTokensService.consume(refreshTokenDto.refreshToken);
    if (consumed) {
      this.securityEvents.record(SecurityEvent.LoggedOut, { userId: consumed.userId, familyId: consumed.familyId });
    }
  }

  /**
   * Requires the current password even with a valid access token (a stolen token must not be
   * enough to take the account over), counts wrong attempts toward the sign-in lockout (the
   * endpoint must not become a quieter place to brute-force), revokes every session on success
   * and hands the calling device a fresh one.
   */
  async changePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw unauthenticatedException();
    }

    await this.signInLockoutService.assertNotLocked(user.email);

    const isChanged = await this.credentialsService.updatePassword(
      userId,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
    if (!isChanged) {
      await this.signInLockoutService.recordFailure(user.email);
      this.securityEvents.record(SecurityEvent.PasswordChangeRejected, { userId });
      // 400, not 401: a 401 would make clients treat the access token as dead and force a logout.
      throw AppException.forField(
        HttpStatus.BAD_REQUEST,
        ErrorCode.WrongCurrentPassword,
        'currentPassword',
        'matchesCurrentPassword',
        WRONG_CURRENT_PASSWORD_MESSAGE,
      );
    }

    await this.signInLockoutService.reset(user.email);
    // Both halves of "sign out everywhere": the stored refresh tokens die, and access tokens issued
    // before now stop authenticating. The fresh pair below is issued after the cutoff.
    await Promise.all([
      this.refreshTokensService.revokeAllForUser(userId),
      this.usersService.markSessionsRevoked(userId),
    ]);
    this.securityEvents.record(SecurityEvent.PasswordChanged, { userId });
    return this.issueSession(user);
  }

  /**
   * Closes the account for good. The current password is required for the same reason as on a
   * password change: a stolen access token must not be enough to destroy someone's account.
   *
   * The user row goes first, so every session stops authenticating even if a later step fails;
   * each module then drops the data it owns. Per-account rate-limit counters are left to their TTL —
   * they are keyed by a user id that is never handed out again.
   */
  async deleteAccount(userId: string, deleteAccountDto: DeleteAccountDto): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw unauthenticatedException();
    }

    await this.signInLockoutService.assertNotLocked(user.email);
    if (!(await this.credentialsService.verifyPassword(userId, deleteAccountDto.currentPassword))) {
      await this.signInLockoutService.recordFailure(user.email);
      this.securityEvents.record(SecurityEvent.AccountDeletionRejected, { userId });
      throw AppException.forField(
        HttpStatus.BAD_REQUEST,
        ErrorCode.WrongCurrentPassword,
        'currentPassword',
        'matchesCurrentPassword',
        WRONG_CURRENT_PASSWORD_MESSAGE,
      );
    }

    await this.usersService.delete(userId);
    await Promise.all([
      this.credentialsService.deleteForUser(userId),
      this.refreshTokensService.revokeAllForUser(userId),
      this.passwordResetService.deleteForUser(userId),
      this.emailVerificationService.deleteForUser(userId),
      this.signInLockoutService.reset(user.email),
    ]);

    this.securityEvents.record(SecurityEvent.AccountDeleted, { userId });
    await this.mailService.send({
      to: user.email,
      subject: 'Your account was deleted',
      text:
        'Your account and everything stored with it have been deleted. ' +
        'If this was not you, contact support immediately — the address can no longer be recovered by signing in.',
    });
  }

  /**
   * Issues a token pair and persists the refresh token so it can be redeemed (and revoked) later.
   * Sign-up/sign-in start a new token family (one per device session); rotation stays in its own.
   */
  private async issueSession(user: UserProfile, familyId: string = randomUUID()): Promise<AuthResponseDto> {
    const tokenPair = await this.tokensService.issueTokenPair(user.id);
    await this.refreshTokensService.persist(tokenPair.refreshToken, familyId);
    return { ...tokenPair, user };
  }
}
