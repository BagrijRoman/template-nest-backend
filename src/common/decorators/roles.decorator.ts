import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../users/entities/index.js';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route (or a whole controller) to callers holding one of the given roles; RolesGuard
 * enforces it after authentication. Routes without it are open to every authenticated user.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
