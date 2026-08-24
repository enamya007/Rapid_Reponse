import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

// Pino log levels, from most to least severe. Mirrors pino's built-in level set
// so an invalid LOG_LEVEL is caught at boot instead of silently falling back.
export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
  Silent = 'silent',
}

// Timespan accepted by the `ms` package used by jsonwebtoken. Without this
// check an invalid value only surfaces as a 500 on the first sign() call.
const MS_TIMESPAN = /^\d+(\.\d+)?\s*(ms|s|m|h|d|w|y)?$/i;
const MS_TIMESPAN_MESSAGE =
  '$property must be a duration such as 900, 15m, 24h or 7d';

/**
 * Strict, case-insensitive boolean parser for env values.
 *
 * `process.env` values are always strings, and class-transformer's
 * `enableImplicitConversion` coerces ANY non-empty string (including
 * `'false'`) to `true` via `Boolean(value)` before a custom @Transform
 * even runs. That previously turned `SWAGGER_ENABLED=false` into `true`.
 * Here conversion is fully explicit: only 'true'/'false' (any case) or an
 * already-typed boolean are accepted; anything else is left untouched so
 * @IsBoolean() rejects it with a clear, value-free error instead of the
 * value silently becoming truthy.
 */
function parseBooleanEnv({ value }: { value: unknown }): unknown {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return value;
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number;

  @IsString()
  DB_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number;

  @IsString()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_NAME: string;

  @Transform(parseBooleanEnv)
  @IsBoolean()
  DB_LOGGING: boolean;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @Matches(MS_TIMESPAN, { message: MS_TIMESPAN_MESSAGE })
  JWT_ACCESS_EXPIRES_IN: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsString()
  @Matches(MS_TIMESPAN, { message: MS_TIMESPAN_MESSAGE })
  JWT_REFRESH_EXPIRES_IN: string;

  @IsString()
  CORS_ORIGINS: string;

  // Base URL of the frontend app, used to build links embedded in emails
  // (e.g. the password reset link). Optional and defaulted by app.config.ts
  // (see APP_FRONTEND_URL fallback there): making it required would break
  // every existing local .env file, e2e included (contract D19).
  @IsOptional()
  @IsString()
  APP_FRONTEND_URL?: string;

  @Transform(parseBooleanEnv)
  @IsBoolean()
  SWAGGER_ENABLED: boolean;

  @IsString()
  SWAGGER_PATH: string;

  @IsString()
  SEED_ADMIN_USERNAME: string;

  @IsEmail()
  SEED_ADMIN_EMAIL: string;

  @IsString()
  SEED_ADMIN_PASSWORD: string;

  // --- Redis ---------------------------------------------------------------

  @IsString()
  REDIS_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  // Optional, defaults to 0 (Redis' own default database index) when absent.
  // The default is applied by the config namespace, not here: this field must
  // stay `undefined` (not 0) when unset so @IsOptional() can tell the two apart.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  REDIS_DB?: number;

  // --- Object storage (S3 / MinIO) ------------------------------------------

  @IsString()
  S3_ENDPOINT: string;

  @IsString()
  S3_REGION: string;

  @IsString()
  S3_BUCKET: string;

  @IsString()
  S3_ACCESS_KEY: string;

  @IsString()
  S3_SECRET_KEY: string;

  // Must be `true` for MinIO (and any S3-compatible store addressed by IP/host
  // without wildcard DNS): it forces `https://host/bucket/key` addressing
  // instead of the AWS-only `https://bucket.host/key` virtual-hosted style.
  @Transform(parseBooleanEnv)
  @IsBoolean()
  S3_FORCE_PATH_STYLE: boolean;

  @IsOptional()
  @IsString()
  S3_PUBLIC_URL?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  UPLOAD_MAX_SIZE_BYTES: number;

  @IsString()
  UPLOAD_ALLOWED_MIME_TYPES: string;

  // --- Mail ------------------------------------------------------------------

  @IsString()
  MAIL_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  MAIL_PORT: number;

  @IsString()
  MAIL_USERNAME: string;

  @IsString()
  MAIL_PASSWORD: string;

  @IsEmail()
  MAIL_FROM: string;

  @IsString()
  MAIL_FROM_NAME: string;

  @Transform(parseBooleanEnv)
  @IsBoolean()
  MAIL_USE_TLS: boolean;

  @Transform(parseBooleanEnv)
  @IsBoolean()
  MAIL_USE_SSL: boolean;

  // Safety net: the configured SMTP server is real and delivers to real
  // mailboxes. When set, every outgoing mail must be redirected to this
  // address instead of its real recipient (enforced in the mailer, not here).
  @IsOptional()
  @IsEmail()
  MAIL_SANDBOX_TO?: string;

  // --- Throttling --------------------------------------------------------

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_TTL_SECONDS: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_LOGIN_TTL_SECONDS: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_LOGIN_LIMIT: number;

  // --- Logs ----------------------------------------------------------------

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel;
}

// Cached result of the last successful validation, so registerAs() config
// factories (which run right after `validate` during ConfigModule.forRoot)
// can reuse the already validated/typed values instead of re-reading process.env.
let validatedEnvironment: EnvironmentVariables | undefined;

export function getValidatedEnv(): EnvironmentVariables {
  if (!validatedEnvironment) {
    throw new Error(
      'Environment variables have not been validated yet. Ensure ConfigModule.forRoot({ validate }) runs before config namespaces are loaded.',
    );
  }
  return validatedEnvironment;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // NOTE: `enableImplicitConversion` is intentionally NOT used here. It made
  // class-transformer coerce boolean-typed fields via `Boolean(value)` on the
  // raw string BEFORE any custom @Transform ran, turning 'false' into `true`.
  // Numeric fields (PORT, DB_PORT) already convert explicitly via @Type(() =>
  // Number), and every other field is a plain string, so this is safe.
  const validatedConfig = plainToInstance(EnvironmentVariables, config);

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const message = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${message}`);
  }

  validatedEnvironment = validatedConfig;
  return validatedConfig;
}
