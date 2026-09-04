import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
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

  @Matches(/^mongodb(\+srv)?:\/\/./, { message: 'MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string' })
  MONGODB_URI!: string;
}

/** Fails fast at startup: an invalid or malformed variable aborts the boot with a readable message. */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors.map((error) => Object.values(error.constraints ?? {}).join(', '));
    throw new Error(`Invalid environment configuration:\n${messages.join('\n')}`);
  }

  return validated;
}
