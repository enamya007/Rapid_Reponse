import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Category } from '../src/modules/categories/entities/category.entity';
import { Ticket } from '../src/modules/tickets/entities/ticket.entity';
import { TicketStatus } from '../src/modules/tickets/enums/ticket-status.enum';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { UsersService } from '../src/modules/users/users.service';

interface UserSummaryBody {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}

interface TicketResponseBody {
  id: string;
  reference: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: { id: string; name: string };
  createdBy: UserSummaryBody;
  assignee: UserSummaryBody | null;
  siteLabel: string | null;
  siteAddress: string | null;
  slaDueAt: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string };
}

interface TicketListItemBody {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  category: { id: string; name: string };
  assignee: { id: string; username: string } | null;
  slaDueAt: string | null;
  createdAt: string;
}

interface PaginationMetaBody {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface TicketListResponseBody {
  data: TicketListItemBody[];
  meta: PaginationMetaBody;
}

interface CountRow {
  count: number;
}

// Deliberately does NOT start with `e2e_`: `auth.e2e-spec.ts` wipes every user matching
// `username LIKE 'e2e_%'` in both its `beforeAll` and `afterAll` (see `cleanupE2eUsers`
// there). Since Jest may run e2e spec files as separate, concurrent workers against the
// same real database, a shared `e2e_` prefix would let that file's cleanup delete rows this
// suite is still using mid-run. `tickets_e2e_` is unaffected by that wildcard while staying
// just as easily recognisable as throwaway test data.
const ALICE = {
  username: 'tickets_e2e_alice',
  email: 'tickets_e2e_alice@test.local',
  password: 'TicketsE2eAlice123',
};
const BOB = {
  username: 'tickets_e2e_bob',
  email: 'tickets_e2e_bob@test.local',
  password: 'TicketsE2eBob123',
};
// `RegisterDto` deliberately has no `role` field (self-registration is always CLIENT) and P4
// ships no ASSIGN endpoint yet (-> P5): a TECHNICIAN fixture for the transition tests below is
// created directly through `UsersService` (see the suite's own `beforeAll`), not through
// `/api/auth/register`, but still authenticated through the real `/api/auth/login` afterwards.
const TECHNICIAN = {
  username: 'tickets_e2e_tech',
  email: 'tickets_e2e_tech@test.local',
  password: 'TicketsE2eTech123',
};

function assertNoPasswordLeak(body: unknown): void {
  expect(JSON.stringify(body).toLowerCase()).not.toMatch(/"password/);
}

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

describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let aliceTokens: AuthResponseBody;
  let bobTokens: AuthResponseBody;
  let technicianTokens: AuthResponseBody;
  let technicianId: string;
  let categoryId: string;
  // Only set (and only cleaned up) if no active category already existed to reuse — this
  // suite never deletes pre-existing reference data (e.g. the seeded categories), only what
  // it created itself.
  let createdFallbackCategoryId: string | null = null;

  beforeAll(async () => {
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
    await dataSource.query(
      `DELETE FROM tickets WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      ['tickets_e2e_%'],
    );
    await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
      'tickets_e2e_%',
    ]);

    // Reuse an existing active category (e.g. one of the 5 seeded by `pnpm seed`) rather than
    // require it; fall back to creating a minimal one directly through the repository only
    // if none exists yet, so this suite never depends on the dev/CI environment having run
    // the seed script.
    const categoryRepository = dataSource.getRepository(Category);
    const existingCategory = await categoryRepository.findOne({
      where: { isActive: true },
    });
    if (existingCategory) {
      categoryId = existingCategory.id;
    } else {
      const created = await categoryRepository.save(
        categoryRepository.create({
          name: 'Tickets E2E Fallback Category',
          isActive: true,
        }),
      );
      categoryId = created.id;
      createdFallbackCategoryId = created.id;
    }

    aliceTokens = await registerClient(app, ALICE);
    bobTokens = await registerClient(app, BOB);

    // No self-service way to become a TECHNICIAN (`RegisterDto` has no `role` field, see its
    // own doc comment) and no `ASSIGN` endpoint exists yet (-> P5): the technician fixture is
    // created directly through `UsersService` (mirrors `AuthService.register`'s own call, just
    // with `role: TECHNICIAN`), then authenticated through the REAL `/api/auth/login` so every
    // transition test exercises the genuine JWT/guard path, not a hand-crafted token. Created
    // here, alongside Alice/Bob, rather than lazily inside the transitions `describe` block
    // below: keeping every `tickets_e2e_*` fixture's creation inside this single `beforeAll`
    // keeps the window during which `auth.e2e-spec.ts`'s own cross-suite user-count snapshot
    // (`nonE2eUserCountBeforeSuite`, unaffected by the `tickets_e2e_` prefix) could observe a
    // half-finished state as short as Alice/Bob's already were, instead of stretching it across
    // this whole file's runtime.
    const usersService = app.get(UsersService);
    const passwordHash = await argon2.hash(TECHNICIAN.password);
    const technician = await usersService.create({
      username: TECHNICIAN.username,
      email: TECHNICIAN.email,
      passwordHash,
      role: UserRole.TECHNICIAN,
    });
    technicianId = technician.id;
    const technicianLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        identifier: TECHNICIAN.username,
        password: TECHNICIAN.password,
      })
      .expect(200);
    technicianTokens = technicianLoginRes.body as AuthResponseBody;
  });

  afterAll(async () => {
    await dataSource.query(
      `DELETE FROM tickets WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      ['tickets_e2e_%'],
    );
    await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
      'tickets_e2e_%',
    ]);
    if (createdFallbackCategoryId) {
      await dataSource.query('DELETE FROM categories WHERE id = $1', [
        createdFallbackCategoryId,
      ]);
    }
    await app.close();
  });

  describe('POST /api/tickets', () => {
    it('rejects ticket creation without an access token', async () => {
      await request(app.getHttpServer())
        .post('/api/tickets')
        .send({
          title: 'Sans authentification',
          description: 'Doit être rejeté avant toute logique métier.',
          categoryId,
        })
        .expect(401);
    });

    it('creates a ticket for the authenticated CLIENT, defaulting status to OPEN and stamping the reference/creator', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({
          title: 'Climatisation en panne',
          description: 'La clim ne démarre plus depuis ce matin.',
          categoryId,
        })
        .expect(201);

      const body = res.body as TicketResponseBody;
      expect(body.id).toEqual(expect.any(String));
      // Generated exclusively by the `tickets_reference_seq` Postgres sequence.
      expect(body.reference).toMatch(/^TCK-\d{6}$/);
      expect(body.status).toBe('OPEN');
      expect(body.priority).toBe('NORMAL');
      expect(body.category.id).toBe(categoryId);
      expect(body.createdBy.username).toBe(ALICE.username);
      expect(body.assignee).toBeNull();
      assertNoPasswordLeak(res.body);
    });
  });

  describe('GET /api/tickets/:id — OwnershipGuard', () => {
    let aliceTicketId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({
          title: "Fuite d'eau au 3ème étage",
          description: "Fuite active depuis l'accès mural.",
          categoryId,
        })
        .expect(201);
      aliceTicketId = (res.body as TicketResponseBody).id;
    });

    it('returns the ticket, shaped as TicketResponseDto and without a password field, to its own creator (owner)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${aliceTicketId}`)
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketResponseBody;
      expect(body.id).toBe(aliceTicketId);
      expect(body.createdBy.username).toBe(ALICE.username);
      expect(body.category.id).toBe(categoryId);
      expect(typeof body.category.name).toBe('string');
      assertNoPasswordLeak(res.body);
    });

    it("rejects another CLIENT (neither owner nor assignee) reading Alice's ticket with 403", async () => {
      await request(app.getHttpServer())
        .get(`/api/tickets/${aliceTicketId}`)
        .set('Authorization', `Bearer ${bobTokens.accessToken}`)
        .expect(403);
    });

    it('returns 404 for a well-formed but non-existent ticket id', async () => {
      await request(app.getHttpServer())
        .get('/api/tickets/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(404);
    });

    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .get(`/api/tickets/${aliceTicketId}`)
        .expect(401);
    });
  });

  describe('GET /api/tickets — pagination, filters and role scoping', () => {
    let aliceListTicket1Id: string;
    let aliceListTicket2Id: string;
    let bobListTicketId: string;

    // Ground truth for `meta.total` assertions, computed directly from the DB rather than
    // hardcoded: earlier `describe` blocks in this same suite already created tickets for
    // Alice (e.g. under `POST /api/tickets` and `GET /api/tickets/:id`), so "Alice's total"
    // is "however many tickets she owns by this point", not just the 2 created below.
    async function countTicketsCreatedBy(userId: string): Promise<number> {
      const rows = await dataSource.query<CountRow[]>(
        'SELECT COUNT(*)::int AS count FROM tickets WHERE created_by_id = $1',
        [userId],
      );
      return rows[0].count;
    }

    beforeAll(async () => {
      const res1 = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({
          title: 'Alice — ticket de liste 1',
          description: 'Premier ticket créé pour couvrir GET /tickets.',
          categoryId,
        })
        .expect(201);
      aliceListTicket1Id = (res1.body as TicketResponseBody).id;

      const res2 = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({
          title: 'Alice — ticket de liste 2',
          description: 'Deuxième ticket créé pour couvrir GET /tickets.',
          categoryId,
        })
        .expect(201);
      aliceListTicket2Id = (res2.body as TicketResponseBody).id;

      const resBob = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${bobTokens.accessToken}`)
        .send({
          title: 'Bob — ticket de liste',
          description:
            "Ticket de Bob : ne doit jamais apparaître dans la liste d'Alice.",
          categoryId,
        })
        .expect(201);
      bobListTicketId = (resBob.body as TicketResponseBody).id;
    });

    it("scopes the CLIENT's list to only their own tickets (never another client's), with a meta.total matching the DB", async () => {
      const expectedTotal = await countTicketsCreatedBy(aliceTokens.user.id);

      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketListResponseBody;
      expect(body.meta.total).toBe(expectedTotal);
      const ids = body.data.map((ticket) => ticket.id);
      expect(ids).toEqual(
        expect.arrayContaining([aliceListTicket1Id, aliceListTicket2Id]),
      );
      expect(ids).not.toContain(bobListTicketId);
    });

    it("does not let a CLIENT widen their own scope via assigneeId/createdById query params (Bob's ticket never leaks into Alice's list)", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ createdById: bobTokens.user.id, limit: 100 })
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketListResponseBody;
      const ids = body.data.map((ticket) => ticket.id);
      expect(ids).not.toContain(bobListTicketId);
      expect(ids).toEqual(
        expect.arrayContaining([aliceListTicket1Id, aliceListTicket2Id]),
      );
    });

    it('paginates with ?page=1&limit=1: exactly one item and a totalPages consistent with the DB total', async () => {
      const expectedTotal = await countTicketsCreatedBy(aliceTokens.user.id);

      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ page: 1, limit: 1 })
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketListResponseBody;
      expect(body.data).toHaveLength(1);
      expect(body.meta.total).toBe(expectedTotal);
      expect(body.meta.totalPages).toBe(expectedTotal);
    });

    it("filters by ?status=OPEN (all of Alice's tickets are OPEN at this stage) and excludes them under ?status=CLOSED, proving the filter genuinely discriminates", async () => {
      const resOpen = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ status: 'OPEN', limit: 100 })
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);
      const bodyOpen = resOpen.body as TicketListResponseBody;
      expect(bodyOpen.data.length).toBeGreaterThan(0);
      for (const ticket of bodyOpen.data) {
        expect(ticket.status).toBe('OPEN');
      }

      const resClosed = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ status: 'CLOSED', limit: 100 })
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);
      const bodyClosed = resClosed.body as TicketListResponseBody;
      expect(bodyClosed.data).toHaveLength(0);
    });

    it('shapes items as TicketListItemDto, without a password field', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketListResponseBody;
      const ticket = body.data.find((t) => t.id === aliceListTicket1Id);
      expect(ticket).toBeDefined();
      expect(ticket?.category.id).toBe(categoryId);
      expect(ticket?.assignee).toBeNull();
      assertNoPasswordLeak(res.body);
    });

    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer()).get('/api/tickets').expect(401);
    });
  });

  // Regression coverage for the ILIKE metacharacter-escaping bug: `%`/`_` typed by a caller in
  // `?q=` must be matched as LITERAL text, never interpreted as a wildcard. A unit test on the
  // string handed to the query builder (see `tickets.service.spec.ts`) cannot prove Postgres
  // actually honors the escaping — only a real query against the real database can.
  describe('GET /api/tickets — free-text search (q) escapes ILIKE metacharacters', () => {
    let percentTicketId: string;
    let hundredWithoutPercentTicketId: string;

    beforeAll(async () => {
      const percentRes = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({
          title: 'Disponibilité 100% garantie',
          description:
            'Ticket dont le titre contient un "%" littéral, pour prouver que q échappe les métacaractères ILIKE au lieu de les traiter comme des jokers.',
          categoryId,
        })
        .expect(201);
      percentTicketId = (percentRes.body as TicketResponseBody).id;

      // Deliberately ALSO contains the substring "100" (just without a following "%"): if `q`'s
      // "%" were NOT escaped, the pattern `%100%%` collapses (two adjacent `%` wildcards behave
      // as one) to effectively "contains 100" — which this ticket's title WOULD satisfy, even
      // though it never contains a literal "%". A fixture without "100" at all (e.g. an
      // unrelated title) would pass this assertion even with the bug reintroduced, so it would
      // not actually prove anything.
      const hundredWithoutPercentRes = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({
          title: 'Disponibilité de 100 techniciens garantie',
          description:
            'Ticket dont le titre contient "100" mais jamais "100%" littéralement : ne doit jamais remonter pour une recherche "100%" si % est bien échappé.',
          categoryId,
        })
        .expect(201);
      hundredWithoutPercentTicketId = (
        hundredWithoutPercentRes.body as TicketResponseBody
      ).id;
    });

    it('a literal "%" in q matches only the ticket whose title actually contains "100%", not merely "100" (proving % is escaped, not treated as an ILIKE wildcard)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ q: '100%', limit: 100 })
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketListResponseBody;
      const ids = body.data.map((ticket) => ticket.id);
      expect(ids).toContain(percentTicketId);
      expect(ids).not.toContain(hundredWithoutPercentTicketId);
    });

    it('a normal substring search without metacharacters still matches case-insensitively, on both fixtures (non-regression: escaping must not break ordinary search)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ q: 'disponibilité', limit: 100 })
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketListResponseBody;
      const ids = body.data.map((ticket) => ticket.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          percentTicketId,
          hundredWithoutPercentTicketId,
        ]),
      );
    });
  });

  // Covers the TECHNICIAN role-based scope of `GET /tickets` (`TicketsService.list`) end to
  // end, against the real database: unit tests already cover the same rule against a mocked
  // query builder (`tickets.service.spec.ts`), but that cannot prove the assembled query
  // actually returns the right rows, nor that `meta.total` reflects the scoped count.
  describe('GET /api/tickets — TECHNICIAN scoping', () => {
    let ticketRepository: Repository<Ticket>;
    let otherTechnicianId: string;
    let assignedToMeTicketId: string;
    let assignedToOtherTicketId: string;
    let unassignedTicketId: string;

    async function createTicket(
      tokens: AuthResponseBody,
      title: string,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title,
          description:
            'Ticket créé pour couvrir le scoping TECHNICIAN de GET /tickets (e2e).',
          categoryId,
        })
        .expect(201);
      return (res.body as TicketResponseBody).id;
    }

    beforeAll(async () => {
      ticketRepository = dataSource.getRepository(Ticket);

      // A second TECHNICIAN fixture, created the exact same way the outer `beforeAll` creates
      // `technicianTokens`/`technicianId` (no self-service way to become a TECHNICIAN, and no
      // login is needed for this one — it only ever plays the "someone else's assignee" role
      // below). Matches the `tickets_e2e_` prefix, so the suite's own `afterAll` cleans it up.
      const usersService = app.get(UsersService);
      const otherTechnician = await usersService.create({
        username: 'tickets_e2e_tech2',
        email: 'tickets_e2e_tech2@test.local',
        passwordHash: await argon2.hash('TicketsE2eTech2123'),
        role: UserRole.TECHNICIAN,
      });
      otherTechnicianId = otherTechnician.id;

      assignedToMeTicketId = await createTicket(
        aliceTokens,
        'Technicien — assigné au technicien principal',
      );
      // No `ASSIGN` endpoint is needed here beyond what's already established elsewhere in this
      // suite (e.g. the T4.4 transitions block above): forcing the ASSIGNED fixture directly
      // through the repository is the same simplest/most readable pattern already used there.
      await ticketRepository.update(assignedToMeTicketId, {
        status: TicketStatus.ASSIGNED,
        assigneeId: technicianId,
      });

      assignedToOtherTicketId = await createTicket(
        bobTokens,
        'Technicien — assigné à un autre technicien',
      );
      await ticketRepository.update(assignedToOtherTicketId, {
        status: TicketStatus.ASSIGNED,
        assigneeId: otherTechnicianId,
      });

      unassignedTicketId = await createTicket(
        aliceTokens,
        'Technicien — jamais assigné',
      );
    });

    it("scopes the list to only tickets assigned to the calling TECHNICIAN — excluding another technician's ticket and unassigned tickets", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketListResponseBody;
      const ids = body.data.map((ticket) => ticket.id);
      expect(ids).toContain(assignedToMeTicketId);
      expect(ids).not.toContain(assignedToOtherTicketId);
      expect(ids).not.toContain(unassignedTicketId);
    });

    it('does not let a TECHNICIAN widen their scope via ?createdById= or ?assigneeId= (both are honored for ADMIN callers only)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({
          createdById: bobTokens.user.id,
          assigneeId: otherTechnicianId,
          limit: 100,
        })
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketListResponseBody;
      const ids = body.data.map((ticket) => ticket.id);
      expect(ids).not.toContain(assignedToOtherTicketId);
      expect(ids).toContain(assignedToMeTicketId);
    });

    it('meta.total reflects only the tickets scoped to the calling TECHNICIAN, not the global total', async () => {
      const expectedTotal = await ticketRepository.count({
        where: { assigneeId: technicianId },
      });
      const globalTotal = await ticketRepository.count();
      // Sanity check: this assertion is only meaningful if scoping actually narrows the result
      // below the DB-wide total (otherwise a bug that returns everything would go unnoticed).
      expect(expectedTotal).toBeLessThan(globalTotal);

      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketListResponseBody;
      expect(body.meta.total).toBe(expectedTotal);
    });
  });

  describe('PATCH /api/tickets/:id and DELETE /api/tickets/:id — update rules & soft delete', () => {
    let adminTokens: AuthResponseBody;
    let ticketRepository: Repository<Ticket>;

    beforeAll(async () => {
      // The seeded ADMIN account (created by `pnpm seed`, see `src/database/seeds/seed.ts`),
      // never through registration: there is no self-service way to become an ADMIN, and this
      // suite must not create one directly through the repository either — logging in as the
      // real seeded account exercises the exact same path production traffic would.
      const adminUsername = process.env.SEED_ADMIN_USERNAME;
      const adminPassword = process.env.SEED_ADMIN_PASSWORD;
      if (!adminUsername || !adminPassword) {
        throw new Error(
          'SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD must be set (see .env) to run the ADMIN-path e2e tests; run `pnpm seed` against the test database first.',
        );
      }

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: adminUsername, password: adminPassword })
        .expect(200);
      adminTokens = res.body as AuthResponseBody;

      ticketRepository = dataSource.getRepository(Ticket);
    });

    async function createAliceTicket(title: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({
          title,
          description: 'Ticket créé pour couvrir PATCH/DELETE /tickets/:id.',
          categoryId,
        })
        .expect(201);
      return (res.body as TicketResponseBody).id;
    }

    it('allows Alice to PATCH her own OPEN ticket (e.g. title), returning the updated field', async () => {
      const ticketId = await createAliceTicket('Titre original');

      const res = await request(app.getHttpServer())
        .patch(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({ title: 'Titre modifié par Alice' })
        .expect(200);

      const body = res.body as TicketResponseBody;
      expect(body.id).toBe(ticketId);
      expect(body.title).toBe('Titre modifié par Alice');
    });

    it("rejects Bob (neither owner nor assignee) PATCHing Alice's ticket with 403 (OwnershipGuard)", async () => {
      const ticketId = await createAliceTicket(
        "Ticket d'Alice, intouchable par Bob",
      );

      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${bobTokens.accessToken}`)
        .send({ title: 'Bob essaie de modifier' })
        .expect(403);
    });

    it('rejects Alice PATCHing her own ticket once it is no longer OPEN (e.g. ASSIGNED), even though she is the owner', async () => {
      const ticketId = await createAliceTicket('Ticket qui va être assigné');
      // No transition endpoint exists yet (T4.4): force the status directly through the
      // repository to set up the fixture, exactly as instructed by the brief.
      await ticketRepository.update(ticketId, {
        status: TicketStatus.ASSIGNED,
      });

      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({ title: 'Alice tente de modifier après affectation' })
        .expect(403);
    });

    it('allows an ADMIN to PATCH any ticket, regardless of owner or status', async () => {
      const ticketId = await createAliceTicket(
        'Ticket modifiable par un admin',
      );
      await ticketRepository.update(ticketId, {
        status: TicketStatus.ASSIGNED,
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ title: 'Titre modifié par un admin' })
        .expect(200);

      expect((res.body as TicketResponseBody).title).toBe(
        'Titre modifié par un admin',
      );
    });

    it('rejects a CLIENT (even the owner) attempting to DELETE a ticket with 403', async () => {
      const ticketId = await createAliceTicket(
        'Ticket qu Alice ne peut pas supprimer elle-même',
      );

      await request(app.getHttpServer())
        .delete(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(403);
    });

    it('lets an ADMIN soft delete a ticket: 204, then the ticket is excluded from reads with 404', async () => {
      const ticketId = await createAliceTicket(
        'Ticket destiné à être supprimé par un admin',
      );

      await request(app.getHttpServer())
        .delete(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(204);

      // Soft delete, not a hard delete: the row still exists in the database, only excluded
      // from reads (TypeORM's default `deleted_at IS NULL` behaviour).
      const raw = await ticketRepository.findOne({
        where: { id: ticketId },
        withDeleted: true,
      });
      expect(raw).not.toBeNull();
      expect(raw?.deletedAt).not.toBeNull();

      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(404);
    });
  });

  describe('POST /api/tickets/:id/{start,resolve,reopen,close,cancel} — status transitions (T4.4)', () => {
    let ticketRepository: Repository<Ticket>;

    interface TicketStatusHistoryRow {
      from_status: string | null;
      to_status: string;
      changed_by_id: string | null;
      note: string | null;
    }

    async function fetchHistory(
      ticketId: string,
    ): Promise<TicketStatusHistoryRow[]> {
      return dataSource.query<TicketStatusHistoryRow[]>(
        'SELECT from_status, to_status, changed_by_id, note FROM ticket_status_history WHERE ticket_id = $1 ORDER BY created_at ASC',
        [ticketId],
      );
    }

    async function createAliceTicket(title: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({
          title,
          description:
            'Ticket créé pour couvrir les transitions de statut (T4.4).',
          categoryId,
        })
        .expect(201);
      return (res.body as TicketResponseBody).id;
    }

    beforeAll(() => {
      // Alice/Bob/the technician (`technicianTokens`/`technicianId`) are all created once, in
      // the outer `describe`'s own `beforeAll`, alongside each other — see the comment there.
      ticketRepository = dataSource.getRepository(Ticket);
    });

    it('lets the owner CANCEL their own OPEN ticket: 200, status/cancelledAt updated, and a matching ticket_status_history row is written', async () => {
      const ticketId = await createAliceTicket(
        'Ticket annulé par sa propriétaire',
      );

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/cancel`)
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({})
        .expect(200);

      const body = res.body as TicketResponseBody;
      expect(body.status).toBe('CANCELLED');
      expect(body.cancelledAt).not.toBeNull();

      const history = await fetchHistory(ticketId);
      expect(history).toContainEqual(
        expect.objectContaining({
          from_status: 'OPEN',
          to_status: 'CANCELLED',
          changed_by_id: aliceTokens.user.id,
        }),
      );
    });

    it('rejects START on an OPEN ticket with 409 (INVALID_TRANSITION — START is not a defined event from OPEN)', async () => {
      const ticketId = await createAliceTicket('Ticket jamais assigné');

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/start`)
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(409);
    });

    it('rejects the owner CLIENT starting a ticket assigned to someone else with 403 (GUARD_FAILED), then lets the assigned technician start it with 200', async () => {
      const ticketId = await createAliceTicket(
        'Ticket assigné à un technicien',
      );
      // No `ASSIGN` endpoint exists yet (-> P5): force the `ASSIGNED` fixture directly through
      // the repository, exactly as instructed by the brief (same pattern already used by the
      // PATCH/DELETE suite above).
      await ticketRepository.update(ticketId, {
        status: TicketStatus.ASSIGNED,
        assigneeId: technicianId,
      });

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/start`)
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(403);

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/start`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(200);

      const body = res.body as TicketResponseBody;
      expect(body.status).toBe('IN_PROGRESS');
      expect(body.startedAt).not.toBeNull();
    });

    it("rejects Bob (neither owner nor assignee) cancelling Alice's ticket with 403 (OwnershipGuard, before the transition is even evaluated)", async () => {
      const ticketId = await createAliceTicket(
        "Ticket d'Alice, intouchable par Bob",
      );

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/cancel`)
        .set('Authorization', `Bearer ${bobTokens.accessToken}`)
        .send({})
        .expect(403);
    });

    it('drives a ticket through its full lifecycle (ASSIGNED fixture -> START -> RESOLVE -> REOPEN -> RESOLVE -> CLOSE), checking status/timestamps/resolutionNote and one ticket_status_history row per API-driven transition', async () => {
      const ticketId = await createAliceTicket(
        'Ticket suivi sur tout son cycle de vie',
      );
      await ticketRepository.update(ticketId, {
        status: TicketStatus.ASSIGNED,
        assigneeId: technicianId,
      });

      const started = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/start`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(200);
      expect((started.body as TicketResponseBody).status).toBe('IN_PROGRESS');

      const resolutionNote =
        'Climatiseur remis en service après remplacement du condensateur.';
      const resolved = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({ resolutionNote })
        .expect(200);
      const resolvedBody = resolved.body as TicketResponseBody;
      expect(resolvedBody.status).toBe('RESOLVED');
      expect(resolvedBody.resolvedAt).not.toBeNull();
      expect(resolvedBody.resolutionNote).toBe(resolutionNote);

      const reopenReason =
        'Le problème persiste, la climatisation ne fonctionne toujours pas.';
      const reopened = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/reopen`)
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .send({ reason: reopenReason })
        .expect(200);
      const reopenedBody = reopened.body as TicketResponseBody;
      expect(reopenedBody.status).toBe('IN_PROGRESS');
      expect(reopenedBody.resolvedAt).toBeNull();
      expect(reopenedBody.resolutionNote).toBeNull();

      // Back to RESOLVED so the owner can CLOSE it.
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({ resolutionNote: 'Résolu une seconde fois.' })
        .expect(200);

      const closed = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/close`)
        .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
        .expect(200);
      const closedBody = closed.body as TicketResponseBody;
      expect(closedBody.status).toBe('CLOSED');
      expect(closedBody.closedAt).not.toBeNull();

      const history = await fetchHistory(ticketId);
      // The ASSIGNED fixture above bypassed the API (forced via the repository): no history row
      // is expected for it. One row per API-driven transition below: START, RESOLVE, REOPEN,
      // RESOLVE (again), CLOSE.
      expect(history.map((row) => row.to_status)).toEqual([
        'IN_PROGRESS',
        'RESOLVED',
        'IN_PROGRESS',
        'RESOLVED',
        'CLOSED',
      ]);
      expect(history[2].note).toBe(reopenReason);
    });
  });
});
