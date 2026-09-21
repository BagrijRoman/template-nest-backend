import { Module } from '@nestjs/common';
import { SecurityEventsService } from './securityEvents.service.js';

@Module({
  providers: [SecurityEventsService],
  exports: [SecurityEventsService],
})
export class SecurityEventsModule {}
