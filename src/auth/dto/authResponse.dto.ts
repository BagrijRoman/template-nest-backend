import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/index.js';

export class AuthResponseDto {
  @ApiProperty({ description: 'Short-lived JWT access token' })
  accessToken: string;

  @ApiProperty({ description: 'Refresh token for obtaining a new token pair' })
  refreshToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
