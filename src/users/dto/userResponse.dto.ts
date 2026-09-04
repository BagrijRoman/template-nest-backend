import { ApiProperty } from '@nestjs/swagger';
import type { SafeUser } from '../entities/user.entity.js';

export class UserResponseDto implements SafeUser {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email', example: 'jane@example.com' })
  email: string;

  @ApiProperty({ example: 'Jane' })
  name: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
