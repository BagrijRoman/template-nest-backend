import { randomUUID } from 'node:crypto';
import { Logger, MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import helmet from 'helmet';
import { Connection, STATES } from 'mongoose';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { AllExceptionsFilter } from './common/filters/allExceptions.filter.js';
import { HealthModule } from './health/health.module.js';
import { LogLevel, NodeEnv, validateEnv } from './config/env.validation.js';
import { UsersModule } from './users/users.module.js';

const MONGODB_SERVER_SELECTION_TIMEOUT_MS = 5000;
const MONGODB_RETRY_ATTEMPTS = 3;
const MONGODB_RETRY_DELAY_MS = 1000;

/** Logs connection lifecycle; the initial state is logged explicitly because 'connected' fires before the factory runs. */
const attachMongoConnectionLogging = (connection: Connection): Connection => {
  const logger = new Logger('MongoDB');

  connection.on('disconnected', () => logger.warn('MongoDB connection lost'));
  connection.on('reconnected', () => logger.log('MongoDB connection restored'));
  connection.on('error', (error: Error) => logger.error(`MongoDB connection error: ${error.message}`));

  if (connection.readyState === STATES.connected) {
    logger.log(`Connected to MongoDB (database "${connection.name}")`);
  } else {
    connection.on('connected', () => logger.log(`Connected to MongoDB (database "${connection.name}")`));
  }

  return connection;
};

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
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        serverSelectionTimeoutMS: MONGODB_SERVER_SELECTION_TIMEOUT_MS,
        retryAttempts: MONGODB_RETRY_ATTEMPTS,
        retryDelay: MONGODB_RETRY_DELAY_MS,
        connectionFactory: attachMongoConnectionLogging,
      }),
    }),
    AuthModule,
    HealthModule,
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
export class AppModule implements NestModule {
  constructor(private readonly config: ConfigService) {}

  configure(consumer: MiddlewareConsumer): void {
    const nodeEnv = this.config.getOrThrow<NodeEnv>('NODE_ENV');

    // CSP only in production: outside it Swagger UI is served at /docs and the default policy breaks its assets.
    consumer.apply(helmet({ contentSecurityPolicy: nodeEnv === NodeEnv.Production })).forRoutes('{*splat}');
  }
}
