import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { unauthenticatedException } from '../errors/index.js';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokensService } from '../../auth/tokens.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

// What authenticated request handlers see (via @CurrentUser). Deliberately just the id: the guard
// stays database-free — an access token authenticates by signature alone.
export type AuthenticatedUser = { id: string };

const BEARER_PREFIX = 'Bearer ';

const extractBearerToken = (request: Request): string | null => {
  const header = request.headers.authorization;
  return header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : null;
};

/**
 * Global default-closed authentication: every route requires a valid access token
 * unless it (or its controller) is explicitly marked with @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokensService: TokensService,
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

    request.user = { id: payload.sub };
    return true;
  }
}
