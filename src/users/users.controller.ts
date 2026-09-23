import { ErrorResponseDto } from '../common/errors/index.js';
import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { UpdateProfileDto, UserListResponseDto, UserResponseDto } from './dto/index.js';
import { UserRole, type UserProfile } from './entities/index.js';
import { UserPage, UsersService } from './users.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { unauthenticatedException } from '../common/errors/index.js';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid or missing access token' })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded' })
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

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

  // Only the fields the account owner may change on their own: the email needs re-verification and
  // the role is an operator action, so neither belongs in a plain profile patch.
  @Patch('me')
  @ApiOperation({ summary: "Update the authenticated user's profile" })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed, or an empty patch' })
  async updateMe(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const updated = await this.usersService.updateProfile(currentUser.id, updateProfileDto);
    if (!updated) {
      // The account vanished between authentication and the write — force a re-auth, not a 404.
      throw unauthenticatedException();
    }
    this.securityEvents.record(SecurityEvent.ProfileUpdated, { userId: currentUser.id });
    return updated;
  }
}
