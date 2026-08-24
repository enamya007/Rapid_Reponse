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

interface SkillResponseBody {
  id: string;
  name: string;
  description: string | null;
}

interface CountRow {
  count: number;
}

interface NameRow {
  name: string;
}

// `skl_e2e_` — NOT `e2e_%` (wiped by `auth.e2e-spec.ts`'s own `beforeAll`/`afterAll`) and never
// touches the 5 reference skills the seed creates ("Électricité", "Plomberie", "Informatique",
// "Climatisation", "Serrurerie"). Jest runs e2e specs serially (`maxWorkers: 1`,
// `test/jest-e2e.json`) against one shared, real database.
const CLIENT = {
  username: 'skl_e2e_client',
  email: 'skl_e2e_client@test.local',
  password: 'SklE2eClient123',
};
const TECHNICIAN = {
  username: 'skl_e2e_tech',
  email: 'skl_e2e_tech@test.local',
  password: 'SklE2eTech123',
};
const ADMIN = {
  username: 'skl_e2e_admin',
  email: 'skl_e2e_admin@test.local',
  password: 'SklE2eAdmin123',
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

async function cleanupFixtures(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM skills WHERE name LIKE $1', [
    'skl_e2e_%',
  ]);
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
    'skl_e2e_%',
  ]);
}

describe('Skills (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let clientTokens: AuthResponseBody;
  let technicianTokens: AuthResponseBody;
  let adminTokens: AuthResponseBody;

  beforeAll(async () => {
    // `SkillsModule` is wired into `AppModule` (T5.0-bis), so importing `AppModule` alone
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

    const techHash = await argon2.hash(TECHNICIAN.password);
    await usersService.create({
      username: TECHNICIAN.username,
      email: TECHNICIAN.email,
      passwordHash: techHash,
      role: UserRole.TECHNICIAN,
    });
    const techLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: TECHNICIAN.username, password: TECHNICIAN.password })
      .expect(200);
    technicianTokens = techLoginRes.body as AuthResponseBody;

    const adminHash = await argon2.hash(ADMIN.password);
    await usersService.create({
      username: ADMIN.username,
      email: ADMIN.email,
      passwordHash: adminHash,
      role: UserRole.ADMIN,
    });
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: ADMIN.username, password: ADMIN.password })
      .expect(200);
    adminTokens = adminLoginRes.body as AuthResponseBody;
  });

  afterAll(async () => {
    await cleanupFixtures(dataSource);
    await app.close();
  });

  describe('POST /api/skills — ADMIN only', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/skills')
        .send({ name: 'skl_e2e_no_auth' })
        .expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({ name: 'skl_e2e_client_attempt' })
        .expect(403);
    });

    it('rejects a TECHNICIAN with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({ name: 'skl_e2e_tech_attempt' })
        .expect(403);
    });

    it('lets an ADMIN create a skill: 201, shaped as SkillResponseDto with no extra key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          name: 'skl_e2e_create',
          description: 'Compétence créée par le test e2e.',
        })
        .expect(201);

      const body = res.body as SkillResponseBody;
      expect(body.id).toEqual(expect.any(String));
      expect(body.name).toBe('skl_e2e_create');
      expect(body.description).toBe('Compétence créée par le test e2e.');
      expect(Object.keys(res.body as object).sort()).toEqual(
        ['description', 'id', 'name'].sort(),
      );
    });

    it('lets an ADMIN create a skill without a description: description is null', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'skl_e2e_no_description' })
        .expect(201);

      expect((res.body as SkillResponseBody).description).toBeNull();
    });

    it('rejects a duplicate name with 409, and writes NO second row', async () => {
      const name = 'skl_e2e_duplicate';
      await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name })
        .expect(201);

      const before = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM skills WHERE name = $1',
        [name],
      );
      expect(before[0].count).toBe(1);

      await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name })
        .expect(409);

      const after = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM skills WHERE name = $1',
        [name],
      );
      expect(after[0].count).toBe(1);
    });

    it('rejects a name shorter than 2 characters with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'a' })
        .expect(400);
    });

    it('rejects a name longer than 80 characters with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'skl_e2e_'.padEnd(81, 'x') })
        .expect(400);
    });

    it('rejects a description longer than 2000 characters with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'skl_e2e_long_desc', description: 'x'.repeat(2001) })
        .expect(400);
    });

    it('rejects an unknown field in the body with 400 (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'skl_e2e_unknown_field', level: 5 })
        .expect(400);
    });
  });

  describe('GET /api/skills — every authenticated role, sorted by name ASC', () => {
    const SORT_A = 'skl_e2e_sort_a_first';
    const SORT_B = 'skl_e2e_sort_b_middle';
    const SORT_C = 'skl_e2e_sort_c_last';

    beforeAll(async () => {
      // Created deliberately out of order (C, then A, then B) so the ordering assertion below
      // is meaningful, not accidental.
      for (const name of [SORT_C, SORT_A, SORT_B]) {
        await request(app.getHttpServer())
          .post('/api/skills')
          .set('Authorization', `Bearer ${adminTokens.accessToken}`)
          .send({ name })
          .expect(201);
      }
    });

    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer()).get('/api/skills').expect(401);
    });

    it('is accessible to a CLIENT: 200, plain array (not a paginated envelope)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/skills')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('is accessible to a TECHNICIAN: 200', async () => {
      await request(app.getHttpServer())
        .get('/api/skills')
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(200);
    });

    it('is accessible to an ADMIN: 200', async () => {
      await request(app.getHttpServer())
        .get('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
    });

    it("returns every skill sorted name ASC, matching the DB's own ORDER BY name ASC exactly (not just the fixtures — the 5 seeded reference skills are present too)", async () => {
      const canonical = await dataSource.query<NameRow[]>(
        'SELECT name FROM skills ORDER BY name ASC',
      );

      const res = await request(app.getHttpServer())
        .get('/api/skills')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .expect(200);

      const body = res.body as SkillResponseBody[];
      expect(body.map((s) => s.name)).toEqual(canonical.map((row) => row.name));
      // Sanity check that this suite's own fixtures really are part of what was compared
      // above, so the assertion isn't vacuously true against an empty/foreign list.
      expect(body.map((s) => s.name)).toEqual(
        expect.arrayContaining([SORT_A, SORT_B, SORT_C]),
      );
    });

    it('each item is shaped as SkillResponseDto with no extra key (no createdAt/updatedAt leak)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as SkillResponseBody[];
      expect(body.length).toBeGreaterThan(0);
      for (const item of body) {
        expect(Object.keys(item).sort()).toEqual(
          ['description', 'id', 'name'].sort(),
        );
      }
    });
  });
});
