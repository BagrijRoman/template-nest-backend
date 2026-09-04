import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotImplementedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserResponseDto } from '../users/dto/index.js';
import type { SafeUser } from '../users/entities/index.js';
import { AuthService } from './auth.service.js';
import { AuthResponseDto, RefreshTokenDto, SignInDto, SignUpDto } from './dto/index.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @ApiOperation({ summary: 'Sign up a new user' })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'A user with this email already exists' })
  signUp(@Body() signUpDto: SignUpDto): Promise<SafeUser> {
    return this.authService.signUp(signUpDto);
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotImplementedResponse({ description: 'Not implemented yet' })
  signIn(@Body() signInDto: SignInDto): AuthResponseDto {
    return this.authService.signIn(signInDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotImplementedResponse({ description: 'Not implemented yet' })
  refresh(@Body() refreshTokenDto: RefreshTokenDto): AuthResponseDto {
    return this.authService.refresh(refreshTokenDto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiNoContentResponse({ description: 'Refresh token revoked' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotImplementedResponse({ description: 'Not implemented yet' })
  logout(@Body() refreshTokenDto: RefreshTokenDto): void {
    this.authService.logout(refreshTokenDto);
  }
}
