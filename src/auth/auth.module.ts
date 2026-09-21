import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../common/mail/mail.module.js';
import { SecurityEventsModule } from '../common/securityEvents/securityEvents.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccountRateLimitService } from './accountRateLimit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailVerificationService } from './emailVerification.service.js';
import {
  AccountActionCounter,
  AccountActionCounterSchema,
  EmailVerificationToken,
  EmailVerificationTokenSchema,
  PasswordResetToken,
  PasswordResetTokenSchema,
  RefreshToken,
  RefreshTokenSchema,
  SignInAttempt,
  SignInAttemptSchema,
} from './entities/index.js';
import { PasswordResetService } from './passwordReset.service.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { SignInLockoutService } from './signInLockout.service.js';
import { TokensService } from './tokens.service.js';

@Module({
  // JwtModule is registered without global options: access and refresh tokens use distinct
  // secrets/TTLs, so TokensService passes them per call instead.
  imports: [
    MailModule,
    SecurityEventsModule,
    UsersModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: AccountActionCounter.name, schema: AccountActionCounterSchema },
      { name: EmailVerificationToken.name, schema: EmailVerificationTokenSchema },
      { name: PasswordResetToken.name, schema: PasswordResetTokenSchema },
      { name: RefreshToken.name, schema: RefreshTokenSchema },
      { name: SignInAttempt.name, schema: SignInAttemptSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AccountRateLimitService,
    AuthService,
    EmailVerificationService,
    PasswordResetService,
    RefreshTokensService,
    SignInLockoutService,
    TokensService,
  ],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
