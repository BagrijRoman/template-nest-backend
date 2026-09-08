import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BreachedPasswordsService } from './breachedPasswords.service.js';
import { User, UserSchema } from './entities/index.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [UsersController],
  providers: [BreachedPasswordsService, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
