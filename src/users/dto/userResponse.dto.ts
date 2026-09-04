import { ApiProperty } from '@nestjs/swagger';
import type { SafeUser } from '../entities/index.js';

export class UserResponseDto implements SafeUser {
  @ApiProperty({ description: 'MongoDB ObjectId as a string', example: '65f1a2b3c4d5e6f7a8b9c0d1' })
  id: string;

  @ApiProperty({ format: 'email', example: 'jane@example.com' })
  email: string;

  @ApiProperty({ example: 'Jane' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
