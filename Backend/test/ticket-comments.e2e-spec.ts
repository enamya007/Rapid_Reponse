import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Category } from '../src/modules/categories/entities/category.entity';
import { Ticket } from '../src/modules/tickets/entities/ticket.entity';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { UsersService } from '../src/modules/users/users.service';

interface TicketResponseBody {
  id: string;
}

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string };
}

interface CommentAuthorBody {
  id: string;
  username: string;
}

interface CommentResponseBody {
  id: string;
  body: string;
  visibility: string;
  author: CommentAuthorBody | null;
  createdAt: string;
}

interface PaginationMetaBody {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface CommentListResponseBody {
  data: CommentResponseBody[];
  meta: PaginationMetaBody;
}

interface CountRow {
  count: number;
}

// `tcm_e2e_` — NOT `e2e_%` (wiped by `auth.e2e-spec.ts`'s own `beforeAll`/`afterAll`) and NOT
// `tickets_e2e_%` (this suite's own, unrelated, fixtures), so this suite's data can never be
// deleted mid-run by another spec file, nor vice versa. Jest runs e2e specs serially
// (`maxWorkers: 1`, `test/jest-e2e.json`) against one shared, real database.
const OWNER = {
  username: 'tcm_e2e_owner',
  email: 'tcm_e2e_owner@test.local',
  password: 'TcmE2eOwner123',
};
const OTHER_CLIENT = {
  username: 'tcm_e2e_other_client',
  email: 'tcm_e2e_other_client@test.local',
  password: 'TcmE2eOther123',
};
// Neither TECHNICIAN nor ADMIN can self-register (`RegisterDto` has no `role` field): both are
// created directly through `UsersService`, exactly like `tickets.e2e-spec.ts`'s own technician
// fixture, then authenticated through the REAL `/api/auth/login` so every test below exercises
// the genuine JWT/guard path, not a hand-crafted token.
const ASSIGNED_TECH = {
  username: 'tcm_e2e_tech_assigned',
  email: 'tcm_e2e_tech_assigned@test.local',
  password: 'TcmE2eTechA123',
};
const OTHER_TECH = {
  username: 'tcm_e2e_tech_other',
  email: 'tcm_e2e_tech_other@test.local',
  password: 'TcmE2eTechO123',
};
const ADMIN = {
  username: 'tcm_e2e_admin',
  email: 'tcm_e2e_admin@test.local',
  password: 'TcmE2eAdmin123',
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
  // Order matters: `tickets.created_by_id` is `ON DELETE RESTRICT` (`docs/data-model.md`
  // §2.7), so tickets must go before users. `ticket_comments.ticket_id` is `ON DELETE CASCADE`
  // from `tickets`, so deleting the tickets below already cascades their comments — the
  // explicit `DELETE FROM ticket_comments` first is defense in depth, not strictly required,
  // matching the belt-and-braces style of `tickets.e2e-spec.ts`'s own cleanup.
  await dataSource.query(
    `DELETE FROM ticket_comments WHERE ticket_id IN (SELECT id FROM tickets WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1))`,
    ['tcm_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM tickets WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    ['tcm_e2e_%'],
  );
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
    'tcm_e2e_%',
  ]);
}

