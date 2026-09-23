import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './userResponse.dto.js';

/** The list envelope every paginated endpoint returns. */
export class UserListResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  data: UserResponseDto[];

  @ApiProperty({ description: 'Total number of users, regardless of the page', example: 42 })
  total: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}
