import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/currentUser.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../common/guards/jwtAuth.guard.js';
import { AUTH_THROTTLE_LIMIT, AUTH_THROTTLE_TTL_MS } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import {
  AuthResponseDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
} from './dto/index.js';
import { PasswordResetService } from './passwordReset.service.js';

@ApiTags('auth')
@Throttle({ default: { ttl: AUTH_THROTTLE_TTL_MS, limit: AUTH_THROTTLE_LIMIT } })
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
@ApiPayloadTooLargeResponse({ description: 'Request body exceeds the size limit' })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  // Token-issuing/revoking routes cannot demand a token — explicitly @Public(), unlike change-password below.
  @Post('sign-up')
  @Public()
  @ApiOperation({ summary: 'Sign up a new user and start a session' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'A user with this email already exists' })
  signUp(@Body() signUpDto: SignUpDto): Promise<AuthResponseDto> {
    return this.authService.signUp(signUpDto);
  }

  @Post('sign-in')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded, or sign-in temporarily locked after repeated failed attempts',
  })
  signIn(@Body() signInDto: SignInDto): Promise<AuthResponseDto> {
    return this.authService.signIn(signInDto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token' })
  refresh(@Body() refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(refreshTokenDto);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiNoContentResponse({ description: 'Logged out (idempotent — an already-revoked token gets the same answer)' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  logout(@Body() refreshTokenDto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(refreshTokenDto);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiNoContentResponse({
    description: 'Always 204 — the response never reveals whether the email belongs to an account',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto): Promise<void> {
    return this.passwordResetService.requestReset(forgotPasswordDto.email);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with a single-use reset token; revokes every session' })
  @ApiNoContentResponse({ description: 'Password replaced, all sessions revoked — sign in with the new password' })
  @ApiBadRequestResponse({ description: 'Validation failed, invalid/expired token, or a breached new password' })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto): Promise<void> {
    return this.passwordResetService.resetPassword(resetPasswordDto.token, resetPasswordDto.newPassword);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the password; revokes every session and returns a fresh one' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed, or the current password is incorrect' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing access token' })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded, or temporarily locked after repeated failed password attempts',
  })
  changePassword(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<AuthResponseDto> {
    return this.authService.changePassword(currentUser.id, changePasswordDto);
  }
}
