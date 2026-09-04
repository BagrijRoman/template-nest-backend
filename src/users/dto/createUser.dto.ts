import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ format: 'email', example: 'jane@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @ApiProperty({ maxLength: 100, example: 'Jane' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(100)
  name: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 128,
    description: 'Must contain at least one lowercase letter, one uppercase letter and one digit',
    example: 'Secret123',
  })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(128)
  @Matches(/[a-z]/, { message: 'password must contain at least one lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain at least one uppercase letter' })
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  password: string;
}
