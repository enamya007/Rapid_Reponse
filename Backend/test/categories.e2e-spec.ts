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

interface SkillBody {
  id: string;
  name: string;
  description: string | null;
}

interface CategoryBody {
  id: string;
  name: string;
  description: string | null;
  requiredSkill: SkillBody | null;
  isActive: boolean;
}

interface CountRow {
  count: number;
}

interface NameRow {
  name: string;
}

const CATEGORY_RESPONSE_KEYS = [
  'description',
  'id',
  'isActive',
  'name',
  'requiredSkill',
].sort();

// `cat_e2e_` — NOT `e2e_%` (wiped by `auth.e2e-spec.ts`). The 5 seeded reference categories and
// skills are NEVER deleted by this suite: the ticket-creation flow and the suggestion engine
// depend on them.
const ADMIN = {
  username: 'cat_e2e_admin',
  email: 'cat_e2e_admin@test.local',
  password: 'CatE2eAdmin123',
};
const CLIENT = {
  username: 'cat_e2e_client',
  email: 'cat_e2e_client@test.local',
  password: 'CatE2eClient123',
};

async function cleanupFixtures(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM categories WHERE name LIKE $1', [
    'cat_e2e_%',
  ]);
  await dataSource.query('DELETE FROM skills WHERE name LIKE $1', [
    'cat_e2e_%',
  ]);
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
    'cat_e2e_%',
  ]);
}

