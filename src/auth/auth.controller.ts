import { ErrorResponseDto } from '../common/errors/index.js';
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
  DeleteAccountDto,
  ForgotPasswordDto,
  RefreshTokenDto,
  ResetPasswordDto,
  ResendVerificationDto,
  SignInDto,
  SignUpDto,
  VerifyEmailDto,
} from './dto/index.js';
import { EmailVerificationService } from './emailVerification.service.js';
import { PasswordResetService } from './passwordReset.service.js';

@ApiTags('auth')
@Throttle({ default: { ttl: AUTH_THROTTLE_TTL_MS, limit: AUTH_THROTTLE_LIMIT } })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded' })
@ApiPayloadTooLargeResponse({ description: 'Request body exceeds the size limit' })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  // Token-issuing/revoking routes cannot demand a token — explicitly @Public(), unlike change-password below.
  @Post('sign-up')
  @Public()
  @ApiOperation({ summary: 'Sign up a new user and start a session' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'A user with this email already exists' })
  signUp(@Body() signUpDto: SignUpDto): Promise<AuthResponseDto> {
    return this.authService.signUp(signUpDto);
  }

  @Post('sign-in')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
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
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid refresh token' })
  refresh(@Body() refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(refreshTokenDto);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiNoContentResponse({ description: 'Logged out (idempotent — an already-revoked token gets the same answer)' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
  logout(@Body() refreshTokenDto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(refreshTokenDto);
  }

  @Post('send-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request a verification email for the authenticated account' })
  @ApiNoContentResponse({ description: 'Verification email sent' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Email is already verified' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid or missing access token' })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: 'Rate limit exceeded, or too many verification emails requested for this account',
  })
  sendVerification(@CurrentUser() currentUser: AuthenticatedUser): Promise<void> {
    return this.emailVerificationService.requestVerification(currentUser.id);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Verify the email address with a single-use token' })
  @ApiNoContentResponse({ description: 'Email verified' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed, or an invalid/expired token' })
  verifyEmail(@Body() verifyEmailDto: VerifyEmailDto): Promise<void> {
    return this.emailVerificationService.verify(verifyEmailDto.token);
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Resend the verification email' })
  @ApiNoContentResponse({
    description: 'Always 204 — the response never reveals whether the email belongs to an account',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
  resendVerification(@Body() resendVerificationDto: ResendVerificationDto): Promise<void> {
    return this.emailVerificationService.resend(resendVerificationDto.email);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiNoContentResponse({
    description: 'Always 204 — the response never reveals whether the email belongs to an account',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed' })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto): Promise<void> {
    return this.passwordResetService.requestReset(forgotPasswordDto.email);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with a single-use reset token; revokes every session' })
  @ApiNoContentResponse({ description: 'Password replaced, all sessions revoked — sign in with the new password' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Validation failed, invalid/expired token, or a breached new password',
  })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto): Promise<void> {
    return this.passwordResetService.resetPassword(resetPasswordDto.token, resetPasswordDto.newPassword);
  }

  @Post('delete-account')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete the account and everything stored with it; irreversible' })
  @ApiNoContentResponse({ description: 'Account deleted — the access token stops working immediately' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Validation failed, or the current password is incorrect',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid or missing access token' })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: 'Rate limit exceeded, or temporarily locked after repeated failed password attempts',
  })
  deleteAccount(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() deleteAccountDto: DeleteAccountDto,
  ): Promise<void> {
    return this.authService.deleteAccount(currentUser.id, deleteAccountDto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the password; revokes every session and returns a fresh one' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Validation failed, or the current password is incorrect',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid or missing access token' })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: 'Rate limit exceeded, or temporarily locked after repeated failed password attempts',
  })
  changePassword(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<AuthResponseDto> {
    return this.authService.changePassword(currentUser.id, changePasswordDto);
  }
}
