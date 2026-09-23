import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One device session in the caller's device list. */
export class SessionResponseDto {
  @ApiProperty({ description: 'MongoDB ObjectId as a string', example: '65f1a2b3c4d5e6f7a8b9c0d1' })
  id: string;

  @ApiPropertyOptional({
    description: 'User-Agent the session was last seen with; absent when the client sends none',
    example: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  })
  userAgent?: string;

  @ApiPropertyOptional({
    description: 'Address the session was last seen from; only as trustworthy as TRUST_PROXY makes it',
    example: '203.0.113.10',
  })
  ip?: string;

  @ApiProperty({ description: 'Moved forward on every token rotation' })
  lastSeenAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ description: 'True for the session this request was made from', example: true })
  current: boolean;
}
