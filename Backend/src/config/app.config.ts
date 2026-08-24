import { Logger } from '@nestjs/common';
import { ConfigType, registerAs } from '@nestjs/config';
import { getValidatedEnv } from './env.validation';

const logger = new Logger('AppConfig');

// Fallback used when APP_FRONTEND_URL is not set (contract D19). Named and
// exported instead of a literal buried in the factory return, so the value
// has a single, referenceable source of truth (e.g. from tests).
export const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

// `registerAs()`'s factory can run more than once per process -- e.g. a
// fresh NestJS application is instantiated per e2e test file within the same
// jest worker, each re-invoking this factory. This flag lives at module
// scope, which Node/CommonJS caches per process, so it is shared across
// every invocation of the factory below: the fallback warning still fires
// only once per process, not once per config read.
let hasWarnedAboutFrontendUrlFallback = false;

export const appConfig = registerAs('app', () => {
  const env = getValidatedEnv();

  const frontendUrl = env.APP_FRONTEND_URL ?? DEFAULT_FRONTEND_URL;

  if (!env.APP_FRONTEND_URL && !hasWarnedAboutFrontendUrlFallback) {
    hasWarnedAboutFrontendUrlFallback = true;
    // A silent fallback here would mean a password reset link silently
    // points at the wrong host with no signal to whoever deployed it.
    logger.warn(
      `APP_FRONTEND_URL is not set; falling back to ${DEFAULT_FRONTEND_URL}. Links embedded in emails (e.g. password reset) will point to this host.`,
    );
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    corsOrigins: env.CORS_ORIGINS,
    swaggerEnabled: env.SWAGGER_ENABLED,
    swaggerPath: env.SWAGGER_PATH,
    frontendUrl,
  };
});

export type AppConfig = ConfigType<typeof appConfig>;
