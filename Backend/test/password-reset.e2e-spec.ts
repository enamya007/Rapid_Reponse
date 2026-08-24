import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { MailMessage } from '../src/modules/mail/dto/mail-message';
import { MailQueueService } from '../src/modules/mail/mail-queue.service';

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; email: string };
}

interface ForgotPasswordResponseBody {
  message: string;
}

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

// `pwd_e2e_` -- NOT `e2e_%` (wiped by `auth.e2e-spec.ts`'s own `beforeAll`/`afterAll`), and
// distinct from every other suite's own fixture prefix, so this suite's data can never be
// deleted mid-run by another spec file, nor vice versa. Jest runs e2e specs serially
// (`maxWorkers: 1`, `test/jest-e2e.json`) against one shared, real database.
const ALICE = {
  username: 'pwd_e2e_alice',
  email: 'pwd_e2e_alice@test.local',
  password: 'PwdE2eAlice123',
};
const CAROL = {
  username: 'pwd_e2e_carol',
  email: 'pwd_e2e_carol@test.local',
  password: 'PwdE2eCarol123',
};
const DAVE = {
  username: 'pwd_e2e_dave',
  email: 'pwd_e2e_dave@test.local',
  password: 'PwdE2eDave123',
};
const ERIN = {
  username: 'pwd_e2e_erin',
  email: 'pwd_e2e_erin@test.local',
  password: 'PwdE2eErin123',
};
const FRANK = {
  username: 'pwd_e2e_frank',
  email: 'pwd_e2e_frank@test.local',
  password: 'PwdE2eFrank123',
};
const NEW_PASSWORD = 'PwdE2eNewPass456';
const GHOST_EMAIL = 'pwd_e2e_ghost_never_registered@test.local';
const INVALID_TOKEN_MESSAGE = 'Invalid or expired token';
const FORGOT_PASSWORD_MESSAGE =
  'If the account exists, a reset link has been sent.';

async function registerFixtureUser(
  app: INestApplication<App>,
  credentials: { username: string; email: string; password: string },
): Promise<AuthResponseBody> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send(credentials)
    .expect(201);
  return res.body as AuthResponseBody;
}

async function cleanupFixtures(dataSource: DataSource): Promise<void> {
  // `password_reset_tokens.user_id` and `refresh_tokens.user_id` are both `ON DELETE CASCADE`
  // (`docs/data-model.md`), so deleting the fixture users below cascades both. This suite never
  // creates tickets/attachments, so there is nothing else to clean up first.
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
    'pwd_e2e_%',
  ]);
}

// Extracts the `<row id>.<secret>` reset token embedded in the reset link of a rendered
// `passwordResetMail` message (P6 contract D11). Reading it from the RENDERED message that got
// enqueued -- rather than reaching into the database for the row id/secret directly -- is what
// actually proves the right token reached the right place (§9: "à la frontière de la file").
function extractResetToken(message: MailMessage): string {
  const match = message.text.match(/token=(\S+)/);
  if (!match) {
    throw new Error('reset token not found in the rendered mail message');
  }
  return match[1];
}

function splitToken(token: string): { id: string; secret: string } {
  const separatorIndex = token.indexOf('.');
  return {
    id: token.slice(0, separatorIndex),
    secret: token.slice(separatorIndex + 1),
  };
}