describe('Categories (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  let adminTokens: AuthResponseBody;
  let clientTokens: AuthResponseBody;
  let skillAId: string;
  let skillBId: string;

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
    await cleanupFixtures(dataSource);

    const usersService = app.get(UsersService);
    await usersService.create({
      username: ADMIN.username,
      email: ADMIN.email,
      passwordHash: await argon2.hash(ADMIN.password),
      role: UserRole.ADMIN,
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: ADMIN.username, password: ADMIN.password })
      .expect(200);
    adminTokens = adminLogin.body as AuthResponseBody;

    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(CLIENT)
      .expect(201);
    clientTokens = registerRes.body as AuthResponseBody;

    for (const name of ['cat_e2e_skill_a', 'cat_e2e_skill_b']) {
      const res = await request(app.getHttpServer())
        .post('/api/skills')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name })
        .expect(201);
      if (name.endsWith('_a')) {
        skillAId = (res.body as SkillBody).id;
      } else {
        skillBId = (res.body as SkillBody).id;
      }
    }
  });

  afterAll(async () => {
    await cleanupFixtures(dataSource);
    await app.close();
  });

  describe('POST /api/categories — ADMIN only', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/categories')
        .send({ name: 'cat_e2e_noauth' })
        .expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({ name: 'cat_e2e_byclient' })
        .expect(403);
    });

    it('lets an ADMIN create one: 201, shaped as CategoryResponseDto with the skill nested', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          name: 'cat_e2e_created',
          description: 'Créée par la suite e2e.',
          requiredSkillId: skillAId,
        })
        .expect(201);

      const body = res.body as CategoryBody;
      expect(Object.keys(res.body as object).sort()).toEqual(
        CATEGORY_RESPONSE_KEYS,
      );
      expect(body.isActive).toBe(true);
      // Nested, not just an id: this is what saves the front a second call to /skills.
      expect(body.requiredSkill?.id).toBe(skillAId);
      expect(body.requiredSkill?.name).toBe('cat_e2e_skill_a');
    });

    it('creates one without a required skill: requiredSkill is null, and the key is present', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'cat_e2e_no_skill' })
        .expect(201);

      const body = res.body as CategoryBody;
      expect(body.requiredSkill).toBeNull();
      expect('requiredSkill' in body).toBe(true);
      expect(body.description).toBeNull();
    });

    it('404s on an unknown requiredSkillId, and writes NO row', async () => {
      await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          name: 'cat_e2e_ghost_skill',
          requiredSkillId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(404);

      const rows = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM categories WHERE name = $1',
        ['cat_e2e_ghost_skill'],
      );
      expect(rows[0].count).toBe(0);
    });

    it('409s on a duplicate name, and writes no second row', async () => {
      await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'cat_e2e_created' })
        .expect(409);

      const rows = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM categories WHERE name = $1',
        ['cat_e2e_created'],
      );
      expect(rows[0].count).toBe(1);
    });

    it('rejects a name shorter than 2 characters with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'a' })
        .expect(400);
    });

    it('rejects an unknown field with 400 (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'cat_e2e_unknown_field', isActive: false })
        .expect(400);
    });
  });

  describe('GET /api/categories — every authenticated role (D7)', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer()).get('/api/categories').expect(401);
    });

    it('is accessible to a CLIENT, which is what makes the ticket-creation form possible', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/categories')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const names = (res.body as CategoryBody[]).map((c) => c.name);
      expect(names).toContain('cat_e2e_created');
      // The seeded referential is visible too, not just this suite's fixtures.
      expect(names).toContain('Panne électrique');
    });

    it("returns a plain array sorted name ASC, matching the DB's own ORDER BY exactly", async () => {
      const canonical = await dataSource.query<NameRow[]>(
        'SELECT name FROM categories ORDER BY name ASC',
      );

      const res = await request(app.getHttpServer())
        .get('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      expect((res.body as CategoryBody[]).map((c) => c.name)).toEqual(
        canonical.map((row) => row.name),
      );
    });

    it('filters on isActive, and parses `false` as false rather than as a truthy string', async () => {
      await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'cat_e2e_retired' })
        .then((res) =>
          request(app.getHttpServer())
            .patch(`/api/categories/${(res.body as CategoryBody).id}`)
            .set('Authorization', `Bearer ${adminTokens.accessToken}`)
            .send({ isActive: false })
            .expect(200),
        );

      const inactive = await request(app.getHttpServer())
        .get('/api/categories?isActive=false')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      const inactiveNames = (inactive.body as CategoryBody[]).map(
        (c) => c.name,
      );
      expect(inactiveNames).toContain('cat_e2e_retired');
      expect(inactiveNames).not.toContain('cat_e2e_created');

      const active = await request(app.getHttpServer())
        .get('/api/categories?isActive=true')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      const activeNames = (active.body as CategoryBody[]).map((c) => c.name);
      expect(activeNames).toContain('cat_e2e_created');
      expect(activeNames).not.toContain('cat_e2e_retired');
    });

    it('never leaks createdAt/updatedAt on any item', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      for (const item of res.body as CategoryBody[]) {
        expect(Object.keys(item).sort()).toEqual(CATEGORY_RESPONSE_KEYS);
      }
    });
  });

  describe('PATCH /api/categories/:id — ADMIN only', () => {
    let categoryId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'cat_e2e_patchable', requiredSkillId: skillAId })
        .expect(201);
      categoryId = (res.body as CategoryBody).id;
    });

    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/categories/${categoryId}`)
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({ name: 'cat_e2e_nope' })
        .expect(403);
    });

    it('rejects an empty body with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({})
        .expect(400);
    });

    it('404s on an unknown id', async () => {
      await request(app.getHttpServer())
        .patch('/api/categories/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ isActive: false })
        .expect(404);
    });

    it('replaces the required skill, and the response reports the NEW one', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ requiredSkillId: skillBId })
        .expect(200);

      expect((res.body as CategoryBody).requiredSkill?.name).toBe(
        'cat_e2e_skill_b',
      );
    });

    it('clears the required skill when null is sent explicitly', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ requiredSkillId: null })
        .expect(200);

      expect((res.body as CategoryBody).requiredSkill).toBeNull();

      const rows = await dataSource.query<
        { required_skill_id: string | null }[]
      >('SELECT required_skill_id FROM categories WHERE id = $1', [categoryId]);
      expect(rows[0].required_skill_id).toBeNull();
    });

    it('404s on an unknown replacement skill, and changes nothing', async () => {
      await request(app.getHttpServer())
        .patch(`/api/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          name: 'cat_e2e_should_not_apply',
          requiredSkillId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(404);

      const rows = await dataSource.query<NameRow[]>(
        'SELECT name FROM categories WHERE id = $1',
        [categoryId],
      );
      expect(rows[0].name).toBe('cat_e2e_patchable');
    });

    it('409s when renaming onto a name another category already holds', async () => {
      await request(app.getHttpServer())
        .patch(`/api/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'cat_e2e_created' })
        .expect(409);
    });

    it('accepts a patch that repeats the category own current name', async () => {
      await request(app.getHttpServer())
        .patch(`/api/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'cat_e2e_patchable', description: 'Inchangé.' })
        .expect(200);
    });
  });

  describe('D6 — a category is retired, never deleted', () => {
    it('exposes no DELETE route at all', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'cat_e2e_undeletable' })
        .expect(201);

      // 404 = no route matched. `tickets.category_id` is a foreign key: deleting a category
      // would orphan every historical ticket pointing at it.
      await request(app.getHttpServer())
        .delete(`/api/categories/${(res.body as CategoryBody).id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(404);
    });

    it('a retired category can no longer be used to open a ticket, but still exists', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ name: 'cat_e2e_closing_down' })
        .expect(201);
      const categoryId = (created.body as CategoryBody).id;

      await request(app.getHttpServer())
        .patch(`/api/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ isActive: false })
        .expect(200);

      // `TicketsService.create` treats an inactive category as unusable — which is precisely
      // what makes deactivation a real retirement rather than a cosmetic flag.
      await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({
          title: 'cat_e2e ticket on a retired category',
          description: 'Must be refused.',
          categoryId,
        })
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
    });
  });
});
