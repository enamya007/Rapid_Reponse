import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { UsersService } from '../src/modules/users/users.service';

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string };
}

interface TechnicianSkillResponseBody {
  id: string;
  name: string;
  level: number;
}

interface TechnicianResponseBody {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isActive: boolean;
  isAvailable: boolean;
  maxConcurrentTickets: number;
  currentLoad: number;
  skills: TechnicianSkillResponseBody[];
}

interface PaginatedTechnicianResponseBody {
  data: TechnicianResponseBody[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface CountRow {
  count: number;
}

interface IdRow {
  id: string;
}

const TECHNICIAN_RESPONSE_KEYS = [
  'currentLoad',
  'email',
  'firstName',
  'id',
  'isActive',
  'isAvailable',
  'lastName',
  'maxConcurrentTickets',
  'phone',
  'skills',
  'username',
].sort();

// `tch_e2e_` — NOT `e2e_%` (wiped by `auth.e2e-spec.ts`'s own `beforeAll`/`afterAll`). Jest runs
// e2e specs serially (`maxWorkers: 1`, `test/jest-e2e.json`) against one shared, real database.
const CLIENT = {
  username: 'tch_e2e_client',
  email: 'tch_e2e_client@test.local',
  password: 'TchE2eClient123',
};
const ADMIN = {
  username: 'tch_e2e_admin',
  email: 'tch_e2e_admin@test.local',
  password: 'TchE2eAdmin123',
};
// Created through `POST /technicians` itself in `beforeAll` (not `UsersService.create()`
// directly): unlike `skills.e2e-spec.ts`'s baseline technician, this suite's technician-scoped
// tests (`GET/PATCH /technicians/:id`, `PATCH /technicians/me/availability`) require a real
// `TechnicianProfile` row, which only that endpoint creates.
const BASELINE_TECH = {
  username: 'tch_e2e_baseline',
  email: 'tch_e2e_baseline@test.local',
  password: 'TchE2eBaseline1',
};

async function registerClient(
  app: INestApplication<App>,
  credentials: { username: string; email: string; password: string },
): Promise<AuthResponseBody> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send(credentials)
    .expect(201);
  return res.body as AuthResponseBody;
}

async function loginAs(
  app: INestApplication<App>,
  identifier: string,
  password: string,
): Promise<AuthResponseBody> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ identifier, password })
    .expect(200);
  return res.body as AuthResponseBody;
}

async function cleanupFixtures(dataSource: DataSource): Promise<void> {
  // Dependency order (technician_skills -> technician_profiles -> tickets -> users), scoped
  // exclusively to `tch_e2e_%` usernames. The 5 reference skills and the seeded categories are
  // NEVER touched (no `DELETE FROM skills`/`categories` anywhere in this file).
  await dataSource.query(
    `DELETE FROM technician_skills
     WHERE technician_profile_id IN (
       SELECT tp.id FROM technician_profiles tp
       JOIN users u ON u.id = tp.user_id
       WHERE u.username LIKE $1
     )`,
    ['tch_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM technician_profiles
     WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    ['tch_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM tickets
     WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
        OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    ['tch_e2e_%'],
  );
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
    'tch_e2e_%',
  ]);
}

