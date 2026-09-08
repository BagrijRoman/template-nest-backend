import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseCorsOrigins } from './config/corsOrigins.util.js';

/** App-level wiring shared by main.ts and the e2e tests, so tests exercise the exact production configuration. */
export const setupApp = (app: INestApplication): INestApplication => {
  const config = app.get(ConfigService);

  const corsOrigins = parseCorsOrigins(config.get<string>('CORS_ORIGINS'));
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  }

  return app;
};
