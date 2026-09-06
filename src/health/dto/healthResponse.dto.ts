import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', description: 'Overall service status; the endpoint returns 503 when unhealthy' })
  status: 'ok';

  @ApiProperty({ example: 'up', description: 'MongoDB connection state' })
  database: 'up';

  @ApiProperty({ example: 3600, description: 'Process uptime in seconds' })
  uptime: number;

  @ApiProperty({ example: '2026-09-06T12:00:00.000Z', description: 'Server time, ISO 8601 UTC' })
  timestamp: string;
}