describe('Technicians (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let clientTokens: AuthResponseBody;
  let adminTokens: AuthResponseBody;
  let technicianTokens: AuthResponseBody;
  let baselineTechnicianId: string;
  let skillIdByName: Map<string, string>;
  let categoryId: string;

  beforeAll(async () => {
    // `TechniciansModule` is wired into `AppModule` (T5.0-bis), so importing `AppModule` alone
    // exercises the same module graph the running application boots.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

    // Clean slate: remove any leftover data from a previous, possibly interrupted run before
    // this suite creates its own.
    await cleanupFixtures(dataSource);

    clientTokens = await registerClient(app, CLIENT);

    const usersService = app.get(UsersService);
    const adminHash = await argon2.hash(ADMIN.password);
    await usersService.create({
      username: ADMIN.username,
      email: ADMIN.email,
      passwordHash: adminHash,
      role: UserRole.ADMIN,
    });
    adminTokens = await loginAs(app, ADMIN.username, ADMIN.password);

    const baselineRes = await request(app.getHttpServer())
      .post('/api/technicians')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send(BASELINE_TECH)
      .expect(201);
    baselineTechnicianId = (baselineRes.body as TechnicianResponseBody).id;
    technicianTokens = await loginAs(
      app,
      BASELINE_TECH.username,
      BASELINE_TECH.password,
    );

    const skillRows = await dataSource.query<
      Array<{ id: string; name: string }>
    >(`SELECT id, name FROM skills WHERE name = ANY($1)`, [
      [
        'Électricité',
        'Plomberie',
        'Informatique',
        'Climatisation',
        'Serrurerie',
      ],
    ]);
    skillIdByName = new Map(skillRows.map((row) => [row.name, row.id]));

    const [categoryRow] = await dataSource.query<IdRow[]>(
      `SELECT id FROM categories WHERE name = $1`,
      ['Panne électrique'],
    );
    categoryId = categoryRow.id;
  });

  afterAll(async () => {
    await cleanupFixtures(dataSource);
    await app.close();
  });

  async function createTechnician(
    overrides: Partial<{
      username: string;
      email: string;
      password: string;
      isAvailable: boolean;
      maxConcurrentTickets: number;
      skills: Array<{ skillId: string; level?: number }>;
    }> = {},
  ): Promise<{ body: TechnicianResponseBody; status: number }> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const res = await request(app.getHttpServer())
      .post('/api/technicians')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({
        username: `tch_e2e_${suffix}`,
        email: `tch_e2e_${suffix}@test.local`,
        password: 'TchE2eGenerated1',
        ...overrides,
      });
    return { body: res.body as TechnicianResponseBody, status: res.status };
  }

  async function fetchProfileId(userId: string): Promise<string> {
    const [row] = await dataSource.query<IdRow[]>(
      'SELECT id FROM technician_profiles WHERE user_id = $1',
      [userId],
    );
    return row.id;
  }

  // Narrows `Map.get`'s `string | undefined` to `string`, failing loudly (rather than silently
  // sending `skillId: undefined`) if one of the 5 seeded reference skills were ever missing.
  function getSkillId(name: string): string {
    const id = skillIdByName.get(name);
    if (!id) {
      throw new Error(
        `Seeded skill "${name}" not found — did the seed change?`,
      );
    }
    return id;
  }

  describe('POST /api/technicians — ADMIN only', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/technicians')
        .send({
          username: 'tch_e2e_no_auth',
          email: 'tch_e2e_no_auth@test.local',
          password: 'TchE2eNoAuth1',
        })
        .expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({
          username: 'tch_e2e_client_attempt',
          email: 'tch_e2e_client_attempt@test.local',
          password: 'TchE2eClientAt1',
        })
        .expect(403);
    });

    it('rejects a TECHNICIAN with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({
          username: 'tch_e2e_tech_attempt',
          email: 'tch_e2e_tech_attempt@test.local',
          password: 'TchE2eTechAtt1',
        })
        .expect(403);
    });

    it('lets an ADMIN create a technician: 201, TechnicianResponseDto shape only (D4: id is the userId, never TechnicianProfile.id; never password)', async () => {
      const { body, status } = await createTechnician();
      expect(status).toBe(201);

      expect(Object.keys(body).sort()).toEqual(TECHNICIAN_RESPONSE_KEYS);
      expect(body).not.toHaveProperty('password');
      expect(body.isAvailable).toBe(true);
      expect(body.maxConcurrentTickets).toBe(5);
      expect(body.currentLoad).toBe(0);
      expect(body.skills).toEqual([]);

      const profileId = await fetchProfileId(body.id);
      expect(profileId).not.toBe(body.id);

      const [userRow] = await dataSource.query<Array<{ role: string }>>(
        'SELECT role FROM users WHERE id = $1',
        [body.id],
      );
      expect(userRow.role).toBe('TECHNICIAN');
    });

    it('honors explicit isAvailable/maxConcurrentTickets instead of the defaults', async () => {
      const { body } = await createTechnician({
        isAvailable: false,
        maxConcurrentTickets: 2,
      });

      expect(body.isAvailable).toBe(false);
      expect(body.maxConcurrentTickets).toBe(2);
    });

    it('creates the requested skills, and the technician can log in afterward with the given password (end-to-end proof that hashPassword hashed it correctly)', async () => {
      const suffix = Math.random().toString(36).slice(2, 10);
      const username = `tch_e2e_${suffix}`;
      const password = 'TchE2eLoginOk1';
      const skillId = getSkillId('Plomberie');

      const res = await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username,
          email: `${username}@test.local`,
          password,
          skills: [{ skillId, level: 4 }],
        })
        .expect(201);

      const body = res.body as TechnicianResponseBody;
      expect(body.skills).toEqual([
        { id: skillId, name: 'Plomberie', level: 4 },
      ]);

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: username, password })
        .expect(200);
      expect((loginRes.body as AuthResponseBody).accessToken).toEqual(
        expect.any(String),
      );
    });

    it('rejects a duplicate username with 409', async () => {
      const { body: first } = await createTechnician();

      await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: first.username,
          email: 'tch_e2e_dup_username@test.local',
          password: 'TchE2eDupUser1',
        })
        .expect(409);
    });

    it('rejects a duplicate email with 409', async () => {
      const { body: first } = await createTechnician();

      await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'tch_e2e_dup_email',
          email: first.email,
          password: 'TchE2eDupEmail1',
        })
        .expect(409);
    });

    it('rejects an unknown skillId with 404, and creates NO user row at all (COUNT before/after)', async () => {
      const username = 'tch_e2e_bad_skill';
      const before = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM users WHERE username = $1',
        [username],
      );
      expect(before[0].count).toBe(0);

      await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username,
          email: `${username}@test.local`,
          password: 'TchE2eBadSkill1',
          skills: [{ skillId: '00000000-0000-0000-0000-000000000000' }],
        })
        .expect(404);

      const after = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM users WHERE username = $1',
        [username],
      );
      expect(after[0].count).toBe(0);
    });

    it('rejects an empty username with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'ab',
          email: 'tch_e2e_short_username@test.local',
          password: 'TchE2eShortUs1',
        })
        .expect(400);
    });

    // Password policy aligned on `RegisterDto` (orchestrator arbitration on T5.1b's escalation):
    // `@Length(10, 72)` + at least one lowercase, one uppercase and one digit
    // (`CreateTechnicianDto.password`). These two tests isolate each half of the rule so a
    // regression on either one is caught: the first password below is otherwise
    // policy-compliant except for its length (9 chars), the second is exactly 12 chars
    // (well within bounds) but carries no digit at all.
    it('rejects a 9-character password (below the 10-character minimum) with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'tch_e2e_short_pwd',
          email: 'tch_e2e_short_pwd@test.local',
          password: 'TchE2e123',
        })
        .expect(400);
    });

    it('rejects a 12-character password with no digit (fails the complexity rule despite a valid length) with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'tch_e2e_no_digit_pwd',
          email: 'tch_e2e_no_digit_pwd@test.local',
          password: 'TchTechPassw',
        })
        .expect(400);
    });

    it('rejects an unknown field in the body with 400 (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'tch_e2e_unknown_field',
          email: 'tch_e2e_unknown_field@test.local',
          password: 'TchE2eUnknown1',
          role: 'ADMIN',
        })
        .expect(400);
    });
  });

  describe('GET /api/technicians — ADMIN only, paginated and filtered', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer()).get('/api/technicians').expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/technicians')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .expect(403);
    });

    it('rejects a TECHNICIAN with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/technicians')
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(403);
    });

    it('lets an ADMIN list technicians: 200, paginated envelope { data, meta }', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as PaginatedTechnicianResponseBody;
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toEqual(
        expect.objectContaining({
          total: expect.any(Number) as number,
          page: expect.any(Number) as number,
          limit: expect.any(Number) as number,
          totalPages: expect.any(Number) as number,
        }),
      );
      expect(body.data.length).toBeGreaterThan(0);
      for (const item of body.data) {
        expect(Object.keys(item).sort()).toEqual(TECHNICIAN_RESPONSE_KEYS);
      }
    });

    // The critical regression test for the query-string boolean-parsing pitfall (T5.1b brief):
    // `?isAvailable=false` must genuinely filter to UNAVAILABLE technicians, not silently become
    // truthy via `Boolean('false') === true`.
    it('?isAvailable=false returns only unavailable technicians (proves the query-string boolean conversion actually works)', async () => {
      const { body: available } = await createTechnician({ isAvailable: true });
      const { body: unavailable } = await createTechnician({
        isAvailable: false,
      });

      const res = await request(app.getHttpServer())
        .get('/api/technicians')
        .query({ isAvailable: 'false', limit: 100 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as PaginatedTechnicianResponseBody;
      const ids = body.data.map((item) => item.id);
      expect(ids).toContain(unavailable.id);
      expect(ids).not.toContain(available.id);
      for (const item of body.data) {
        expect(item.isAvailable).toBe(false);
      }
    });

    it('?isAvailable=true returns only available technicians', async () => {
      const { body: available } = await createTechnician({ isAvailable: true });
      const { body: unavailable } = await createTechnician({
        isAvailable: false,
      });

      const res = await request(app.getHttpServer())
        .get('/api/technicians')
        .query({ isAvailable: 'true', limit: 100 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as PaginatedTechnicianResponseBody;
      const ids = body.data.map((item) => item.id);
      expect(ids).toContain(available.id);
      expect(ids).not.toContain(unavailable.id);
    });

    it('?isActive=false returns only deactivated technicians', async () => {
      const { body: technician } = await createTechnician();
      await request(app.getHttpServer())
        .patch(`/api/technicians/${technician.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ isActive: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/technicians')
        .query({ isActive: 'false', limit: 100 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as PaginatedTechnicianResponseBody;
      const ids = body.data.map((item) => item.id);
      expect(ids).toContain(technician.id);
      for (const item of body.data) {
        expect(item.isActive).toBe(false);
      }
    });

    it('?skillId= returns only technicians holding that skill', async () => {
      const skillId = getSkillId('Climatisation');
      const { body: withSkill } = await createTechnician({
        skills: [{ skillId }],
      });
      const { body: withoutSkill } = await createTechnician();

      const res = await request(app.getHttpServer())
        .get('/api/technicians')
        .query({ skillId, limit: 100 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as PaginatedTechnicianResponseBody;
      const ids = body.data.map((item) => item.id);
      expect(ids).toContain(withSkill.id);
      expect(ids).not.toContain(withoutSkill.id);
    });

    it("D4: no list item's id ever equals its own TechnicianProfile.id", async () => {
      const { body: technician } = await createTechnician();
      const profileId = await fetchProfileId(technician.id);

      const res = await request(app.getHttpServer())
        .get('/api/technicians')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as PaginatedTechnicianResponseBody;
      const match = body.data.find((item) => item.id === technician.id);
      expect(match).toBeDefined();
      expect(match?.id).not.toBe(profileId);
    });
  });

  // D10 (`docs/plan-P5-contracts.md` §2) originally justified declaring this route before
  // `GET/PATCH /:id` by a route-collision risk with `ParseUUIDPipe` rejecting `'me'`. That
  // justification was checked and found FALSE for this specific pair: `/technicians/:id`
  // (two path segments) structurally cannot match `/technicians/me/availability` (three
  // segments) — verified against this project's own `path-to-regexp` install and against a
  // live run of this very suite with the routes deliberately reordered (see the implementer's
  // report). The contract has been corrected accordingly. The declaration order below is kept
  // anyway as zero-cost defensive discipline (relevant the day a two-segment `GET /technicians/me`
  // is ever added), but the test below verifies ordinary endpoint behavior for the authenticated
  // technician, not route-collision protection.
  describe('PATCH /api/technicians/me/availability — TECHNICIAN only', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .patch('/api/technicians/me/availability')
        .send({ isAvailable: false })
        .expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .patch('/api/technicians/me/availability')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({ isAvailable: false })
        .expect(403);
    });

    it('rejects an ADMIN with 403', async () => {
      await request(app.getHttpServer())
        .patch('/api/technicians/me/availability')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ isAvailable: false })
        .expect(403);
    });

    it('lets the authenticated TECHNICIAN caller update their OWN availability: 200, with the response reflecting the new isAvailable value', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/technicians/me/availability')
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({ isAvailable: false })
        .expect(200);

      const body = res.body as TechnicianResponseBody;
      expect(body.id).toBe(baselineTechnicianId);
      expect(body.isAvailable).toBe(false);

      // Restore, so later tests in this suite see the baseline technician available again.
      await request(app.getHttpServer())
        .patch('/api/technicians/me/availability')
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({ isAvailable: true })
        .expect(200);
    });

    it('rejects a missing/invalid isAvailable with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/technicians/me/availability')
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('GET /api/technicians/:id', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .get(`/api/technicians/${baselineTechnicianId}`)
        .expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .get(`/api/technicians/${baselineTechnicianId}`)
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .expect(403);
    });

    it('lets an ADMIN read any technician: 200, TechnicianResponseDto shape (D4, no password leak)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/technicians/${baselineTechnicianId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as TechnicianResponseBody;
      expect(body.id).toBe(baselineTechnicianId);
      expect(Object.keys(body).sort()).toEqual(TECHNICIAN_RESPONSE_KEYS);
      expect(body).not.toHaveProperty('password');

      const profileId = await fetchProfileId(baselineTechnicianId);
      expect(profileId).not.toBe(body.id);
    });

    it('lets a TECHNICIAN read their OWN profile: 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/technicians/${baselineTechnicianId}`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(200);

      expect((res.body as TechnicianResponseBody).id).toBe(
        baselineTechnicianId,
      );
    });

    it('rejects a TECHNICIAN reading a DIFFERENT technician profile with 403', async () => {
      const { body: other } = await createTechnician();

      await request(app.getHttpServer())
        .get(`/api/technicians/${other.id}`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(403);
    });

    it('returns 404 for an unknown (but valid-shaped) userId', async () => {
      await request(app.getHttpServer())
        .get('/api/technicians/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(404);
    });

    it('returns 400 for a non-UUID id (ParseUUIDPipe)', async () => {
      await request(app.getHttpServer())
        .get('/api/technicians/not-a-uuid')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(400);
    });
  });

  describe('PATCH /api/technicians/:id — ADMIN only', () => {
    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/technicians/${baselineTechnicianId}`)
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({ isAvailable: false })
        .expect(403);
    });

    it('rejects a TECHNICIAN with 403 (even on their own profile)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/technicians/${baselineTechnicianId}`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({ isAvailable: false })
        .expect(403);
    });

    it('rejects an empty body with 400', async () => {
      const { body: technician } = await createTechnician();

      await request(app.getHttpServer())
        .patch(`/api/technicians/${technician.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({})
        .expect(400);
    });

    it('updates isAvailable/maxConcurrentTickets', async () => {
      const { body: technician } = await createTechnician();

      const res = await request(app.getHttpServer())
        .patch(`/api/technicians/${technician.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ isAvailable: false, maxConcurrentTickets: 3 })
        .expect(200);

      const body = res.body as TechnicianResponseBody;
      expect(body.isAvailable).toBe(false);
      expect(body.maxConcurrentTickets).toBe(3);
    });

    it('isActive: false (D9) disables the account: the technician can no longer log in', async () => {
      const suffix = Math.random().toString(36).slice(2, 10);
      const username = `tch_e2e_${suffix}`;
      const password = 'TchE2eDeactiv1';
      const created = await request(app.getHttpServer())
        .post('/api/technicians')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ username, email: `${username}@test.local`, password })
        .expect(201);
      const technician = created.body as TechnicianResponseBody;

      // Sanity check: login works BEFORE deactivation.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: username, password })
        .expect(200);

      const patchRes = await request(app.getHttpServer())
        .patch(`/api/technicians/${technician.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ isActive: false })
        .expect(200);
      expect((patchRes.body as TechnicianResponseBody).isActive).toBe(false);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: username, password })
        .expect(401);
    });

    it('returns 404 for an unknown userId', async () => {
      await request(app.getHttpServer())
        .patch('/api/technicians/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ isAvailable: false })
        .expect(404);
    });
  });

  describe('PUT /api/technicians/:id/skills — ADMIN only, full replacement', () => {
    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .put(`/api/technicians/${baselineTechnicianId}/skills`)
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({ skills: [] })
        .expect(403);
    });

    it('rejects a TECHNICIAN with 403', async () => {
      await request(app.getHttpServer())
        .put(`/api/technicians/${baselineTechnicianId}/skills`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({ skills: [] })
        .expect(403);
    });

    it('fully replaces the skill set: 2 skills -> PUT with 1 -> only 1 remains (both in the response AND in the DB)', async () => {
      const electriciteId = getSkillId('Électricité');
      const informatiqueId = getSkillId('Informatique');
      const serrurerieId = getSkillId('Serrurerie');

      const { body: technician } = await createTechnician({
        skills: [
          { skillId: electriciteId, level: 2 },
          { skillId: informatiqueId, level: 3 },
        ],
      });
      const profileId = await fetchProfileId(technician.id);

      const before = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM technician_skills WHERE technician_profile_id = $1',
        [profileId],
      );
      expect(before[0].count).toBe(2);

      const res = await request(app.getHttpServer())
        .put(`/api/technicians/${technician.id}/skills`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ skills: [{ skillId: serrurerieId, level: 5 }] })
        .expect(200);

      const body = res.body as TechnicianResponseBody;
      expect(body.skills).toEqual([
        { id: serrurerieId, name: 'Serrurerie', level: 5 },
      ]);

      const after = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM technician_skills WHERE technician_profile_id = $1',
        [profileId],
      );
      expect(after[0].count).toBe(1);
    });

    it('rejects an unknown skillId with 404, and leaves the existing skill set untouched', async () => {
      const plomberieId = getSkillId('Plomberie');
      const { body: technician } = await createTechnician({
        skills: [{ skillId: plomberieId }],
      });
      const profileId = await fetchProfileId(technician.id);

      await request(app.getHttpServer())
        .put(`/api/technicians/${technician.id}/skills`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ skills: [{ skillId: '00000000-0000-0000-0000-000000000000' }] })
        .expect(404);

      const after = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM technician_skills WHERE technician_profile_id = $1',
        [profileId],
      );
      expect(after[0].count).toBe(1);
    });

    it('returns 404 for an unknown technician id', async () => {
      await request(app.getHttpServer())
        .put('/api/technicians/00000000-0000-0000-0000-000000000000/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ skills: [] })
        .expect(404);
    });
  });

  // D3 (`docs/plan-P5-contracts.md` §2): currentLoad = non-soft-deleted tickets ASSIGNED/
  // IN_PROGRESS to this technician. There is no `POST /tickets/:id/assign` endpoint yet (T5.3,
  // out of this task's scope) — tickets are created through the real `POST /tickets` endpoint,
  // then their `assignee_id`/`status` are set directly via SQL purely to exercise the READ-side
  // aggregation this module owns, independent of the not-yet-built assignment write path.
  describe('currentLoad (D3) reflects real ticket state, computed in SQL', () => {
    it('counts only ASSIGNED/IN_PROGRESS tickets, excluding CLOSED ones, both on GET /:id and on the list', async () => {
      const { body: technician } = await createTechnician();

      const ticketIds: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/api/tickets')
          .set('Authorization', `Bearer ${clientTokens.accessToken}`)
          .send({
            title: `tch_e2e current load ticket ${i}`,
            description: 'Fixture ticket for the currentLoad e2e test.',
            categoryId,
          })
          .expect(201);
        ticketIds.push((res.body as { id: string }).id);
      }

      await dataSource.query(
        `UPDATE tickets SET assignee_id = $1, status = 'ASSIGNED' WHERE id = $2`,
        [technician.id, ticketIds[0]],
      );
      await dataSource.query(
        `UPDATE tickets SET assignee_id = $1, status = 'IN_PROGRESS' WHERE id = $2`,
        [technician.id, ticketIds[1]],
      );
      await dataSource.query(
        `UPDATE tickets SET assignee_id = $1, status = 'CLOSED' WHERE id = $2`,
        [technician.id, ticketIds[2]],
      );

      const getRes = await request(app.getHttpServer())
        .get(`/api/technicians/${technician.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      expect((getRes.body as TechnicianResponseBody).currentLoad).toBe(2);

      const listRes = await request(app.getHttpServer())
        .get('/api/technicians')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      const listBody = listRes.body as PaginatedTechnicianResponseBody;
      const match = listBody.data.find((item) => item.id === technician.id);
      expect(match?.currentLoad).toBe(2);
    });
  });
});
