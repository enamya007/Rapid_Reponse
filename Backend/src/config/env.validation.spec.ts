// Standalone unit test for a class using class-transformer/class-validator
// decorators: needs the reflect-metadata polyfill that Nest normally loads
// as a side effect when bootstrapping the app/module graph.
import 'reflect-metadata';
import { validate } from './env.validation';

type EnvInput = Record<string, unknown>;

/**
 * A fully valid environment, mirroring `.env.example`. Every test derives
 * from this via `buildEnv()`/`buildEnvWithout()`, overriding a single
 * variable so each test stays independent and focused on one concern.
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

/**
 * `VALID_ENV` keys that are genuinely optional (decorated with @IsOptional()
 * in env.validation.ts). Every other key is required: dropping it must make
 * `validate()` throw. Used by the "every required field is enforced" test
 * below so a newly added required field can't silently ship without coverage.
 */
const OPTIONAL_KEYS = new Set([
  'REDIS_PASSWORD',
  'REDIS_DB',
  'S3_PUBLIC_URL',
  'MAIL_SANDBOX_TO',
  'APP_FRONTEND_URL',
]);

function buildEnv(overrides: EnvInput = {}): EnvInput {
  return { ...VALID_ENV, ...overrides };
}

function buildEnvWithout(key: string): EnvInput {
  const env = buildEnv();
  delete env[key];
  return env;
}

