// `env.validation.ts` (imported transitively for the `LogLevel` enum) uses
// class-validator/class-transformer decorators, which need the reflect-metadata polyfill
// that Nest normally loads as a side effect when bootstrapping the app/module graph.
import 'reflect-metadata';
import { Writable } from 'node:stream';
import pino from 'pino';
import { LogLevel } from '../../config/env.validation';
import { buildPinoHttpOptions, REDACT_CENSOR } from './pino-http.options';

// Captures everything written to it as plain text, so a test can assert on the exact bytes
// that would have reached stdout/a log file — the only reliable way to prove a value never
// appears in the log output, rather than just asserting on a parsed object (which could hide
// a leak in some other property).
class MemoryStream extends Writable {
  private chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  get content(): string {
    return this.chunks.join('');
  }

  get lastLine(): Record<string, unknown> {
    const lines = this.content.trim().split('\n').filter(Boolean);
    return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  }
}

// Only the `redact` option is exercised here (a native `pino` option): `customProps` is a
// `pino-http`-only extension, covered separately by the real HTTP integration test in
// `test/app.e2e-spec.ts`. This test proves the redaction config itself — the actual list of
// paths shipped to production via `buildPinoHttpOptions` — masks the right fields, using
// log shapes identical to what `customProps`/the `req`/`res` serializers produce at runtime.
function buildTestLogger(): { logger: pino.Logger; stream: MemoryStream } {
  const stream = new MemoryStream();
  const { redact } = buildPinoHttpOptions({
    level: LogLevel.Info,
    pretty: false,
  });
  const logger = pino({ level: 'info', redact }, stream);
  return { logger, stream };
}

describe('buildPinoHttpOptions redaction', () => {
  it('never lets a plaintext password from a request body reach the log output', () => {
    const { logger, stream } = buildTestLogger();
    const plainPassword = 'Sup3rSecretPassword!';

    logger.info(
      { body: { identifier: 'alice', password: plainPassword } },
      'request completed',
    );

    expect(stream.content).not.toContain(plainPassword);
    expect(stream.lastLine.body).toEqual({
      identifier: 'alice',
      password: REDACT_CENSOR,
    });
  });

  it('keeps `identifier` visible: it is deliberately excluded from redaction', () => {
    const { logger, stream } = buildTestLogger();

    logger.info({ body: { identifier: 'alice', password: 'whatever' } }, 'msg');

    expect(stream.content).toContain('alice');
    expect((stream.lastLine.body as { identifier: string }).identifier).toBe(
      'alice',
    );
  });

  it.each(['token', 'accessToken', 'refreshToken'])(
    'redacts body.%s',
    (field) => {
      const { logger, stream } = buildTestLogger();
      const secretValue = `secret-value-for-${field}`;

      logger.info({ body: { [field]: secretValue } }, 'msg');

      expect(stream.content).not.toContain(secretValue);
      expect((stream.lastLine.body as Record<string, unknown>)[field]).toBe(
        REDACT_CENSOR,
      );
    },
  );

  it('redacts the Authorization header', () => {
    const { logger, stream } = buildTestLogger();
    const bearerToken = 'Bearer eyJhbGciOiJIUzI1NiJ9.top-secret-jwt';

    logger.info(
      { req: { headers: { authorization: bearerToken } } },
      'incoming request',
    );

    expect(stream.content).not.toContain(bearerToken);
  });

  it('redacts the Cookie header', () => {
    const { logger, stream } = buildTestLogger();
    const cookie = 'session=super-secret-session-id';

    logger.info({ req: { headers: { cookie } } }, 'incoming request');

    expect(stream.content).not.toContain(cookie);
  });

  it('redacts the Set-Cookie response header', () => {
    const { logger, stream } = buildTestLogger();
    const setCookie = 'session=brand-new-secret-session-id; HttpOnly';

    logger.info(
      { res: { headers: { 'set-cookie': setCookie } } },
      'response sent',
    );

    expect(stream.content).not.toContain(setCookie);
  });

  it('does not redact unrelated body fields', () => {
    const { logger, stream } = buildTestLogger();

    logger.info({ body: { ticketTitle: 'Printer is on fire' } }, 'msg');

    expect(stream.content).toContain('Printer is on fire');
  });
});
