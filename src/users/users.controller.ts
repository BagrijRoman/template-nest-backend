import { Controller, Get, UnauthorizedException } from '@nestjs/common';
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
import type { SafeUser } from './entities/index.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing access token' })
  async getMe(@CurrentUser() currentUser: AuthenticatedUser): Promise<SafeUser> {
    const user = await this.usersService.findById(currentUser.id);
    if (!user) {
      // The account vanished while its access token was still valid — force a re-auth, not a 404.
      throw new UnauthorizedException('Invalid or missing access token');
    }
    return user;
  }
}
