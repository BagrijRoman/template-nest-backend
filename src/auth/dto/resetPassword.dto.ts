import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import {
  IsStrongPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../common/decorators/isStrongPassword.decorator.js';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Single-use reset token from the password-reset email' })
  @IsString()
  @IsNotEmpty({ message: 'token must not be empty' })
  token: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: 'Must contain at least one lowercase letter, one uppercase letter and one digit',
    example: 'NewSecret123',
  })
  @IsStrongPassword('newPassword')
  newPassword: string;
}
