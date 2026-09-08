import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RefreshToken, RefreshTokenSchema } from './entities/index.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { TokensService } from './tokens.service.js';

@Module({
  // JwtModule is registered without global options: access and refresh tokens use distinct
  // secrets/TTLs, so TokensService passes them per call instead.
  imports: [
    UsersModule,
    JwtModule.register({}),
    MongooseModule.forFeature([{ name: RefreshToken.name, schema: RefreshTokenSchema }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokensService, TokensService],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
