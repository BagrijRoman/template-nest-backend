import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './createUser.dto.js';

export class UpdateUserDto extends PartialType(CreateUserDto) {}
