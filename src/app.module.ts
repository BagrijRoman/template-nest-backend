import { randomUUID } from 'node:crypto';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AllExceptionsFilter } from './common/filters/allExceptions.filter.js';
import { LogLevel, NodeEnv, validateEnv } from './config/env.validation.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.getOrThrow<NodeEnv>('NODE_ENV');
        return {
          pinoHttp: {
            level: config.get<LogLevel>('LOG_LEVEL') ?? (nodeEnv === NodeEnv.Test ? LogLevel.Silent : LogLevel.Info),
            genReqId: (req) => {
              const header = req.headers['x-request-id'];
              return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
            },
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            transport:
              nodeEnv === NodeEnv.Development ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          },
        };
      },
    }),
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