describe('validate (env.validation)', () => {
  describe('boolean coercion', () => {
    // Regression test for the bug: class-transformer's implicit conversion
    // used to run `Boolean(value)` on the raw string BEFORE the custom
    // @Transform saw it, so the non-empty string 'false' became `true`.
    it('regression: SWAGGER_ENABLED="false" is parsed as false, not true', () => {
      const result = validate(buildEnv({ SWAGGER_ENABLED: 'false' }));

      expect(result.SWAGGER_ENABLED).toBe(false);
    });

    it('regression: DB_LOGGING="false" is parsed as false, not true', () => {
      const result = validate(buildEnv({ DB_LOGGING: 'false' }));

      expect(result.DB_LOGGING).toBe(false);
    });

    it('accepts the upper-case variant "FALSE"', () => {
      const result = validate(buildEnv({ SWAGGER_ENABLED: 'FALSE' }));

      expect(result.SWAGGER_ENABLED).toBe(false);
    });

    it('accepts the mixed-case variant "True"', () => {
      const result = validate(buildEnv({ SWAGGER_ENABLED: 'True' }));

      expect(result.SWAGGER_ENABLED).toBe(true);
    });

    it('leaves an already-typed boolean value untouched', () => {
      const result = validate(buildEnv({ SWAGGER_ENABLED: false }));

      expect(result.SWAGGER_ENABLED).toBe(false);
    });

    it('rejects an ambiguous boolean value and names the offending variable', () => {
      expect(() => validate(buildEnv({ SWAGGER_ENABLED: 'yes' }))).toThrow(
        /SWAGGER_ENABLED/,
      );
    });
  });

  describe('numeric coercion', () => {
    it('converts PORT from a string to an actual number', () => {
      const result = validate(buildEnv({ PORT: '3000' }));

      expect(result.PORT).toBe(3000);
      expect(typeof result.PORT).toBe('number');
    });

    it('rejects a PORT above the valid range', () => {
      expect(() => validate(buildEnv({ PORT: '70000' }))).toThrow(/PORT/);
    });

    it('converts DB_PORT from a string to an actual number', () => {
      const result = validate(buildEnv({ DB_PORT: '5432' }));

      expect(result.DB_PORT).toBe(5432);
      expect(typeof result.DB_PORT).toBe('number');
    });
  });

  describe('JWT secrets', () => {
    it('rejects an access secret shorter than 32 characters', () => {
      expect(() =>
        validate(buildEnv({ JWT_ACCESS_SECRET: 'a'.repeat(31) })),
      ).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('accepts an access secret of exactly 32 characters', () => {
      expect(() =>
        validate(buildEnv({ JWT_ACCESS_SECRET: 'a'.repeat(32) })),
      ).not.toThrow();
    });

    it('never leaks the secret value itself in the validation error message', () => {
      const tooShortSecret = 'too-short-secret-1234';
      expect(tooShortSecret.length).toBeLessThan(32);

      let thrownMessage = '';
      try {
        validate(buildEnv({ JWT_ACCESS_SECRET: tooShortSecret }));
      } catch (error) {
        thrownMessage = error instanceof Error ? error.message : String(error);
      }

      expect(thrownMessage).toContain('JWT_ACCESS_SECRET');
      expect(thrownMessage).not.toContain(tooShortSecret);
    });

    it('rejects an invalid JWT_ACCESS_EXPIRES_IN format', () => {
      expect(() =>
        validate(buildEnv({ JWT_ACCESS_EXPIRES_IN: 'abc' })),
      ).toThrow(/JWT_ACCESS_EXPIRES_IN/);
    });
  });

  describe('other fields', () => {
    it('rejects an invalid SEED_ADMIN_EMAIL', () => {
      expect(() =>
        validate(buildEnv({ SEED_ADMIN_EMAIL: 'not-an-email' })),
      ).toThrow(/SEED_ADMIN_EMAIL/);
    });

    it('rejects a NODE_ENV outside of the Environment enum', () => {
      expect(() => validate(buildEnv({ NODE_ENV: 'staging' }))).toThrow(
        /NODE_ENV/,
      );
    });

    it('rejects a missing required variable', () => {
      expect(() => validate(buildEnvWithout('DB_HOST'))).toThrow(/DB_HOST/);
    });

    // Guards against a required field being added to EnvironmentVariables
    // without ever adding it to VALID_ENV/testing that it's enforced: every
    // key of VALID_ENV that isn't explicitly listed as optional must, on its
    // own, make validate() throw when dropped.
    it('enforces every declared field that is not explicitly optional', () => {
      for (const key of Object.keys(VALID_ENV)) {
        if (OPTIONAL_KEYS.has(key)) {
          continue;
        }
        expect(() => validate(buildEnvWithout(key))).toThrow(new RegExp(key));
      }
    });
  });

  describe('frontend', () => {
    // Contract D19: making this required would break every existing local
    // .env file, e2e included. app.config.ts owns the fallback and warning.
    it('does not require APP_FRONTEND_URL', () => {
      expect(() => validate(buildEnvWithout('APP_FRONTEND_URL'))).not.toThrow();
    });

    it('leaves APP_FRONTEND_URL undefined when absent, rather than defaulting it', () => {
      const result = validate(buildEnvWithout('APP_FRONTEND_URL'));

      expect(result.APP_FRONTEND_URL).toBeUndefined();
    });

    it('accepts a provided APP_FRONTEND_URL', () => {
      const result = validate(
        buildEnv({ APP_FRONTEND_URL: 'https://app.example.com' }),
      );

      expect(result.APP_FRONTEND_URL).toBe('https://app.example.com');
    });
  });

  describe('Redis', () => {
    it('rejects a REDIS_PORT above the valid range', () => {
      expect(() => validate(buildEnv({ REDIS_PORT: '70000' }))).toThrow(
        /REDIS_PORT/,
      );
    });

    it('does not require REDIS_PASSWORD', () => {
      expect(() => validate(buildEnvWithout('REDIS_PASSWORD'))).not.toThrow();
    });

    it('leaves REDIS_PASSWORD undefined when absent, rather than defaulting it', () => {
      const result = validate(buildEnvWithout('REDIS_PASSWORD'));

      expect(result.REDIS_PASSWORD).toBeUndefined();
    });

    it('does not require REDIS_DB and leaves it undefined when absent', () => {
      const result = validate(buildEnvWithout('REDIS_DB'));

      expect(result.REDIS_DB).toBeUndefined();
    });

    it('converts a provided REDIS_DB to a number', () => {
      const result = validate(buildEnv({ REDIS_DB: '2' }));

      expect(result.REDIS_DB).toBe(2);
      expect(typeof result.REDIS_DB).toBe('number');
    });

    it('rejects a negative REDIS_DB', () => {
      expect(() => validate(buildEnv({ REDIS_DB: '-1' }))).toThrow(/REDIS_DB/);
    });
  });

  describe('object storage (S3 / MinIO)', () => {
    // Regression coverage for the same class of bug as SWAGGER_ENABLED:
    // S3_FORCE_PATH_STYLE must be parsed with the safe boolean transform too.
    it('parses S3_FORCE_PATH_STYLE="false" as false, not true', () => {
      const result = validate(buildEnv({ S3_FORCE_PATH_STYLE: 'false' }));

      expect(result.S3_FORCE_PATH_STYLE).toBe(false);
    });

    it('parses S3_FORCE_PATH_STYLE="true" as true', () => {
      const result = validate(buildEnv({ S3_FORCE_PATH_STYLE: 'true' }));

      expect(result.S3_FORCE_PATH_STYLE).toBe(true);
    });

    it('does not require S3_PUBLIC_URL', () => {
      expect(() => validate(buildEnvWithout('S3_PUBLIC_URL'))).not.toThrow();
    });

    it('converts UPLOAD_MAX_SIZE_BYTES to a number', () => {
      const result = validate(buildEnv({ UPLOAD_MAX_SIZE_BYTES: '5242880' }));

      expect(result.UPLOAD_MAX_SIZE_BYTES).toBe(5242880);
      expect(typeof result.UPLOAD_MAX_SIZE_BYTES).toBe('number');
    });

    it('rejects a non-positive UPLOAD_MAX_SIZE_BYTES', () => {
      expect(() => validate(buildEnv({ UPLOAD_MAX_SIZE_BYTES: '0' }))).toThrow(
        /UPLOAD_MAX_SIZE_BYTES/,
      );
    });
  });

  describe('mail', () => {
    // Regression coverage for the same class of bug as SWAGGER_ENABLED: this
    // is exactly the field the acceptance criteria call out by name.
    it('regression: MAIL_USE_TLS="false" is parsed as false, not true', () => {
      const result = validate(buildEnv({ MAIL_USE_TLS: 'false' }));

      expect(result.MAIL_USE_TLS).toBe(false);
    });

    it('regression: MAIL_USE_SSL="false" is parsed as false, not true', () => {
      const result = validate(buildEnv({ MAIL_USE_SSL: 'false' }));

      expect(result.MAIL_USE_SSL).toBe(false);
    });

    it('rejects an invalid MAIL_FROM address', () => {
      expect(() => validate(buildEnv({ MAIL_FROM: 'not-an-email' }))).toThrow(
        /MAIL_FROM/,
      );
    });

    it('rejects an invalid MAIL_PORT', () => {
      expect(() => validate(buildEnv({ MAIL_PORT: 'not-a-port' }))).toThrow(
        /MAIL_PORT/,
      );
    });

    it('does not require MAIL_SANDBOX_TO', () => {
      expect(() => validate(buildEnvWithout('MAIL_SANDBOX_TO'))).not.toThrow();
    });

    it('leaves MAIL_SANDBOX_TO undefined when absent', () => {
      const result = validate(buildEnvWithout('MAIL_SANDBOX_TO'));

      expect(result.MAIL_SANDBOX_TO).toBeUndefined();
    });

    it('accepts a valid MAIL_SANDBOX_TO and rejects an invalid one', () => {
      expect(() =>
        validate(buildEnv({ MAIL_SANDBOX_TO: 'sandbox@example.com' })),
      ).not.toThrow();
      expect(() =>
        validate(buildEnv({ MAIL_SANDBOX_TO: 'not-an-email' })),
      ).toThrow(/MAIL_SANDBOX_TO/);
    });
  });

  describe('throttling', () => {
    it('converts throttle fields to numbers', () => {
      const result = validate(
        buildEnv({
          THROTTLE_TTL_SECONDS: '30',
          THROTTLE_LIMIT: '50',
          THROTTLE_LOGIN_TTL_SECONDS: '120',
          THROTTLE_LOGIN_LIMIT: '3',
        }),
      );

      expect(result.THROTTLE_TTL_SECONDS).toBe(30);
      expect(result.THROTTLE_LIMIT).toBe(50);
      expect(result.THROTTLE_LOGIN_TTL_SECONDS).toBe(120);
      expect(result.THROTTLE_LOGIN_LIMIT).toBe(3);
    });

    it('rejects a non-positive THROTTLE_LOGIN_LIMIT', () => {
      expect(() => validate(buildEnv({ THROTTLE_LOGIN_LIMIT: '0' }))).toThrow(
        /THROTTLE_LOGIN_LIMIT/,
      );
    });
  });

  describe('logs', () => {
    it('accepts every documented LOG_LEVEL value', () => {
      const levels = [
        'fatal',
        'error',
        'warn',
        'info',
        'debug',
        'trace',
        'silent',
      ];

      for (const level of levels) {
        expect(() => validate(buildEnv({ LOG_LEVEL: level }))).not.toThrow();
      }
    });

    it('rejects a LOG_LEVEL outside of the accepted set', () => {
      expect(() => validate(buildEnv({ LOG_LEVEL: 'verbose' }))).toThrow(
        /LOG_LEVEL/,
      );
    });
  });

  describe('happy path', () => {
    it('accepts a fully valid environment and returns correctly typed values', () => {
      const result = validate(buildEnv());

      expect(result.NODE_ENV).toBe('development');
      expect(result.PORT).toBe(3000);
      expect(result.DB_PORT).toBe(5432);
      expect(result.DB_LOGGING).toBe(false);
      expect(result.SWAGGER_ENABLED).toBe(true);
      expect(result.REDIS_HOST).toBe('localhost');
      expect(result.REDIS_PORT).toBe(6380);
      expect(result.S3_FORCE_PATH_STYLE).toBe(true);
      expect(result.UPLOAD_MAX_SIZE_BYTES).toBe(10485760);
      expect(result.MAIL_USE_TLS).toBe(true);
      expect(result.MAIL_USE_SSL).toBe(false);
      expect(result.THROTTLE_LIMIT).toBe(100);
      expect(result.LOG_LEVEL).toBe('info');
    });

    it('accepts an environment with every optional variable omitted', () => {
      const env = buildEnv();
      for (const key of OPTIONAL_KEYS) {
        delete env[key];
      }

      expect(() => validate(env)).not.toThrow();
    });
  });
});
