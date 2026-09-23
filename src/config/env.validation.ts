import { z } from 'zod';

const JWT_SECRET_MIN_LENGTH = 32;
const PORT_MAX = 65535;
const TTL_PATTERN = /^\d+(ms|s|m|h|d)$/;
const TTL_MESSAGE = 'must be a duration with a unit, e.g. "900s", "15m", "12h" or "30d"';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum ToggleValue {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

export enum LogLevel {
  Trace = 'trace',
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
  Fatal = 'fatal',
  Silent = 'silent',
}

const jwtSecretSchema = z.string().min(JWT_SECRET_MIN_LENGTH, {
  error: `must be a string of at least ${JWT_SECRET_MIN_LENGTH} characters`,
});
const ttlSchema = z.string().regex(TTL_PATTERN, { error: TTL_MESSAGE });

// Messages omit the variable name: `formatIssue` prefixes each one with its path.
const environmentSchema = z
  .object({
    NODE_ENV: z.enum(NodeEnv).default(NodeEnv.Development),
    PORT: z.coerce.number().int().min(0).max(PORT_MAX).default(3000),
    // Defaults to 'info' ('silent' under test) — resolved where the logger is configured.
    LOG_LEVEL: z.enum(LogLevel).optional(),
    MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\/./, {
      error: 'must be a mongodb:// or mongodb+srv:// connection string',
    }),
    JWT_ACCESS_SECRET: jwtSecretSchema,
    JWT_ACCESS_TTL: ttlSchema,
    JWT_REFRESH_SECRET: jwtSecretSchema,
    JWT_REFRESH_TTL: ttlSchema,
    // Checks new passwords against haveibeenpwned (k-anonymity). Enabled by default; e2e tests
    // disable it so they never call the external API.
    BREACHED_PASSWORD_CHECK: z.enum(ToggleValue).optional(),
    // Unset = CORS stays disabled; never use a wildcard origin on an API with credentials.
    CORS_ORIGINS: z
      .string()
      .regex(/^https?:\/\/[^\s,]+(,\s*https?:\/\/[^\s,]+)*$/, {
        error: 'must be a comma-separated list of http(s) origins',
      })
      .optional(),
    // Git commit the running build was made from — set at build/deploy time, reported by /health-check.
    GIT_SHA: z.string().optional(),
  })
  // Equal secrets would let a refresh token pass verification wherever an access token is expected.
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    error: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
  });

export type EnvironmentVariables = z.infer<typeof environmentSchema>;

const formatIssue = (issue: z.core.$ZodIssue): string =>
  issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;

/** Fails fast at startup: an invalid or malformed variable aborts the boot with a readable message listing every problem. */
export const validateEnv = (config: Record<string, unknown>): EnvironmentVariables => {
  const result = environmentSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.issues.map(formatIssue).join('\n')}`);
  }
  return result.data;
};
