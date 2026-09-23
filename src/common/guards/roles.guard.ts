import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { forbiddenException, unauthenticatedException } from '../errors/index.js';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../users/entities/index.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedUser } from './jwtAuth.guard.js';

/**
 * Enforces @Roles(): runs after JwtAuthGuard and reads the role off the caller JwtAuthGuard loaded
 * for this request, so a role change applies immediately (roles never travel in tokens) without a
 * second database read. Routes without @Roles() cost nothing here.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }

    // @Roles() on a @Public() route is a contradiction — resolved towards protection.
    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!user) {
      throw unauthenticatedException();
    }
    if (!roles.includes(user.role)) {
      throw forbiddenException();
    }
    return true;
  }
}
