import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

interface UserResponseBody {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  user: UserResponseBody;
}

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

interface CountRow {
  count: number;
}

// All e2e-created data uses this fixed, easily-recognisable prefix so it never collides with
// (and can always be cleanly separated from) real/dev data such as the seeded admin.
const ALICE = {
  username: 'e2e_alice',
  email: 'e2e_alice@test.local',
  password: 'E2eAlicePass123',
};
const BOB = {
  username: 'e2e_bob',
  email: 'e2e_bob@test.local',
  password: 'E2eBobPass123',
};

function assertNoPasswordLeak(body: unknown, plainPassword: string): void {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain(plainPassword);
  expect(serialized).not.toContain('$argon2');
  expect(serialized.toLowerCase()).not.toMatch(/"password/);
}

async function countUsersMatching(
  dataSource: DataSource,
  whereClause: string,
  params: unknown[] = [],
): Promise<number> {
  const rows = await dataSource.query<CountRow[]>(
    `SELECT count(*)::int AS count FROM users WHERE ${whereClause}`,
    params,
  );
  return Number(rows[0].count);
}

async function cleanupE2eUsers(dataSource: DataSource): Promise<void> {
  // `refresh_tokens.user_id` has `ON DELETE CASCADE`, so this also cleans up every refresh
  // token belonging to these throwaway users. Never touches anything outside the `e2e_` prefix
  // (in particular, never touches the seeded `admin` user).
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', ['e2e_%']);
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let aliceTokens: AuthResponseBody;
  let bobTokens: AuthResponseBody;
  let nonE2eUserCountBeforeSuite: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors `src/main.ts` exactly, so these tests exercise what the app actually does in
    // production (global `api` prefix + the same `ValidationPipe` configuration).
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

    // Snapshot (not a hardcoded value) of every user outside the `e2e_` prefix, taken BEFORE
    // anything in this suite runs, including the very first cleanup call below. CI runs on a
    // fresh database (this will be 0), while a local dev database has the seeded `admin` user
    // (this will be 1) — both are valid starting points. Taking it before the initial cleanup
    // (rather than after) matters: it lets us prove that cleanup itself didn't touch anything
    // outside the `e2e_` prefix, instead of just comparing two post-cleanup states that could
    // both have been wiped out identically by an over-broad `DELETE`.
    nonE2eUserCountBeforeSuite = await countUsersMatching(
      dataSource,
      "username NOT LIKE 'e2e_%'",
    );

    await cleanupE2eUsers(dataSource);

    // Baseline invariant, checked before this suite creates any data of its own: no leftover
    // `e2e_` data from a previous (e.g. interrupted) run, and the initial cleanup did not
    // touch anything outside the `e2e_` prefix (in particular, the seeded admin, when present).
    expect(await countUsersMatching(dataSource, "username LIKE 'e2e_%'")).toBe(
      0,
    );
    expect(
      await countUsersMatching(dataSource, "username NOT LIKE 'e2e_%'"),
    ).toBe(nonE2eUserCountBeforeSuite);

    const aliceRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(ALICE)
      .expect(201);
    aliceTokens = aliceRes.body as AuthResponseBody;

    const bobRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(BOB)
      .expect(201);
    bobTokens = bobRes.body as AuthResponseBody;
  });

  afterAll(async () => {
    await cleanupE2eUsers(dataSource);
    // Must be exactly the pre-suite snapshot: proves the cleanup only ever removed `e2e_`
    // rows and never touched real data (e.g. the seeded admin), regardless of DB state.
    expect(
      await countUsersMatching(dataSource, "username NOT LIKE 'e2e_%'"),
    ).toBe(nonE2eUserCountBeforeSuite);
    await app.close();
  });

  // Every test in this file starts with a clean rate-limit quota. Without this, tests that
  // each make one or more real `/api/auth/login` calls (this file makes six across the
  // 'POST /api/auth/login' block alone) would eventually trip the real, unmodified
  // `THROTTLE_LOGIN_LIMIT` (5/min, see `THROTTLE_LOGIN_*` in `.env`) shared by the whole
  // suite, and a later test would observe 429 instead of the 401/200 it actually exercises.
  // This never touches the configured limit itself — `ThrottlerModule`'s real, production
  // `THROTTLE_LOGIN_LIMIT` still governs every single request below — it only clears the
  // in-memory hit counters between tests, exactly as if a fresh 60-second window had started.
  // Directly clearing the underlying `Map` (rather than only resetting one throttler's count)
  // is safe here: `ThrottlerStorageService.onApplicationShutdown()` (invoked by `app.close()`
  // in `afterAll` above) clears every still-pending decrement timer regardless, and none of
  // them fire on their own within this suite's few-seconds runtime (the shortest TTL is 60s).
  beforeEach(() => {
    throttlerStorage.storage.clear();
  });

  describe('POST /api/auth/register', () => {
    it('creates a new user and returns a token pair whose body never leaks the password', async () => {
      const payload = {
        username: 'e2e_regshape',
        email: 'e2e_regshape@test.local',
        password: 'E2eRegShapePass123',
      };

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(payload)
        .expect(201);

      const body = res.body as AuthResponseBody;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toEqual(expect.any(String));
      expect(body.user.username).toBe(payload.username);
      expect(body.user.email).toBe(payload.email);
      // Self-registration always yields a CLIENT account: there is no way for the caller to
      // request a different role (see the dedicated mass-assignment test below).
      expect(body.user.role).toBe('CLIENT');
      assertNoPasswordLeak(res.body, payload.password);
    });

    it('persists and returns the optional profile fields (firstName, lastName, phone) when provided', async () => {
      const payload = {
        username: 'e2e_profile',
        email: 'e2e_profile@test.local',
        password: 'E2eProfilePass123',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+1 555 123 4567',
      };

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(payload)
        .expect(201);

      const body = res.body as AuthResponseBody;
      expect(body.user.firstName).toBe(payload.firstName);
      expect(body.user.lastName).toBe(payload.lastName);
      expect(body.user.phone).toBe(payload.phone);
    });

    it('rejects registration with a username that is already taken', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: ALICE.username,
          email: 'someone-else@test.local',
          password: 'AnotherPass123',
        })
        .expect(409);
    });

    it('rejects a password that does not meet the complexity policy', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'e2e_weakpw',
          email: 'e2e_weakpw@test.local',
          password: 'weakpassword',
        })
        .expect(400);
    });

    it('rejects an unexpected extra field (role), preventing privilege escalation via mass assignment', async () => {
      const username = 'e2e_extrafield';

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username,
          email: 'e2e_extrafield@test.local',
          password: 'E2eExtraPass123',
          role: 'ADMIN',
        })
        .expect(400);

      // The offending request must not have created a row at all.
      expect(
        await countUsersMatching(dataSource, 'username = $1', [username]),
      ).toBe(0);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with the username as identifier and returns a fresh token pair', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: ALICE.username, password: ALICE.password })
        .expect(200);

      const body = res.body as AuthResponseBody;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toEqual(expect.any(String));
      expect(body.user.username).toBe(ALICE.username);
    });

    it('logs in with the email as identifier and returns a fresh token pair', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: ALICE.email, password: ALICE.password })
        .expect(200);

      const body = res.body as AuthResponseBody;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toEqual(expect.any(String));
      expect(body.user.username).toBe(ALICE.username);
      expect(body.user.email).toBe(ALICE.email);
    });

    it('rejects a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: ALICE.username, password: 'TotallyWrongPass123' })
        .expect(401);
    });

    it('rejects an unknown identifier, a wrong password, and a disabled account with the exact same 401 error message (anti-enumeration)', async () => {
      const DAN = {
        username: 'e2e_dan',
        email: 'e2e_dan@test.local',
        password: 'E2eDanPass123',
      };
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(DAN)
        .expect(201);
      // No admin endpoint exists yet to deactivate an account (out of scope for this task):
      // flip the flag directly in the database to set up the fixture.
      await dataSource.query(
        'UPDATE users SET is_active = false WHERE username = $1',
        [DAN.username],
      );

      const wrongPasswordRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: ALICE.username, password: 'TotallyWrongPass123' })
        .expect(401);
      const unknownIdentifierRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'e2e_ghost_user', password: 'Whatever123' })
        .expect(401);
      const disabledAccountRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: DAN.username, password: DAN.password })
        .expect(401);

      const wrongPasswordBody = wrongPasswordRes.body as ErrorResponseBody;
      const unknownIdentifierBody =
        unknownIdentifierRes.body as ErrorResponseBody;
      const disabledAccountBody = disabledAccountRes.body as ErrorResponseBody;
      expect(unknownIdentifierBody.message).toEqual(wrongPasswordBody.message);
      expect(disabledAccountBody.message).toEqual(wrongPasswordBody.message);
    });
  });

  describe('GET /api/auth/me', () => {
    it('rejects a request without an access token', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });

    it('rejects a request with a garbage access token', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer this-is-not-a-jwt')
        .expect(401);
    });

    it('returns the currently authenticated user for a valid access token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);

      const body = res.body as UserResponseBody;
      expect(body.username).toBe(ALICE.username);
      expect(body.email).toBe(ALICE.email);
    });
  });

  describe('PATCH /api/auth/me', () => {
    it('rejects a request without an access token', async () => {
      await request(app.getHttpServer())
        .patch('/api/auth/me')
        .send({ firstName: 'Nope' })
        .expect(401);
    });

    it('rejects an empty body', async () => {
      await request(app.getHttpServer())
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({})
        .expect(400);
    });

    it('rejects role and isActive as unknown fields (whitelist)', async () => {
      await request(app.getHttpServer())
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({ role: 'ADMIN', isActive: false })
        .expect(400);
    });

    it("updates the caller's own profile fields and persists them", async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({
          firstName: 'Alice',
          lastName: 'Wonderland',
          phone: '+22890000001',
        })
        .expect(200);

      const body = res.body as UserResponseBody;
      expect(body.firstName).toBe('Alice');
      expect(body.lastName).toBe('Wonderland');
      expect(body.phone).toBe('+22890000001');
      expect(body.role).toBe('CLIENT');

      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);
      expect((me.body as UserResponseBody).firstName).toBe('Alice');
    });

    it("rejects a username already used by another account, and never touches the caller's row", async () => {
      const before = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({ username: BOB.username })
        .expect(409);

      const after = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);
      expect((after.body as UserResponseBody).username).toBe(
        (before.body as UserResponseBody).username,
      );
    });

    it('cannot be used to change another user, only the caller (isolation)', async () => {
      const before = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${bobTokens.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({ firstName: 'Should not affect Bob' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${bobTokens.accessToken}`)
        .expect(200);
      expect((after.body as UserResponseBody).firstName).toBe(
        (before.body as UserResponseBody).firstName,
      );
    });
  });

  describe('refresh token rotation', () => {
    const CAROL = {
      username: 'e2e_carol',
      email: 'e2e_carol@test.local',
      password: 'E2eCarolPass123',
    };
    let firstRefreshToken: string;
    let secondRefreshToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(CAROL)
        .expect(201);
      firstRefreshToken = (res.body as AuthResponseBody).refreshToken;
    });

    // These three tests intentionally build on each other, in this exact order, to exercise a
    // single stateful security flow (rotate -> replay the stale token -> prove the family was
    // revoked). They all live in this one `describe` and rely on Jest's default in-file,
    // top-to-bottom execution order.
    it('rotates the refresh token on a valid refresh call, returning a brand-new one', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(200);

      secondRefreshToken = (res.body as AuthResponseBody).refreshToken;
      expect(secondRefreshToken).not.toBe(firstRefreshToken);
    });

    it('rejects reuse of the old, already-rotated refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(401);
    });

    it('detects the replay and revokes the whole token family, invalidating the latest token too', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: secondRefreshToken })
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    const ERIN = {
      username: 'e2e_erin',
      email: 'e2e_erin@test.local',
      password: 'E2eErinPass123',
    };
    let erinAccessToken: string;
    let erinRefreshToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(ERIN)
        .expect(201);
      const body = res.body as AuthResponseBody;
      erinAccessToken = body.accessToken;
      erinRefreshToken = body.refreshToken;
    });

    it('revokes the refresh token, so it can no longer be used to refresh', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${erinAccessToken}`)
        .send({ refreshToken: erinRefreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: erinRefreshToken })
        .expect(401);
    });

    it('is idempotent: logging out an already-revoked token still returns 204', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${erinAccessToken}`)
        .send({ refreshToken: erinRefreshToken })
        .expect(204);
    });
  });

  describe('cross-user isolation', () => {
    it("does not let a user revoke another user's refresh token via logout", async () => {
      // Alice, authenticated as herself, attempts to log out using Bob's refresh token.
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({ refreshToken: bobTokens.refreshToken })
        .expect(204); // idempotent no-op: does not reveal whether the token belongs to someone else

      // Bob's refresh token must still be usable: it was not actually revoked.
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: bobTokens.refreshToken })
        .expect(200);
      expect((res.body as AuthResponseBody).refreshToken).not.toBe(
        bobTokens.refreshToken,
      );
    });
  });
});
