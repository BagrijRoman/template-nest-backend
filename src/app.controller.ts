import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Greeting, doubles as a liveness check' })
  @ApiOkResponse({ type: String })
  getHello(): string {
    return this.appService.getHello();
  }
}
