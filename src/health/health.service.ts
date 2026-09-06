import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { STATES } from 'mongoose';
// Type-only: with emitDecoratorMetadata a value import would survive into dist, and mongoose's CJS wrapper
// exposes no `Connection` named export at runtime. DI resolves via the @InjectConnection token instead.
import type { Connection } from 'mongoose';
import { HealthResponseDto } from './dto/index.js';

@Injectable()
export class HealthService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  check(): HealthResponseDto {
    if (this.connection.readyState !== STATES.connected) {
      throw new ServiceUnavailableException('Database connection is not established');
    }

    return {
      status: 'ok',
      database: 'up',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
