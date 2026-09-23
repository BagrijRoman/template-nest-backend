import { ErrorResponseDto } from '../common/errors/index.js';
import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/currentUser.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/index.js';
import type { AuthenticatedUser } from '../common/guards/jwtAuth.guard.js';
import { UserListResponseDto, UserResponseDto } from './dto/index.js';
import { UserRole, type UserProfile } from './entities/index.js';
import { UserPage, UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid or missing access token' })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // The reference role-restricted endpoint: admins page through every account.
  @Get()
  @Roles(UserRole.Admin)
  @ApiOperation({ summary: 'List users (admin only)' })
  @ApiOkResponse({ type: UserListResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'The caller is not an admin' })
  list(@Query() paginationQuery: PaginationQueryDto): Promise<UserPage> {
    return this.usersService.findPage(paginationQuery.limit, paginationQuery.offset);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user' })
  @ApiOkResponse({ type: UserResponseDto })
  // JwtAuthGuard loaded the account to authenticate the request; re-reading it here would be a
  // second query for the same document.
  getMe(@CurrentUser() currentUser: AuthenticatedUser): UserProfile {
    return currentUser;
  }
}
