import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { SecurityEventsModule } from '../common/securityEvents/securityEvents.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RefreshToken, RefreshTokenSchema, SignInAttempt, SignInAttemptSchema } from './entities/index.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { SignInLockoutService } from './signInLockout.service.js';
import { TokensService } from './tokens.service.js';

@Module({
  // JwtModule is registered without global options: access and refresh tokens use distinct
  // secrets/TTLs, so TokensService passes them per call instead.
  imports: [
    SecurityEventsModule,
    UsersModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: RefreshToken.name, schema: RefreshTokenSchema },
      { name: SignInAttempt.name, schema: SignInAttemptSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokensService, SignInLockoutService, TokensService],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
