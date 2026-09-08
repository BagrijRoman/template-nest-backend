import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min, MinLength, validateSync } from 'class-validator';

const JWT_SECRET_MIN_LENGTH = 32;
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

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number = 3000;

  // Defaults to 'info' ('silent' under test) — resolved where the logger is configured.
  @IsOptional()
  @IsEnum(LogLevel)
  LOG_LEVEL?: LogLevel;

  @Matches(/^mongodb(\+srv)?:\/\/./, {
    message: 'MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string',
  })
  MONGODB_URI!: string;

  @MinLength(JWT_SECRET_MIN_LENGTH, {
    message: `JWT_ACCESS_SECRET must be a string of at least ${JWT_SECRET_MIN_LENGTH} characters`,
  })
  JWT_ACCESS_SECRET!: string;

  @Matches(TTL_PATTERN, { message: `JWT_ACCESS_TTL ${TTL_MESSAGE}` })
  JWT_ACCESS_TTL!: string;

  @MinLength(JWT_SECRET_MIN_LENGTH, {
    message: `JWT_REFRESH_SECRET must be a string of at least ${JWT_SECRET_MIN_LENGTH} characters`,
  })
  JWT_REFRESH_SECRET!: string;

  @Matches(TTL_PATTERN, { message: `JWT_REFRESH_TTL ${TTL_MESSAGE}` })
  JWT_REFRESH_TTL!: string;

  // Checks new passwords against haveibeenpwned (k-anonymity). Enabled by default; e2e tests
  // disable it so they never call the external API.
  @IsOptional()
  @IsEnum(ToggleValue)
  BREACHED_PASSWORD_CHECK?: ToggleValue;

  // Unset = CORS stays disabled; never use a wildcard origin on an API with credentials.
  @IsOptional()
  @Matches(/^https?:\/\/[^\s,]+(,\s*https?:\/\/[^\s,]+)*$/, {
    message: 'CORS_ORIGINS must be a comma-separated list of http(s) origins',
  })
  CORS_ORIGINS?: string;
}

/** Fails fast at startup: an invalid or malformed variable aborts the boot with a readable message. */
export const validateEnv = (config: Record<string, unknown>): EnvironmentVariables => {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors.map((error) => Object.values(error.constraints ?? {}).join(', '));
    throw new Error(`Invalid environment configuration:\n${messages.join('\n')}`);
  }

  // Equal secrets would let a refresh token pass verification wherever an access token is expected.
  if (validated.JWT_ACCESS_SECRET === validated.JWT_REFRESH_SECRET) {
    throw new Error('Invalid environment configuration:\nJWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }

  return validated;
};