describe('Ticket comments (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ticketRepository: Repository<Ticket>;
  let ownerTokens: AuthResponseBody;
  let otherClientTokens: AuthResponseBody;
  let assignedTechTokens: AuthResponseBody;
  let otherTechTokens: AuthResponseBody;
  let adminTokens: AuthResponseBody;
  let assignedTechnicianId: string;
  let categoryId: string;
  // Only set (and only cleaned up) if no active category already existed to reuse — mirrors
  // `tickets.e2e-spec.ts`: this suite never deletes pre-existing reference data.
  let createdFallbackCategoryId: string | null = null;

  async function createOwnerTicket(title: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
      .send({
        title,
        description: 'Ticket créé pour couvrir POST/GET /tickets/:id/comments.',
        categoryId,
      })
      .expect(201);
    return (res.body as TicketResponseBody).id;
  }

  beforeAll(async () => {
    // `TicketCommentsModule` is wired into `AppModule` (T4.0-bis), so importing `AppModule`
    // alone is what these tests exercise — the same graph the running app boots.
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
    ticketRepository = dataSource.getRepository(Ticket);

    // Clean slate: remove any leftover data from a previous, possibly interrupted run before
    // this suite creates its own.
    await cleanupFixtures(dataSource);

    // Reuse an existing active category rather than require one, exactly like
    // `tickets.e2e-spec.ts`.
    const categoryRepository = dataSource.getRepository(Category);
    const existingCategory = await categoryRepository.findOne({
      where: { isActive: true },
    });
    if (existingCategory) {
      categoryId = existingCategory.id;
    } else {
      const created = await categoryRepository.save(
        categoryRepository.create({
          name: 'Ticket Comments E2E Fallback Category',
          isActive: true,
        }),
      );
      categoryId = created.id;
      createdFallbackCategoryId = created.id;
    }

    ownerTokens = await registerClient(app, OWNER);
    otherClientTokens = await registerClient(app, OTHER_CLIENT);

    const usersService = app.get(UsersService);

    const assignedTechHash = await argon2.hash(ASSIGNED_TECH.password);
    const assignedTechnician = await usersService.create({
      username: ASSIGNED_TECH.username,
      email: ASSIGNED_TECH.email,
      passwordHash: assignedTechHash,
      role: UserRole.TECHNICIAN,
    });
    assignedTechnicianId = assignedTechnician.id;
    const assignedTechLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        identifier: ASSIGNED_TECH.username,
        password: ASSIGNED_TECH.password,
      })
      .expect(200);
    assignedTechTokens = assignedTechLoginRes.body as AuthResponseBody;

    const otherTechHash = await argon2.hash(OTHER_TECH.password);
    await usersService.create({
      username: OTHER_TECH.username,
      email: OTHER_TECH.email,
      passwordHash: otherTechHash,
      role: UserRole.TECHNICIAN,
    });
    const otherTechLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: OTHER_TECH.username, password: OTHER_TECH.password })
      .expect(200);
    otherTechTokens = otherTechLoginRes.body as AuthResponseBody;

    // ADMIN via `UsersService.create()`, not the seeded account: `RegisterDto` has no `role`
    // field, and depending on the seeded account would couple this suite to `pnpm seed` having
    // already run against whichever database it targets — exactly the pattern the brief
    // prescribes for T4.5 (`docs/plan-P4-contracts.md` says nothing about the seed here; the
    // brief for this task is explicit: "TECHNICIAN/ADMIN via UsersService.create()").
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
    if (createdFallbackCategoryId) {
      await dataSource.query('DELETE FROM categories WHERE id = $1', [
        createdFallbackCategoryId,
      ]);
    }
    await app.close();
  });

  describe('POST /api/tickets/:id/comments — OwnershipGuard + INTERNAL visibility rule', () => {
    let ticketId: string;

    beforeAll(async () => {
      ticketId = await createOwnerTicket('Ticket pour les tests POST comments');
      await ticketRepository.update(ticketId, {
        assigneeId: assignedTechnicianId,
      });
    });

    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .send({ body: 'Sans authentification' })
        .expect(401);
    });

    it('returns 404 for a well-formed but non-existent ticket id', async () => {
      await request(app.getHttpServer())
        .post('/api/tickets/00000000-0000-4000-8000-000000000000/comments')
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ body: 'Ticket inexistant' })
        .expect(404);
    });

    it('rejects another CLIENT (neither owner nor assignee) with 403 (OwnershipGuard)', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${otherClientTokens.accessToken}`)
        .send({ body: "Bob tente de commenter le ticket d'Owner" })
        .expect(403);
    });

    it('rejects a TECHNICIAN who is NOT assigned to the ticket with 403 (OwnershipGuard)', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${otherTechTokens.accessToken}`)
        .send({ body: 'Technicien non assigné tente de commenter' })
        .expect(403);
    });

    it('lets the owner CLIENT post a PUBLIC comment (default visibility): 201, shaped as CommentResponseDto with no extra key', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ body: 'Merci de votre intervention rapide.' })
        .expect(201);

      const body = res.body as CommentResponseBody;
      expect(body.id).toEqual(expect.any(String));
      expect(body.body).toBe('Merci de votre intervention rapide.');
      expect(body.visibility).toBe('PUBLIC');
      expect(body.author).toEqual({
        id: ownerTokens.user.id,
        username: OWNER.username,
      });
      expect(body.createdAt).toEqual(expect.any(String));
      expect(Object.keys(res.body as object).sort()).toEqual(
        ['author', 'body', 'createdAt', 'id', 'visibility'].sort(),
      );
    });

    it('lets the assigned TECHNICIAN post a comment: 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${assignedTechTokens.accessToken}`)
        .send({ body: 'Sur place, diagnostic en cours.' })
        .expect(201);

      expect((res.body as CommentResponseBody).author).toEqual({
        id: assignedTechTokens.user.id,
        username: ASSIGNED_TECH.username,
      });
    });

    it('lets an ADMIN post an INTERNAL comment: 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ body: 'Note interne admin.', visibility: 'INTERNAL' })
        .expect(201);

      expect((res.body as CommentResponseBody).visibility).toBe('INTERNAL');
    });

    it('lets the assigned TECHNICIAN post an INTERNAL comment: 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${assignedTechTokens.accessToken}`)
        .send({ body: 'Pièce à commander.', visibility: 'INTERNAL' })
        .expect(201);

      expect((res.body as CommentResponseBody).visibility).toBe('INTERNAL');
    });

    it('rejects the owner CLIENT posting visibility: INTERNAL with 403, and writes NO row at all', async () => {
      const before = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM ticket_comments WHERE ticket_id = $1',
        [ticketId],
      );

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({
          body: "J'essaie de poster en interne.",
          visibility: 'INTERNAL',
        })
        .expect(403);

      const after = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM ticket_comments WHERE ticket_id = $1',
        [ticketId],
      );
      expect(after[0].count).toBe(before[0].count);
    });

    it('rejects an empty body with 400', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ body: '' })
        .expect(400);
    });

    it('rejects a body longer than 5000 characters with 400', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ body: 'x'.repeat(5001) })
        .expect(400);
    });

    it('rejects an invalid visibility value with 400', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ body: 'Valeur de visibilité invalide', visibility: 'SECRET' })
        .expect(400);
    });
  });

  describe('GET /api/tickets/:id/comments — OwnershipGuard, pagination, createdAt ASC, INTERNAL filtering', () => {
    let ticketId: string;
    let publicComment1Id: string;
    let publicComment2Id: string;
    let internalCommentId: string;

    beforeAll(async () => {
      ticketId = await createOwnerTicket('Ticket pour les tests GET comments');
      await ticketRepository.update(ticketId, {
        assigneeId: assignedTechnicianId,
      });

      // Posted strictly in sequence (each `await`ed) so `createdAt` is strictly increasing —
      // proves the ASC ordering assertion below is meaningful, not accidental.
      const res1 = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ body: 'Premier message public.' })
        .expect(201);
      publicComment1Id = (res1.body as CommentResponseBody).id;

      const resInternal = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          body: 'Note interne admin, jamais visible du client.',
          visibility: 'INTERNAL',
        })
        .expect(201);
      internalCommentId = (resInternal.body as CommentResponseBody).id;

      const res2 = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${assignedTechTokens.accessToken}`)
        .send({ body: 'Deuxième message public.' })
        .expect(201);
      publicComment2Id = (res2.body as CommentResponseBody).id;
    });

    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/comments`)
        .expect(401);
    });

    it('returns 404 for a well-formed but non-existent ticket id', async () => {
      await request(app.getHttpServer())
        .get('/api/tickets/00000000-0000-4000-8000-000000000000/comments')
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(404);
    });

    it('rejects another CLIENT (neither owner nor assignee) with 403 (OwnershipGuard)', async () => {
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${otherClientTokens.accessToken}`)
        .expect(403);
    });

    it('rejects a TECHNICIAN who is NOT assigned to the ticket with 403 (OwnershipGuard)', async () => {
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${otherTechTokens.accessToken}`)
        .expect(403);
    });

    it('the owner CLIENT never sees the INTERNAL comment: only the 2 PUBLIC ones, and meta.total reflects the filtered (SQL-level) count, not the raw 3', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(200);

      const body = res.body as CommentListResponseBody;
      const ids = body.data.map((c) => c.id);
      expect(ids).toEqual([publicComment1Id, publicComment2Id]);
      expect(ids).not.toContain(internalCommentId);
      expect(body.meta.total).toBe(2);
    });

    it('ADMIN sees all 3 comments, INTERNAL included, ordered createdAt ASC', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as CommentListResponseBody;
      expect(body.meta.total).toBe(3);
      expect(body.data.map((c) => c.id)).toEqual([
        publicComment1Id,
        internalCommentId,
        publicComment2Id,
      ]);
      const timestamps = body.data.map((c) => Date.parse(c.createdAt));
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    });

    it('the assigned TECHNICIAN also sees all 3 comments, INTERNAL included', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${assignedTechTokens.accessToken}`)
        .expect(200);

      const body = res.body as CommentListResponseBody;
      expect(body.meta.total).toBe(3);
      expect(body.data.map((c) => c.id)).toContain(internalCommentId);
    });

    it('paginates with ?page=1&limit=1: exactly one item, ordered ASC (the first PUBLIC comment) for the owner', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/comments`)
        .query({ page: 1, limit: 1 })
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(200);

      const body = res.body as CommentListResponseBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(publicComment1Id);
      expect(body.meta.total).toBe(2);
      expect(body.meta.totalPages).toBe(2);
    });
  });
});
