import { ApiProperty } from '@nestjs/swagger';
import { UserRole, type UserProfile } from '../entities/index.js';

export class UserResponseDto implements UserProfile {
  @ApiProperty({ description: 'MongoDB ObjectId as a string', example: '65f1a2b3c4d5e6f7a8b9c0d1' })
  id: string;

  @ApiProperty({ format: 'email', example: 'jane@example.com' })
  email: string;

  @ApiProperty({ example: 'Jane' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ description: 'Set by the email-verification flow', example: false })
  emailVerified: boolean;

  @ApiProperty({ enum: UserRole, example: UserRole.User })
  role: UserRole;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
