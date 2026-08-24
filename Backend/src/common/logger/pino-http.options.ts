import type { Options } from 'pino-http';
import type { IncomingMessage } from 'node:http';
import { LogLevel } from '../../config/env.validation';

// Placeholder written in place of every redacted value. Pino's `redact.remove: true` would
// drop the key entirely instead; keeping the key (censored) is preferred here so a reader
// can still tell a sensitive field *was present* on the request without ever seeing it.
export const REDACT_CENSOR = '[REDACTED]';

// Paths masked in every log line, regardless of the log level.
// - `req.headers.authorization` / `req.headers.cookie` / response `set-cookie`: credentials
//   carried on the wire, never business data.
// - `body.password` / `body.token` / `body.accessToken` / `body.refreshToken`: the only
//   secret-bearing fields in this API's current request DTOs (`RegisterDto`, `LoginDto`,
//   `RefreshTokenDto`). `body` is attached to every log line by `customProps` below, mirroring
//   the parsed request body.
// `body.identifier` (LoginDto's username-or-email field) is deliberately absent from this
// list: it is not a secret, and keeping it visible is what makes these logs useful for
// spotting a brute-force attempt against a specific account.
export const SENSITIVE_LOG_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'body.password',
  'body.token',
  'body.accessToken',
  'body.refreshToken',
];

interface RequestWithBody extends IncomingMessage {
  body?: unknown;
}

// Attaches the parsed request body as a top-level `body` property on every auto-logged
// request/response line, so `SENSITIVE_LOG_REDACT_PATHS` above has something to redact.
// Nest registers Express's body-parser middleware before any module-level middleware
// (including this logger's), so `req.body` is already populated by the time this runs.
export function attachRequestBody(req: RequestWithBody): { body: unknown } {
  return { body: req.body };
}

export interface BuildPinoHttpOptionsParams {
  level: LogLevel;
  /** Human-readable, colorized output (pino-pretty) instead of raw JSON lines. */
  pretty: boolean;
}

/**
 * Builds the `pino-http` options shared by the real application logger
 * (`LoggerModule.forRootAsync` in `app.module.ts`) and by tests that need to exercise the
 * exact same redaction/body-attachment behaviour against a custom destination stream.
 */
export function buildPinoHttpOptions(
  params: BuildPinoHttpOptionsParams,
): Options {
  return {
    level: params.level,
    redact: {
      paths: SENSITIVE_LOG_REDACT_PATHS,
      censor: REDACT_CENSOR,
    },
    customProps: (req) => attachRequestBody(req),
    ...(params.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: true,
              translateTime: 'HH:MM:ss',
            },
          },
        }
      : {}),
  };
}
