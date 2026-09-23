import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';

// Payloads stay minimal on purpose: a JWT is encoded, not encrypted — nothing sensitive belongs here.
// `iat` (seconds since epoch) is added by the JWT library at signing; the guard compares it against
// the account's session cutoff.
export type AccessTokenPayload = { sub: string; sid: string };
export type VerifiedAccessTokenPayload = AccessTokenPayload & { iat: number };
export type RefreshTokenPayload = { sub: string; jti: string };

// Verification also yields `exp` (seconds since epoch, added by the JWT library at signing);
// the refresh-token store mirrors it into its TTL so records die together with their tokens.
export type VerifiedRefreshTokenPayload = RefreshTokenPayload & { exp: number };

export type TokenPair = { accessToken: string; refreshToken: string };

// `expiresIn` accepts a number of seconds or an `ms`-style duration string; env validation already guarantees
// the TTLs match `<number><unit>`, so reading them as this type is sound without a runtime cast.
type JwtTtl = NonNullable<JwtSignOptions['expiresIn']>;

@Injectable()
export class TokensService {
  private readonly accessSecret: string;
  private readonly accessTtl: JwtTtl;
  private readonly refreshSecret: string;
  private readonly refreshTtl: JwtTtl;

  constructor(
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.accessTtl = config.getOrThrow<JwtTtl>('JWT_ACCESS_TTL');
    this.refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.refreshTtl = config.getOrThrow<JwtTtl>('JWT_REFRESH_TTL');
  }

  issueTokenPair(userId: string, sessionId: string): Promise<TokenPair> {
    // `jti` keeps back-to-back refresh tokens for one user distinct (`iat` has second precision) —
    // otherwise two identical tokens would collide in the hashed server-side store.
    const accessPayload: AccessTokenPayload = { sub: userId, sid: sessionId };
    const refreshPayload: RefreshTokenPayload = { sub: userId, jti: randomUUID() };

    return Promise.all([
      this.jwtService.signAsync(accessPayload, { secret: this.accessSecret, expiresIn: this.accessTtl }),
      this.jwtService.signAsync(refreshPayload, { secret: this.refreshSecret, expiresIn: this.refreshTtl }),
    ]).then(([accessToken, refreshToken]) => ({ accessToken, refreshToken }));
  }

  /** Returns the payload of a valid, unexpired access token; null for anything else (tampered, expired, wrong kind). */
  verifyAccessToken(token: string): Promise<VerifiedAccessTokenPayload | null> {
    return this.verify<VerifiedAccessTokenPayload>(token, this.accessSecret);
  }

  /** Returns the payload of a valid, unexpired refresh token; null for anything else (tampered, expired, wrong kind). */
  verifyRefreshToken(token: string): Promise<VerifiedRefreshTokenPayload | null> {
    return this.verify<VerifiedRefreshTokenPayload>(token, this.refreshSecret);
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
