import { Writable } from 'node:stream';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  INestApplication,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { buildPinoHttpOptions } from '../src/common/logger/pino-http.options';
import { LogLevel } from '../src/config/env.validation';
import { ThrottleConfig } from '../src/config/throttle.config';

// Each `Test.createTestingModule({ imports: [AppModule] })` below opens 3 fresh Redis
// connections (BullMQ Queue, Worker, worker blocking connection — see
// docs/plan-P6-contracts.md §10 / D20). BullMQ's `RedisConnection.close()` does not always
// await its own in-flight `init()` before stripping its listeners, so a connection that is
// still connecting when `close()` runs can later reject with an unlistened 'error', which
// Node treats as fatal. Fewer `AppModule` instantiations in this file means fewer chances to
// hit that window, so the describes below share app instances wherever a test's needs allow
// it, and keep a dedicated instance only where sharing would be unsafe (see the 'Login rate
// limiting' describe below).

describe('Login rate limiting (e2e)', () => {
  let app: INestApplication<App>;
  let loginLimit: number;

  // Deliberately NOT merged into another describe's app instance. The 'login' throttler is
  // scoped by `skipIf` to routes carrying `@StrictLoginThrottle()` (src/app.module.ts) — today
  // that is only `POST /api/auth/login` (src/modules/auth/auth.controller.ts) — so, as of this
  // writing, none of this file's other tests would touch its counter even if sharing an app.
  // Kept dedicated anyway: a shared instance would make that safety invisible at the call
  // site, and a future test added to a merged describe could start hitting a
  // `@StrictLoginThrottle()` route without anyone noticing it now shares this counter. An
  // anti-brute-force test that silently stops testing what it claims to is worse than the
  // extra ~few seconds of teardown this dedicated instance costs.
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors `src/main.ts`: same global prefix and ValidationPipe configuration.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    // Read the real configured limit instead of hardcoding it, so this test tracks
    // whatever THROTTLE_LOGIN_LIMIT is actually configured to.
    loginLimit = app.get(ConfigService).getOrThrow<ThrottleConfig>('throttle')
      .login.limit;
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows up to the configured limit of login attempts and blocks the next one in the same window with 429', async () => {
    const attemptLogin = () =>
      request(app.getHttpServer()).post('/api/auth/login').send({
        identifier: 'e2e_throttle_ghost',
        password: 'WhateverPass123',
      });

    for (let i = 0; i < loginLimit; i += 1) {
      // Sequential on purpose: this proves ordering (Nth request still allowed, N+1th
      // blocked), which would be lost if these ran concurrently.

      await attemptLogin().expect(401);
    }

    // One request over the limit, within the same window: blocked by the throttler before
    // credentials are even evaluated.
    const blocked = await attemptLogin().expect(429);
    const body = blocked.body as { statusCode: number };
    expect(body.statusCode).toBe(429);
  });

  it('does not apply the strict login rate limit to an unrelated route', async () => {
    // `loginLimit + 3` requests to a completely different route: if the strict 'login'
    // throttler were wrongly applied globally instead of being scoped to the login route,
    // this would already return 429 well before this many calls.
    for (let i = 0; i < loginLimit + 3; i += 1) {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    }
  });
});

describe('Password length policy (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    // Only ever deletes the throwaway, easily-recognisable `e2e_pwlen_` rows created below.
    await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
      'e2e_pwlen_%',
    ]);
    await app.close();
  });

  // Formerly its own 'AppController (e2e)' describe with a dedicated `AppModule` instance
  // (beforeEach/afterEach — recreated per test, though it only ever had this one test).
  // Merged here to avoid a 4th `AppModule` instantiation in this file: this route carries no
  // auth and touches no database row, so it cannot interfere with the password-length
  // assertions below, and — unlike 'Login rate limiting' above — it is not throttler-sensitive
  // (`GET /api` carries no `@StrictLoginThrottle()`, so it is exempt from the 'login' bucket
  // via `skipIf`; it only spends one unit of the 'default' 100-req/60s bucket, the same one
  // every other request in this describe already spends). Path is `/api`, not `/`, because
  // this describe's app has `setGlobalPrefix('api')` set (mirroring `src/main.ts`), which the
  // original standalone describe never did.
  it('/api (GET)', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Hello World!');
  });

  it('rejects a 9-character password (one below the 10-character minimum)', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username: 'e2e_pwlen_short',
        email: 'e2e_pwlen_short@test.local',
        // Exactly 9 characters, otherwise meeting the complexity policy: length is the only
        // thing this request can fail on.
        password: 'Ab1cdefgh',
      })
      .expect(400);
  });

  it('accepts a 10-character password meeting the complexity policy', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username: 'e2e_pwlen_exact',
        email: 'e2e_pwlen_exact@test.local',
        // Exactly 10 characters: the new minimum from the cahier des charges §6.3.
        password: 'Ab1cdefghi',
      })
      .expect(201);
  });
});

// Minimal fixture used only to prove, end-to-end, that a real HTTP request whose body
// contains a password never leaks it into the log output produced by the exact same
// `buildPinoHttpOptions()` configuration `app.module.ts` wires into the real application.
@Controller('log-echo-fixture')
class LogEchoFixtureController {
  @Post()
  @HttpCode(HttpStatus.CREATED)
  echo(@Body() body: Record<string, unknown>): Record<string, unknown> {
    return body;
  }
}

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
}

// Not a churn source: this `Test.createTestingModule` call does NOT import `AppModule` — it
// wires only `LoggerModule.forRoot(...)` and a throwaway controller, on purpose, to prove the
// exact `buildPinoHttpOptions()` config in isolation. Opening no `BullModule`/`MailModule`
// means no BullMQ Queue, Worker, or blocking connection is created here — nothing to merge or
// reduce. Importing `AppModule` to share an instance with another describe would add Redis
// connections here where today there are none, which is the opposite of the goal.
describe('Request log redaction (e2e)', () => {
  it('never writes a plaintext request-body password to the log output', async () => {
    const capturedLogs = new MemoryStream();
    const plainPassword = 'Sup3rSecretRealRequest!';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [
            buildPinoHttpOptions({ level: LogLevel.Info, pretty: false }),
            capturedLogs,
          ],
        }),
      ],
      controllers: [LogEchoFixtureController],
    }).compile();

    const app: INestApplication<App> = moduleFixture.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post('/log-echo-fixture')
      .send({ identifier: 'e2e_redaction_user', password: plainPassword })
      .expect(201);

    await app.close();

    const logOutput = capturedLogs.content;
    // Non-tautological: proves the body really was captured in the log line (so there was
    // something to redact in the first place), and that the intentionally-not-redacted
    // `identifier` field is still visible for security monitoring purposes.
    expect(logOutput).toContain('e2e_redaction_user');
    expect(logOutput).toContain('[REDACTED]');
    // The actual security property under test.
    expect(logOutput).not.toContain(plainPassword);
  });
});
