import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { SafeUser } from '../users/entities/index.js';
import { UsersService } from '../users/users.service.js';
import { AuthResponseDto, RefreshTokenDto, SignInDto, SignUpDto } from './dto/index.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { TokensService } from './tokens.service.js';

// One generic message for unknown email and wrong password — no account enumeration.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
// One generic message for expired, revoked, already-used and forged tokens alike.
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid refresh token';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
    private readonly refreshTokensService: RefreshTokensService,
  ) {}

  async signUp(signUpDto: SignUpDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create(signUpDto);
    return this.issueSession(user);
  }

  async signIn(signInDto: SignInDto): Promise<AuthResponseDto> {
    const user = await this.usersService.verifyPassword(signInDto.email, signInDto.password);
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    return this.issueSession(user);
  }

  /** Rotation: redeeming the presented token destroys it, and a fresh pair is issued instead. */
  async refresh(refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    const userId = await this.refreshTokensService.consume(refreshTokenDto.refreshToken);
    if (!userId) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      // The account is gone; the token has already been consumed, so nothing is left to revoke.
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    return this.issueSession(user);
  }

  /**
   * Idempotent: an already-revoked or invalid token still ends in "logged out" — a retry after a
   * network failure must succeed, and probing token validity here would tell an attacker nothing
   * they could use (redeeming happens only through refresh, which does answer 401).
   */
  async logout(refreshTokenDto: RefreshTokenDto): Promise<void> {
    await this.refreshTokensService.consume(refreshTokenDto.refreshToken);
  }

  /** Issues a token pair and persists the refresh token so it can be redeemed (and revoked) later. */
  private async issueSession(user: SafeUser): Promise<AuthResponseDto> {
    const tokenPair = await this.tokensService.issueTokenPair(user.id);
    await this.refreshTokensService.persist(tokenPair.refreshToken);
    return { ...tokenPair, user };
  }
}
