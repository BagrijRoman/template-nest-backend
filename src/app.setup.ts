import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Application } from 'express';
import { json, urlencoded } from 'express';
import { parseCorsOrigins } from './config/corsOrigins.util.js';
import { parseTrustProxy } from './config/trustProxy.util.js';

// Explicit request body cap: oversized payloads are rejected with 413 before parsing and validation.
// The app is created with `bodyParser: false`, so these parsers are the only ones registered.
export const BODY_SIZE_LIMIT_BYTES = 100 * 1024;

/** App-level wiring shared by main.ts and the e2e tests, so tests exercise the exact production configuration. */
export const setupApp = (app: INestApplication): INestApplication => {
  const config = app.get(ConfigService);

  // Behind a reverse proxy the socket address is the proxy's: without this, every client shares one
  // rate-limit bucket and `X-Forwarded-For` is ignored. Express derives `req.ip` (what the throttler
  // keys on) from the trusted hop count or whitelist, so the value cannot be forged by the caller.
  // The adapter is typed as a generic HttpServer; under `bodyParser: false` + Express it is the Express app.
  const expressApp = app.getHttpAdapter().getInstance() as Application;
  expressApp.set('trust proxy', parseTrustProxy(config.get<string>('TRUST_PROXY')));

  app.use(json({ limit: BODY_SIZE_LIMIT_BYTES }), urlencoded({ extended: true, limit: BODY_SIZE_LIMIT_BYTES }));

  const corsOrigins = parseCorsOrigins(config.get<string>('CORS_ORIGINS'));
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  }

  return app;
};
