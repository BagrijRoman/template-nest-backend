import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ErrorCode, unauthenticatedException } from '../common/errors/index.js';
import type { SafeUser } from '../users/entities/index.js';
import { UsersService } from '../users/users.service.js';
import { AuthResponseDto, ChangePasswordDto, RefreshTokenDto, SignInDto, SignUpDto } from './dto/index.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { EmailVerificationService } from './emailVerification.service.js';
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
    private readonly tokensService: TokensService,
    private readonly refreshTokensService: RefreshTokensService,
    private readonly signInLockoutService: SignInLockoutService,
    private readonly securityEvents: SecurityEventsService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  async signUp(signUpDto: SignUpDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create(signUpDto);
    this.securityEvents.record(SecurityEvent.UserSignedUp, { userId: user.id });
    await this.emailVerificationService.sendVerification(user);
    return this.issueSession(user);
  }

  async signIn(signInDto: SignInDto): Promise<AuthResponseDto> {
    await this.signInLockoutService.assertNotLocked(signInDto.email);

    const user = await this.usersService.verifyPassword(signInDto.email, signInDto.password);
    if (!user) {
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

    const updated = await this.usersService.updatePassword(
      userId,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
    if (!updated) {
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
    await this.refreshTokensService.revokeAllForUser(userId);
    this.securityEvents.record(SecurityEvent.PasswordChanged, { userId });
    return this.issueSession(updated);
  }

  /**
   * Issues a token pair and persists the refresh token so it can be redeemed (and revoked) later.
   * Sign-up/sign-in start a new token family (one per device session); rotation stays in its own.
   */
  private async issueSession(user: SafeUser, familyId: string = randomUUID()): Promise<AuthResponseDto> {
    const tokenPair = await this.tokensService.issueTokenPair(user.id);
    await this.refreshTokensService.persist(tokenPair.refreshToken, familyId);
    return { ...tokenPair, user };
  }
}
