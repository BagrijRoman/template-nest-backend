import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { HealthResponseDto } from './dto/index.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
// Health probes poll frequently (load balancers, orchestrators) and must never be rate limited.
@SkipThrottle()
// Probes carry no credentials either.
@Public()
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Health check',
    description: 'Returns the health status of the server and database connection',
  })
  @ApiOkResponse({ type: HealthResponseDto, description: 'Health check response' })
  getHealth(): HealthResponseDto {
    return this.healthService.getHealth();
  }
}
