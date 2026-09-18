import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { STATES } from 'mongoose';
// Type-only: with emitDecoratorMetadata a value import would survive into dist, and mongoose's CJS wrapper
// exposes no `Connection` named export at runtime. DI resolves via the @InjectConnection token instead.
import type { Connection } from 'mongoose';
import { HealthResponseDto } from './dto/index.js';

@Injectable()
export class HealthService {
  private readonly startTime = Date.now();

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
  ) {}

  getHealth(): HealthResponseDto {
    const dbState = this.connection.readyState;
    const isDbConnected = dbState === STATES.connected;

    return {
      status: isDbConnected ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      // Git commit the running build was made from (GIT_SHA, injected at build/deploy time). Lets us confirm
      // which code is actually live without shell access — 'unknown' on a local/dev run.
      commit: this.config.get<string>('GIT_SHA') ?? 'unknown',
      // Lets us confirm a deploy runs as intended without shell access — prod MUST report 'production'
      // (elsewhere Swagger UI is served).
      nodeEnv: this.config.get<string>('NODE_ENV') ?? 'unknown',
      database: {
        status: STATES[dbState] ?? 'unknown',
        readyState: dbState,
      },
    };
  }
}
