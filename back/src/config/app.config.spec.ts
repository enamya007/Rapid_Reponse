// Standalone unit test for a class using class-transformer/class-validator
// decorators: needs the reflect-metadata polyfill that Nest normally loads
// as a side effect when bootstrapping the app/module graph.
import 'reflect-metadata';

type EnvInput = Record<string, unknown>;

/**
 * A fully valid environment, mirroring env.validation.spec.ts's VALID_ENV --
 * just enough for `validate()` to succeed so `getValidatedEnv()` inside
 * app.config.ts's factory has something to read. APP_FRONTEND_URL is
 * deliberately absent here (it's optional): each test below overrides it.
 */
const VALID_ENV: EnvInput = {
  NODE_ENV: 'development',
  PORT: '3000',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'ticket_checker',
  DB_PASSWORD: 'ticket_checker',
  DB_NAME: 'ticket_checker',
  DB_LOGGING: 'false',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_REFRESH_EXPIRES_IN: '7d',
  CORS_ORIGINS: 'http://localhost:3000',
  SWAGGER_ENABLED: 'true',
  SWAGGER_PATH: 'docs',
  SEED_ADMIN_USERNAME: 'admin',
  SEED_ADMIN_EMAIL: 'admin@ticket-checker.local',
  SEED_ADMIN_PASSWORD: 'Admin@1234',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6380',
  S3_ENDPOINT: 'http://localhost:9002',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'ticket-checker-attachments',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin12345',
  S3_FORCE_PATH_STYLE: 'true',
  UPLOAD_MAX_SIZE_BYTES: '10485760',
  UPLOAD_ALLOWED_MIME_TYPES: 'image/png,image/jpeg,application/pdf',
  MAIL_HOST: 'smtp.example.com',
  MAIL_PORT: '587',
  MAIL_USERNAME: 'mailer@ticket-checker.local',
  MAIL_PASSWORD: 'mail-password',
  MAIL_FROM: 'noreply@ticket-checker.local',
  MAIL_FROM_NAME: 'Ticket Checker',
  MAIL_USE_TLS: 'true',
  MAIL_USE_SSL: 'false',
  THROTTLE_TTL_SECONDS: '60',
  THROTTLE_LIMIT: '100',
  THROTTLE_LOGIN_TTL_SECONDS: '60',
  THROTTLE_LOGIN_LIMIT: '5',
  LOG_LEVEL: 'info',
};

function buildEnv(overrides: EnvInput = {}): EnvInput {
  return { ...VALID_ENV, ...overrides };
}

type EnvValidationModule = typeof import('./env.validation');
type AppConfigModule = typeof import('./app.config');
type NestCommonModule = typeof import('@nestjs/common');

/**
 * `registerAs()`'s factory is cached at module scope in app.config.ts (the
 * fallback-warning guard flag lives there deliberately -- see the comment
 * above `hasWarnedAboutFrontendUrlFallback`). Each test needs a fresh copy of
 * app.config.ts, env.validation.ts (which also caches the last `validate()`
 * result at module scope) AND `@nestjs/common` -- `jest.isolateModules` gives
 * everything required inside its callback a throwaway module registry, so
 * app.config.ts's internal `Logger` import resolves to a *different* class
 * than one imported normally at this file's top level. Returning that same
 * isolated `Logger` reference lets each test spy on the exact class instance
 * app.config.ts actually calls, instead of missing it silently.
 */
function loadFreshAppConfig(): {
  appConfig: AppConfigModule['appConfig'];
  DEFAULT_FRONTEND_URL: string;
  validate: EnvValidationModule['validate'];
  Logger: NestCommonModule['Logger'];
} {
  let envValidationModule: EnvValidationModule;
  let appConfigModule: AppConfigModule;
  let nestCommonModule: NestCommonModule;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nestCommonModule = require('@nestjs/common') as NestCommonModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    envValidationModule = require('./env.validation') as EnvValidationModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    appConfigModule = require('./app.config') as AppConfigModule;
  });

  return {
    appConfig: appConfigModule!.appConfig,
    DEFAULT_FRONTEND_URL: appConfigModule!.DEFAULT_FRONTEND_URL,
    validate: envValidationModule!.validate,
    Logger: nestCommonModule!.Logger,
  };
}

describe('appConfig', () => {
  describe('frontendUrl fallback', () => {
    it('falls back to the default frontend URL when APP_FRONTEND_URL is absent', () => {
      const { appConfig, validate, DEFAULT_FRONTEND_URL, Logger } =
        loadFreshAppConfig();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      validate(buildEnv());

      const result = appConfig();

      expect(result.frontendUrl).toBe(DEFAULT_FRONTEND_URL);
      // Pinned to the literal as well, not just to the imported symbol. Comparing only
      // against `DEFAULT_FRONTEND_URL` makes both sides of the assertion move together, so
      // it stays green if the constant's *value* changes — a different bug from the fallback
      // logic being removed, and one the symbol comparison alone cannot see.
      expect(result.frontendUrl).toBe('http://localhost:3000');
    });

    it('uses the provided APP_FRONTEND_URL when set', () => {
      const { appConfig, validate, Logger } = loadFreshAppConfig();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      validate(buildEnv({ APP_FRONTEND_URL: 'https://app.example.com' }));

      const result = appConfig();

      expect(result.frontendUrl).toBe('https://app.example.com');
    });

    it('logs a warning when the fallback applies', () => {
      const { appConfig, validate, Logger } = loadFreshAppConfig();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      validate(buildEnv());

      appConfig();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('APP_FRONTEND_URL'),
      );
    });

    it('does not log a warning when APP_FRONTEND_URL is set', () => {
      const { appConfig, validate, Logger } = loadFreshAppConfig();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      validate(buildEnv({ APP_FRONTEND_URL: 'https://app.example.com' }));

      appConfig();

      expect(warnSpy).not.toHaveBeenCalled();
    });

    // Mutation target: proves the module-scope guard flag actually suppresses
    // repeat warnings (registerAs() factories can run more than once per
    // process -- see the comment in app.config.ts), not merely that a single
    // call warns once. If the guard were removed, this test would fail with
    // `toHaveBeenCalledTimes(3)` instead of `1`.
    it('logs the fallback warning only once even if the factory runs multiple times', () => {
      const { appConfig, validate, Logger } = loadFreshAppConfig();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      validate(buildEnv());

      appConfig();
      appConfig();
      appConfig();

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});
