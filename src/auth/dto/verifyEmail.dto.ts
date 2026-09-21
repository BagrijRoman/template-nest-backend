import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { ForgotPasswordDto } from './forgotPassword.dto.js';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Single-use verification token from the verification email' })
  @IsString()
  @IsNotEmpty({ message: 'token must not be empty' })
  token: string;
}

export class ResendVerificationDto extends ForgotPasswordDto {}
