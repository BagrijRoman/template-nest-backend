import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

// Payloads stay minimal on purpose: a JWT is encoded, not encrypted — nothing sensitive belongs here.
export type AccessTokenPayload = { sub: string };
export type RefreshTokenPayload = { sub: string; jti: string };

export type TokenPair = { accessToken: string; refreshToken: string };

@Injectable()
export class TokensService {
  private readonly accessSecret: string;
  private readonly accessTtl: string;
  private readonly refreshSecret: string;
  private readonly refreshTtl: string;

  constructor(
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.accessTtl = config.getOrThrow<string>('JWT_ACCESS_TTL');
    this.refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.refreshTtl = config.getOrThrow<string>('JWT_REFRESH_TTL');
  }

  issueTokenPair(userId: string): Promise<TokenPair> {
    // `jti` keeps back-to-back refresh tokens for one user distinct (`iat` has second precision) —
    // otherwise two identical tokens would collide in the hashed server-side store.
    const accessPayload: AccessTokenPayload = { sub: userId };
    const refreshPayload: RefreshTokenPayload = { sub: userId, jti: randomUUID() };

    return Promise.all([
      this.jwtService.signAsync(accessPayload, { secret: this.accessSecret, expiresIn: this.accessTtl }),
      this.jwtService.signAsync(refreshPayload, { secret: this.refreshSecret, expiresIn: this.refreshTtl }),
    ]).then(([accessToken, refreshToken]) => ({ accessToken, refreshToken }));
  }

  /** Returns the payload of a valid, unexpired access token; null for anything else (tampered, expired, wrong kind). */
  verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    return this.verify<AccessTokenPayload>(token, this.accessSecret);
  }

  /** Returns the payload of a valid, unexpired refresh token; null for anything else (tampered, expired, wrong kind). */
  verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
    return this.verify<RefreshTokenPayload>(token, this.refreshSecret);
  }

  private async verify<T extends object>(token: string, secret: string): Promise<T | null> {
    try {
      return await this.jwtService.verifyAsync<T>(token, { secret });
    } catch {
      // Invalid input, not an unexpected failure: callers translate null into a generic 401.
      return null;
    }
  }
}
