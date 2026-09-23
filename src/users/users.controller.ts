import { ErrorResponseDto } from '../common/errors/index.js';
import { Controller, Get } from '@nestjs/common';
import { unauthenticatedException } from '../common/errors/index.js';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/currentUser.decorator.js';
import type { AuthenticatedUser } from '../common/guards/jwtAuth.guard.js';
import { UserResponseDto } from './dto/index.js';
import type { UserProfile } from './entities/index.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid or missing access token' })
  async getMe(@CurrentUser() currentUser: AuthenticatedUser): Promise<UserProfile> {
    const user = await this.usersService.findById(currentUser.id);
    if (!user) {
      // The account vanished while its access token was still valid — force a re-auth, not a 404.
      throw unauthenticatedException();
    }
    return user;
  }
}
