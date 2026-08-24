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

interface PaginatedUsersBody {
  data: UserResponseBody[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface TicketResponseBody {
  id: string;
  createdBy: { id: string; username: string } | null;
}

interface CategoryBody {
  id: string;
  name: string;
}

interface CountRow {
  count: number;
}

const USER_RESPONSE_KEYS = [
  'createdAt',
  'email',
  'firstName',
  'id',
  'isActive',
  'lastName',
  'phone',
  'role',
  'username',
].sort();

// `usr_e2e_` — NOT `e2e_%` (wiped by `auth.e2e-spec.ts`) and distinct from every other suite's
// prefix. Jest runs e2e specs serially (`maxWorkers: 1`, `test/jest-e2e.json`) against one
// shared, real database. The seeded skills and categories are NEVER deleted here.
const ADMIN = {
  username: 'usr_e2e_admin',
  email: 'usr_e2e_admin@test.local',
  password: 'UsrE2eAdmin123',
};
const CLIENT = {
  username: 'usr_e2e_client',
  email: 'usr_e2e_client@test.local',
  password: 'UsrE2eClient123',
};
const TECHNICIAN = {
  username: 'usr_e2e_tech',
  email: 'usr_e2e_tech@test.local',
  password: 'UsrE2eTech123',
};
// A throwaway account used for the three destructive scenarios (deactivation, soft deletion,
// and "history survives deletion"), so none of them touches the three fixtures above that every
// other test depends on.
const GHOST = {
  username: 'usr_e2e_ghost',
  email: 'usr_e2e_ghost@test.local',
  password: 'UsrE2eGhost123',
};

// The `login` throttler allows 5 attempts per minute (`THROTTLE_LOGIN_LIMIT`). This suite logs
// in exactly three times — admin, technician, ghost — and proves deactivation through an
// already-issued token rather than by attempting a fresh login, which would both cost a slot and
// test a weaker property.
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
  // Dependency order: notifications -> ticket_assignments -> ticket_status_history -> tickets
  // -> technician_skills -> technician_profiles -> users. `usr_e2e_%` only.
  const scope = ['usr_e2e_%'];
  await dataSource.query(
    `DELETE FROM notifications
     WHERE recipient_id IN (SELECT id FROM users WHERE username LIKE $1)
        OR ticket_id IN (
          SELECT id FROM tickets
          WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
             OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
        )`,
    scope,
  );
  await dataSource.query(
    `DELETE FROM ticket_assignments
     WHERE ticket_id IN (
       SELECT id FROM tickets
       WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
          OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
     )`,
    scope,
  );
  await dataSource.query(
    `DELETE FROM ticket_status_history
     WHERE ticket_id IN (
       SELECT id FROM tickets
       WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
          OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
     )`,
    scope,
  );
  await dataSource.query(
    `DELETE FROM tickets
     WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
        OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    scope,
  );
  await dataSource.query(
    `DELETE FROM technician_skills
     WHERE technician_profile_id IN (
       SELECT tp.id FROM technician_profiles tp
       JOIN users u ON u.id = tp.user_id
       WHERE u.username LIKE $1
     )`,
    scope,
  );
  await dataSource.query(
    `DELETE FROM technician_profiles
     WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    scope,
  );
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', scope);
}

describe('Users administration (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  let adminTokens: AuthResponseBody;
  let clientTokens: AuthResponseBody;
  let technicianTokens: AuthResponseBody;
  let ghostTokens: AuthResponseBody;

  let adminId: string;
  let technicianId: string;
  let ghostId: string;
  let categoryId: string;
  let ghostTicketId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors `src/main.ts` exactly.
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
    const admin = await usersService.create({
      username: ADMIN.username,
      email: ADMIN.email,
      passwordHash: await argon2.hash(ADMIN.password),
      role: UserRole.ADMIN,
    });
    adminId = admin.id;
    adminTokens = await loginAs(app, ADMIN.username, ADMIN.password);

    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(CLIENT)
      .expect(201);
    clientTokens = registerRes.body as AuthResponseBody;

    // Through `POST /technicians`, so the account gets its `TechnicianProfile` and is eligible
    // for assignment — which the D4 scenario below depends on.
    const techRes = await request(app.getHttpServer())
      .post('/api/technicians')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({
        username: TECHNICIAN.username,
        email: TECHNICIAN.email,
        password: TECHNICIAN.password,
      })
      .expect(201);
    technicianId = (techRes.body as { id: string }).id;
    technicianTokens = await loginAs(
      app,
      TECHNICIAN.username,
      TECHNICIAN.password,
    );

    // Exercises the new `GET /categories` route as a side effect of needing a category id.
    const categoriesRes = await request(app.getHttpServer())
      .get('/api/categories?isActive=true')
      .set('Authorization', `Bearer ${clientTokens.accessToken}`)
      .expect(200);
    categoryId = (categoriesRes.body as CategoryBody[])[0].id;

    const ghostRes = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send(GHOST)
      .expect(201);
    ghostId = (ghostRes.body as UserResponseBody).id;
    ghostTokens = await loginAs(app, GHOST.username, GHOST.password);

    const ghostTicketRes = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${ghostTokens.accessToken}`)
      .send({
        title: 'usr_e2e ticket created by the ghost account',
        description: 'Must stay readable after its author is soft-deleted.',
        categoryId,
      })
      .expect(201);
    ghostTicketId = (ghostTicketRes.body as TicketResponseBody).id;
  });

  afterAll(async () => {
    await cleanupFixtures(dataSource);
    await app.close();
  });

  describe('POST /api/users — ADMIN only', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .send({
          username: 'usr_e2e_noauth',
          email: 'usr_e2e_noauth@test.local',
          password: 'UsrE2eNoAuth123',
        })
        .expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({
          username: 'usr_e2e_byclient',
          email: 'usr_e2e_byclient@test.local',
          password: 'UsrE2eByClient1',
        })
        .expect(403);
    });

    it('rejects a TECHNICIAN with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({
          username: 'usr_e2e_bytech',
          email: 'usr_e2e_bytech@test.local',
          password: 'UsrE2eByTech123',
        })
        .expect(403);
    });

    it('lets an ADMIN create a CLIENT: 201, shaped as UserResponseDto with no password key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'usr_e2e_created',
          email: 'usr_e2e_created@test.local',
          password: 'UsrE2eCreated123',
          firstName: 'Ada',
        })
        .expect(201);

      const body = res.body as UserResponseBody;
      expect(Object.keys(res.body as object).sort()).toEqual(
        USER_RESPONSE_KEYS,
      );
      // Defaulted, not echoed from the request: no `role` was sent.
      expect(body.role).toBe(UserRole.CLIENT);
      expect(body.isActive).toBe(true);
      expect(body.firstName).toBe('Ada');
    });

    it('lets an ADMIN create another ADMIN', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'usr_e2e_admin2',
          email: 'usr_e2e_admin2@test.local',
          password: 'UsrE2eAdmin2123',
          role: UserRole.ADMIN,
        })
        .expect(201);

      expect((res.body as UserResponseBody).role).toBe(UserRole.ADMIN);
    });

    it('D1: refuses role TECHNICIAN with 400 and writes NO user row', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'usr_e2e_rejected_tech',
          email: 'usr_e2e_rejected_tech@test.local',
          password: 'UsrE2eRejTech123',
          role: UserRole.TECHNICIAN,
        })
        .expect(400);

      const rows = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM users WHERE username = $1',
        ['usr_e2e_rejected_tech'],
      );
      expect(rows[0].count).toBe(0);
    });

    it('rejects a duplicate username with 409, and writes no second row', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: CLIENT.username,
          email: 'usr_e2e_other_email@test.local',
          password: 'UsrE2eDuplicate1',
        })
        .expect(409);

      const rows = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM users WHERE username = $1',
        [CLIENT.username],
      );
      expect(rows[0].count).toBe(1);
    });

    it('applies the shared password policy: a weak password is a 400', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'usr_e2e_weak',
          email: 'usr_e2e_weak@test.local',
          password: 'short',
        })
        .expect(400);
    });

    it('rejects an unknown field with 400 (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'usr_e2e_unknown',
          email: 'usr_e2e_unknown@test.local',
          password: 'UsrE2eUnknown123',
          isSuperAdmin: true,
        })
        .expect(400);
    });
  });

  describe('GET /api/users — ADMIN only', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .expect(403);
    });

    it('returns a paginated envelope, sorted by username ASC, with no password key on any item', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users?limit=100')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as PaginatedUsersBody;
      expect(Object.keys(body).sort()).toEqual(['data', 'meta']);
      expect(body.meta.limit).toBe(100);
      for (const item of body.data) {
        expect(Object.keys(item).sort()).toEqual(USER_RESPONSE_KEYS);
      }

      const ours = body.data
        .map((user) => user.username)
        .filter((username) => username.startsWith('usr_e2e_'));
      expect(ours).toEqual([...ours].sort());
      expect(ours.length).toBeGreaterThan(1);
    });

    it('filters by role', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/users?role=${UserRole.TECHNICIAN}&limit=100`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as PaginatedUsersBody;
      expect(body.data.length).toBeGreaterThan(0);
      for (const user of body.data) {
        expect(user.role).toBe(UserRole.TECHNICIAN);
      }
      expect(body.data.map((user) => user.username)).toContain(
        TECHNICIAN.username,
      );
    });

    it('D10: escapes LIKE wildcards — `search=%` matches literally, not everything', async () => {
      const all = await request(app.getHttpServer())
        .get('/api/users?limit=100')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      expect((all.body as PaginatedUsersBody).meta.total).toBeGreaterThan(0);

      const wildcard = await request(app.getHttpServer())
        .get('/api/users?search=%25')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      // No fixture username contains a literal '%'. Unescaped, this would have returned every
      // account — which is exactly the bypass D10 closes.
      expect((wildcard.body as PaginatedUsersBody).meta.total).toBe(0);
    });

    it('matches a real search term, case-insensitively, across username and email', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users?search=USR_E2E_TECH&limit=100')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as PaginatedUsersBody;
      expect(body.data.map((user) => user.username)).toContain(
        TECHNICIAN.username,
      );
    });
  });

  describe('GET /api/users/:id — ADMIN only', () => {
    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .get(`/api/users/${technicianId}`)
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .expect(403);
    });

    it('returns the account for an ADMIN', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/users/${technicianId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      expect((res.body as UserResponseBody).username).toBe(TECHNICIAN.username);
    });

    it('404s on an unknown id', async () => {
      await request(app.getHttpServer())
        .get('/api/users/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(404);
    });

    it('400s on a non-UUID id (ParseUUIDPipe)', async () => {
      await request(app.getHttpServer())
        .get('/api/users/not-a-uuid')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(400);
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${technicianId}`)
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({ firstName: 'Nope' })
        .expect(403);
    });

    it('rejects an empty body with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${technicianId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({})
        .expect(400);
    });

    it('D3: refuses an ADMIN changing their own role, leaving the row untouched', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${adminId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ role: UserRole.CLIENT })
        .expect(400);

      const rows = await dataSource.query<{ role: string }[]>(
        'SELECT role FROM users WHERE id = $1',
        [adminId],
      );
      expect(rows[0].role).toBe(UserRole.ADMIN);
    });

    it('D3: refuses an ADMIN deactivating themselves', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${adminId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ isActive: false })
        .expect(400);
    });

    it('D3: still lets an ADMIN edit their own profile fields', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/users/${adminId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ firstName: 'Root' })
        .expect(200);

      expect((res.body as UserResponseBody).firstName).toBe('Root');
    });

    it('D2: refuses promoting a CLIENT to TECHNICIAN', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${ghostId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ role: UserRole.TECHNICIAN })
        .expect(400);
    });

    it('D2: refuses demoting a TECHNICIAN, leaving both the role and the profile intact', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${technicianId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ role: UserRole.CLIENT })
        .expect(400);

      const profiles = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM technician_profiles WHERE user_id = $1',
        [technicianId],
      );
      expect(profiles[0].count).toBe(1);
    });

    it('D2: allows CLIENT -> ADMIN', async () => {
      const target = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          username: 'usr_e2e_promoted',
          email: 'usr_e2e_promoted@test.local',
          password: 'UsrE2ePromoted12',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/users/${(target.body as UserResponseBody).id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ role: UserRole.ADMIN })
        .expect(200);

      expect((res.body as UserResponseBody).role).toBe(UserRole.ADMIN);
    });

    it('409s when renaming onto a username another account already holds', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${ghostId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ username: CLIENT.username })
        .expect(409);
    });

    it('404s on an unknown id', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ firstName: 'Nobody' })
        .expect(404);
    });

    // D5 — the property that makes deactivation meaningful: an access token issued BEFORE the
    // account was disabled must stop working immediately, without any token revocation step.
    it('D5: deactivating an account invalidates its already-issued access token on the next request', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${ghostTokens.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/users/${ghostId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ isActive: false })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${ghostTokens.accessToken}`)
        .expect(401);
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('rejects a CLIENT with 403', async () => {
      await request(app.getHttpServer())
        .delete(`/api/users/${ghostId}`)
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .expect(403);
    });

    it('D3: refuses an ADMIN deleting themselves', async () => {
      await request(app.getHttpServer())
        .delete(`/api/users/${adminId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(400);
    });

    it('D4: 409s while the user is the assignee of a live ticket, and deletes nothing', async () => {
      const ticketRes = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({
          title: 'usr_e2e live ticket blocking a deletion',
          description: 'Assigned to the technician fixture.',
          categoryId,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(
          `/api/tickets/${(ticketRes.body as TicketResponseBody).id}/assign`,
        )
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/users/${technicianId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(409);

      const rows = await dataSource.query<{ deleted_at: string | null }[]>(
        'SELECT deleted_at FROM users WHERE id = $1',
        [technicianId],
      );
      expect(rows[0].deleted_at).toBeNull();
    });

    it('soft-deletes: 204, the row survives with deleted_at set, and the account disappears from the API', async () => {
      await request(app.getHttpServer())
        .delete(`/api/users/${ghostId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(204);

      const rows = await dataSource.query<{ deleted_at: string | null }[]>(
        'SELECT deleted_at FROM users WHERE id = $1',
        [ghostId],
      );
      // The row is still there — this is a soft delete, for traceability.
      expect(rows).toHaveLength(1);
      expect(rows[0].deleted_at).not.toBeNull();

      await request(app.getHttpServer())
        .get(`/api/users/${ghostId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(404);

      const list = await request(app.getHttpServer())
        .get('/api/users?limit=100')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      expect(
        (list.body as PaginatedUsersBody).data.map((user) => user.username),
      ).not.toContain(GHOST.username);
    });

    it('the tickets a deleted user created stay readable, with their author still attributed', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ghostTicketId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketResponseBody;
      expect(body.createdBy).not.toBeNull();
      expect(body.createdBy?.username).toBe(GHOST.username);
    });

    it('404s on a second delete of the same (already soft-deleted) account', async () => {
      await request(app.getHttpServer())
        .delete(`/api/users/${ghostId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(404);
    });
  });
});
