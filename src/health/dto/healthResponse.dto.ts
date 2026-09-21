import { ApiProperty } from '@nestjs/swagger';

export class HealthDatabaseDto {
  @ApiProperty({
    example: 'connected',
    description: 'MongoDB connection state: disconnected | connected | connecting | disconnecting | uninitialized',
  })
  status: string;

  @ApiProperty({ example: 1, description: 'Mongoose connection readyState' })
  readyState: number;
}

export class HealthResponseDto {
  @ApiProperty({
    enum: ['ok', 'error'],
    example: 'ok',
    description: 'Overall service status; "error" when the database is not connected (the endpoint still returns 200)',
  })
  status: 'ok' | 'error';

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z', description: 'Server time, ISO 8601 UTC' })
  timestamp: string;

  @ApiProperty({ example: 3600, description: 'Seconds since the service started' })
  uptime: number;

  @ApiProperty({
    example: '0c038234d9aca98fa3469178c7e7d8993beb7a3c',
    description: 'Git commit the running build was made from (GIT_SHA); "unknown" when not set',
  })
  commit: string;

  @ApiProperty({ example: 'production', description: 'Runtime environment (NODE_ENV)' })
  nodeEnv: string;

  @ApiProperty({ type: HealthDatabaseDto })
  database: HealthDatabaseDto;
}
