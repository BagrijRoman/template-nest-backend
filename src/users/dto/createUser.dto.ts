import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  IsStrongPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../common/decorators/isStrongPassword.decorator.js';

export class CreateUserDto {
  @ApiProperty({ format: 'email', example: 'jane@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @ApiProperty({ maxLength: 100, example: 'Jane' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'firstName must not be empty' })
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ maxLength: 100, example: 'Doe' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'lastName must not be empty' })
  @MaxLength(100)
  lastName: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: 'Must contain at least one lowercase letter, one uppercase letter and one digit',
    example: 'Secret123',
  })
  @IsStrongPassword('password')
  password: string;
}
