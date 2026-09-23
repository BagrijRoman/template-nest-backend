import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SecurityEventsModule } from '../common/securityEvents/securityEvents.module.js';
import { BreachedPasswordsService } from './breachedPasswords.service.js';
import { CredentialsService } from './credentials.service.js';
import { Credential, CredentialSchema, User, UserSchema } from './entities/index.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Credential.name, schema: CredentialSchema },
    ]),
    SecurityEventsModule,
  ],
  controllers: [UsersController],
  providers: [BreachedPasswordsService, CredentialsService, UsersService],
  exports: [CredentialsService, UsersService],
})
export class UsersModule {}
