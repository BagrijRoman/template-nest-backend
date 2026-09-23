import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { unauthenticatedException } from '../errors/index.js';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokensService } from '../../auth/tokens.service.js';
import type { UserProfile } from '../../users/entities/index.js';
import { UsersService } from '../../users/users.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

// What authenticated request handlers see (via @CurrentUser): the caller as the store has them
// right now, so handlers and RolesGuard need no read of their own.
export type AuthenticatedUser = UserProfile;

const BEARER_PREFIX = 'Bearer ';
const MS_PER_SECOND = 1000;

const extractBearerToken = (request: Request): string | null => {
  const header = request.headers.authorization;
  return header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : null;
};

/**
 * `iat` has second precision, so the cutoff is compared in whole seconds: a token issued in the
 * same second as the revocation survives, while every earlier one is refused. Rounding the other
 * way would reject the fresh token that `POST /auth/change-password` hands back.
 */
const isIssuedBefore = (issuedAtSeconds: number, cutoff: Date | null): boolean =>
  cutoff !== null && issuedAtSeconds < Math.floor(cutoff.getTime() / MS_PER_SECOND);

/**
 * Global default-closed authentication: every route requires a valid access token unless it (or its
 * controller) is explicitly marked with @Public().
 *
 * The signature alone is not enough — the account is loaded on every authenticated request, so a
 * deleted account, a changed role and a password change all take effect immediately instead of
 * lingering until the token expires. That is one indexed read per request, deliberately paid.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokensService: TokensService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const token = extractBearerToken(request);
    const payload = token ? await this.tokensService.verifyAccessToken(token) : null;
    if (!payload) {
      throw unauthenticatedException();
    }

    const record = await this.usersService.findForAuthentication(payload.sub);
    // A vanished account and a token retired by a password change are both "no usable token".
    if (!record || isIssuedBefore(payload.iat, record.sessionsValidFrom)) {
      throw unauthenticatedException();
    }

    request.user = record.user;
    return true;
  }
}
