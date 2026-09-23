import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { forbiddenException, unauthenticatedException } from '../errors/index.js';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../users/entities/index.js';
import { UsersService } from '../../users/users.service.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedUser } from './jwtAuth.guard.js';

/**
 * Enforces @Roles(): runs after JwtAuthGuard and reads the caller's current role from the database,
 * so a role change takes effect immediately instead of living in a token until it expires. Routes
 * without @Roles() cost nothing here.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }

    // @Roles() on a @Public() route is a contradiction — resolved towards protection.
    const { user: caller } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = caller ? await this.usersService.findById(caller.id) : null;
    if (!user) {
      throw unauthenticatedException();
    }
    if (!roles.includes(user.role)) {
      throw forbiddenException();
    }
    return true;
  }
}