describe('Password reset (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;

  // P6 contract §9: the SMTP-facing side of P6 is doubled at the queue boundary -- the `.env`
  // on this machine points at a real, production SMTP server, and this suite must never
  // actually send an email. `MailModule` only exports `MailQueueService` (by design), so this
  // is also the ONLY seam available to intercept a password-reset email, exactly like
  // `attachments.e2e-spec.ts` doubles `StorageService`.
  const mailQueueMock = {
    enqueue: jest.fn<Promise<void>, [MailMessage]>(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailQueueService)
      .useValue(mailQueueMock)
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirrors `src/main.ts` exactly: same global prefix and the same `ValidationPipe`
    // configuration the real application boots with.
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
    throttlerStorage = app.get<ThrottlerStorageService>(getStorageToken());

    // Clean slate: remove any leftover data from a previous, possibly interrupted run before
    // this suite creates its own.
    await cleanupFixtures(dataSource);

    await registerFixtureUser(app, ALICE);
    await registerFixtureUser(app, CAROL);
    await registerFixtureUser(app, DAVE);
    await registerFixtureUser(app, ERIN);
    await registerFixtureUser(app, FRANK);
  });

  afterAll(async () => {
    await cleanupFixtures(dataSource);
    await app.close();
  });

  // `forgot-password` and `reset-password` both carry `@StrictLoginThrottle()` (P6 contract
  // D13) and therefore share the SAME 'login' counter as `/auth/login`
  // (`THROTTLE_LOGIN_LIMIT=5` per 60s, per `.env`). Clearing the in-memory storage before every
  // test keeps each one's quota independent, exactly like `auth.e2e-spec.ts` does for its own
  // `/auth/login` tests -- never touches the configured limit itself.
  beforeEach(() => {
    throttlerStorage.storage.clear();
    mailQueueMock.enqueue.mockClear();
  });

  describe('full flow: request a reset link, consume it, and its side effects', () => {
    let resetToken: string;
    let preResetRefreshToken: string;

    it('POST /api/auth/forgot-password returns 202 with the fixed message and enqueues a well-formed reset link', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: ALICE.username, password: ALICE.password })
        .expect(200);
      preResetRefreshToken = (loginRes.body as AuthResponseBody).refreshToken;

      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: ALICE.email })
        .expect(202);

      expect(res.body as ForgotPasswordResponseBody).toEqual({
        message: FORGOT_PASSWORD_MESSAGE,
      });
      expect(mailQueueMock.enqueue).toHaveBeenCalledTimes(1);
      const [message] = mailQueueMock.enqueue.mock.calls[0];
      expect(message.to).toBe(ALICE.email);
      resetToken = extractResetToken(message);
      expect(resetToken).toContain('.');
    });

    it('POST /api/auth/reset-password consumes the token: 204', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: resetToken, newPassword: NEW_PASSWORD })
        .expect(204);
    });

    it('the OLD password no longer works after the reset', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: ALICE.username, password: ALICE.password })
        .expect(401);
      expect((res.body as ErrorResponseBody).message).toBe(
        'Invalid credentials',
      );
    });

    it('the NEW password logs in successfully', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: ALICE.username, password: NEW_PASSWORD })
        .expect(200);
    });

    it('D14: the refresh token issued BEFORE the reset was revoked -- refreshing with it now fails', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: preResetRefreshToken })
        .expect(401);
    });

    it('refuses to reuse the same, already-consumed token: uniform 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: resetToken, newPassword: 'AnotherStr0ngP@ss1' })
        .expect(400);
      expect((res.body as ErrorResponseBody).message).toBe(
        INVALID_TOKEN_MESSAGE,
      );
    });
  });

  describe('D13: anti-enumeration', () => {
    it('returns the EXACT SAME 202 body for an existing account and an email that was never registered', async () => {
      const existingRes = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: CAROL.email })
        .expect(202);

      const unknownRes = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: GHOST_EMAIL })
        .expect(202);

      expect(unknownRes.body as ForgotPasswordResponseBody).toEqual(
        existingRes.body as ForgotPasswordResponseBody,
      );
      expect(existingRes.body as ForgotPasswordResponseBody).toEqual({
        message: FORGOT_PASSWORD_MESSAGE,
      });
    });

    it('a disabled account also gets the same 202, but no email is ever enqueued for it', async () => {
      // No admin endpoint exists to deactivate an account (out of scope for this task):
      // flip the flag directly in the database, same technique as `auth.e2e-spec.ts`'s DAN
      // fixture.
      await dataSource.query(
        'UPDATE users SET is_active = false WHERE username = $1',
        [ERIN.username],
      );

      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: ERIN.email })
        .expect(202);

      expect(res.body as ForgotPasswordResponseBody).toEqual({
        message: FORGOT_PASSWORD_MESSAGE,
      });
      expect(mailQueueMock.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('D12: uniform 400 on an expired token', () => {
    it('rejects a token whose row has expired, using a real 1h TTL row pushed into the past', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: DAVE.email })
        .expect(202);
      expect(res.body as ForgotPasswordResponseBody).toEqual({
        message: FORGOT_PASSWORD_MESSAGE,
      });

      expect(mailQueueMock.enqueue).toHaveBeenCalledTimes(1);
      const [message] = mailQueueMock.enqueue.mock.calls[0];
      const token = extractResetToken(message);
      const { id } = splitToken(token);

      // Deterministic: pushes the row's real `expires_at` into the past, rather than waiting
      // out the actual 1h TTL (P6 contract §9 point 10, "le temps doit être contrôlable").
      await dataSource.query(
        "UPDATE password_reset_tokens SET expires_at = now() - interval '1 second' WHERE id = $1",
        [id],
      );

      const resetRes = await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token, newPassword: 'YetAnotherStr0ng1' })
        .expect(400);
      expect((resetRes.body as ErrorResponseBody).message).toBe(
        INVALID_TOKEN_MESSAGE,
      );

      // The account must still be reachable with its ORIGINAL password: the rejected reset
      // must not have partially applied.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: DAVE.username, password: DAVE.password })
        .expect(200);
    });
  });

  describe('D15: newPassword is subject to the same complexity policy as registration', () => {
    it('rejects a new password that satisfies the length bound but not the complexity rule, and leaves the account untouched', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: FRANK.email })
        .expect(202);
      expect(res.body as ForgotPasswordResponseBody).toEqual({
        message: FORGOT_PASSWORD_MESSAGE,
      });

      expect(mailQueueMock.enqueue).toHaveBeenCalledTimes(1);
      const [message] = mailQueueMock.enqueue.mock.calls[0];
      const token = extractResetToken(message);

      // 12 characters -- passes a `@Length(10, 72)`-only bound -- but has no uppercase letter
      // and no digit, so `@IsStrongPassword()`'s complexity rule must reject it before the
      // request ever reaches `AuthService.resetPassword` (ValidationPipe runs first).
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token, newPassword: 'weakpassword' })
        .expect(400);

      // The rejected attempt must not have consumed the token nor changed the password.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: FRANK.username, password: FRANK.password })
        .expect(200);
    });
  });
});
