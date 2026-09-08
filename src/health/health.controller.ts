import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { HealthResponseDto } from './dto/index.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
// Health probes poll frequently (load balancers, orchestrators) and must never be rate limited.
@SkipThrottle()
// Probes carry no credentials either.
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Service health check', description: 'Reports service liveness and MongoDB connectivity.' })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ description: 'The database connection is down' })
  check(): HealthResponseDto {
    return this.healthService.check();
  }
}
