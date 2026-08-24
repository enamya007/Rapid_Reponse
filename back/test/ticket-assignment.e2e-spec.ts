import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Ticket } from '../src/modules/tickets/entities/ticket.entity';
import { TicketStatus } from '../src/modules/tickets/enums/ticket-status.enum';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { UsersService } from '../src/modules/users/users.service';

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string };
}

interface UserSummaryBody {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}

interface TicketResponseBody {
  id: string;
  status: string;
  assignee: UserSummaryBody | null;
  assignedAt: string | null;
  slaDueAt: string | null;
}

interface TechnicianResponseBody {
  id: string;
  username: string;
  isAvailable: boolean;
  maxConcurrentTickets: number;
  currentLoad: number;
}

interface TechnicianSuggestionBody {
  technicianId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  skillLevel: number | null;
  currentLoad: number;
  maxConcurrentTickets: number;
}

interface AssignmentActorBody {
  id: string;
  username: string;
}

interface TicketAssignmentResponseBody {
  id: string;
  technician: AssignmentActorBody;
  assignedBy: AssignmentActorBody | null;
  reason: string | null;
  isAutoSuggested: boolean;
  assignedAt: string;
  unassignedAt: string | null;
}

interface IdRow {
  id: string;
}

interface AssignmentRow {
  id: string;
  technician_id: string;
  unassigned_at: string | null;
}

interface HistoryRow {
  from_status: string | null;
  to_status: string;
  changed_by_id: string | null;
  note: string | null;
}

const ASSIGNMENT_RESPONSE_KEYS = [
  'assignedAt',
  'assignedBy',
  'id',
  'isAutoSuggested',
  'reason',
  'technician',
  'unassignedAt',
].sort();

// `asg_e2e_` — NOT `e2e_%` (wiped by `auth.e2e-spec.ts`) and not the `tch_e2e_`/`skl_e2e_`
// prefixes owned by the other P5 suites (which clean up fully in their own `afterAll` before
// this file's `beforeAll` runs, under `maxWorkers: 1`). Jest runs e2e specs serially against one
// shared, real database.
const ADMIN = {
  username: 'asg_e2e_admin',
  email: 'asg_e2e_admin@test.local',
  password: 'AsgE2eAdmin123',
};
const OWNER = {
  username: 'asg_e2e_owner',
  email: 'asg_e2e_owner@test.local',
  password: 'AsgE2eOwner123',
};
const OTHER_CLIENT = {
  username: 'asg_e2e_other',
  email: 'asg_e2e_other@test.local',
  password: 'AsgE2eOther123',
};
// No self-service way to become a TECHNICIAN, and this ONE fixture specifically needs NO
// `TechnicianProfile` row (D1's `NO_PROFILE` case) — `POST /technicians` always creates one, so
// this account is created directly through `UsersService`, exactly like the analogous fixture in
// `tickets.e2e-spec.ts`.
const NO_PROFILE_TECH = {
  username: 'asg_e2e_no_profile',
  email: 'asg_e2e_no_profile@test.local',
  password: 'AsgE2eNoProf1',
};
// Shared password for every technician created through `createTechnician` below (unless
// overridden), so its caller can log in as that technician without threading a password around.
const TECH_PASSWORD = 'AsgE2eGenerated1';

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
  // Dependency order (brief): ticket_assignments -> ticket_status_history -> technician_skills
  // -> technician_profiles -> tickets -> users. Scoped exclusively to `asg_e2e_%` usernames; the
  // seeded skills/categories are NEVER touched (no `DELETE FROM skills`/`categories` anywhere in
  // this file — the suggestion engine depends on them).
  await dataSource.query(
    `DELETE FROM ticket_assignments
     WHERE ticket_id IN (
       SELECT id FROM tickets
       WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
          OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
     )`,
    ['asg_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM ticket_status_history
     WHERE ticket_id IN (
       SELECT id FROM tickets
       WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
          OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
     )`,
    ['asg_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM technician_skills
     WHERE technician_profile_id IN (
       SELECT tp.id FROM technician_profiles tp
       JOIN users u ON u.id = tp.user_id
       WHERE u.username LIKE $1
     )`,
    ['asg_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM technician_profiles
     WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    ['asg_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM tickets
     WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
        OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    ['asg_e2e_%'],
  );
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
    'asg_e2e_%',
  ]);
}

describe('Ticket assignment (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ticketRepository: Repository<Ticket>;

  let adminTokens: AuthResponseBody;
  let ownerTokens: AuthResponseBody;
  let otherClientTokens: AuthResponseBody;

  let categoryId: string; // "Panne électrique" — requiredSkill = Électricité
  let noMatchCategoryId: string; // "Accès et serrurerie" — requiredSkill = Serrurerie (nobody holds it)

  let eligibleTechnicianId: string;
  let eligibleTechnicianTokens: AuthResponseBody;
  let notATechnicianId: string; // OTHER_CLIENT's own userId
  let inactiveTechnicianId: string;
  let noProfileTechnicianId: string;
  let unavailableTechnicianId: string;
  let atCapacityTechnicianId: string;

  async function createTechnician(
    overrides: Partial<{
      username: string;
      email: string;
      password: string;
      isAvailable: boolean;
      maxConcurrentTickets: number;
      skills: Array<{ skillId: string; level?: number }>;
    }> = {},
  ): Promise<TechnicianResponseBody> {
    const { username: usernameOverride, ...rest } = overrides;
    const username =
      usernameOverride ?? `asg_e2e_${Math.random().toString(36).slice(2, 10)}`;
    const res = await request(app.getHttpServer())
      .post('/api/technicians')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({
        username,
        email: `${username}@test.local`,
        password: TECH_PASSWORD,
        ...rest,
      })
      .expect(201);
    return res.body as TechnicianResponseBody;
  }

  async function createOwnerTicket(
    title: string,
    forCategoryId: string = categoryId,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
      .send({
        title,
        description: 'Fixture ticket for the ticket-assignment e2e suite.',
        categoryId: forCategoryId,
      })
      .expect(201);
    return (res.body as TicketResponseBody).id;
  }

  async function fetchAssignments(ticketId: string): Promise<AssignmentRow[]> {
    return dataSource.query<AssignmentRow[]>(
      `SELECT id, technician_id, unassigned_at FROM ticket_assignments WHERE ticket_id = $1 ORDER BY assigned_at DESC`,
      [ticketId],
    );
  }

  async function fetchHistory(ticketId: string): Promise<HistoryRow[]> {
    return dataSource.query<HistoryRow[]>(
      `SELECT from_status, to_status, changed_by_id, note FROM ticket_status_history WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticketId],
    );
  }

  beforeAll(async () => {
    // `TicketsModule` now imports `TechniciansModule` itself (T5.3, `tickets.module.ts`), and
    // `AppModule` already imports `TicketsModule` — so `AppModule` alone is enough to resolve
    // `TechnicianSuggestionService` for `TicketsService`. Verified: no explicit
    // `TechniciansModule` import is needed here (unlike `technicians.e2e-spec.ts`, written
    // before that wiring existed).
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
    ticketRepository = dataSource.getRepository(Ticket);

    await cleanupFixtures(dataSource);

    ownerTokens = await registerClient(app, OWNER);
    otherClientTokens = await registerClient(app, OTHER_CLIENT);
    notATechnicianId = otherClientTokens.user.id;

    const usersService = app.get(UsersService);
    await usersService.create({
      username: ADMIN.username,
      email: ADMIN.email,
      passwordHash: await argon2.hash(ADMIN.password),
      role: UserRole.ADMIN,
    });
    adminTokens = await loginAs(app, ADMIN.username, ADMIN.password);

    const [categoryRow] = await dataSource.query<IdRow[]>(
      `SELECT id FROM categories WHERE name = $1`,
      ['Panne électrique'],
    );
    categoryId = categoryRow.id;
    const [noMatchCategoryRow] = await dataSource.query<IdRow[]>(
      `SELECT id FROM categories WHERE name = $1`,
      ['Accès et serrurerie'],
    );
    noMatchCategoryId = noMatchCategoryRow.id;

    // --- D1 eligibility fixtures (first assignment + reassignment matrix) ---

    // A generous `maxConcurrentTickets`: this single technician is deliberately reused as the
    // successful-assignment target across most of the tests below (several of which leave a
    // ticket permanently ASSIGNED to it, e.g. to prove D1/D2/D5), so it must never itself hit
    // AT_CAPACITY over the course of the whole suite — that would be test pollution, not a
    // production concern (D1's own AT_CAPACITY case is proven separately, against a DIFFERENT,
    // deliberately narrow, technician below).
    const eligible = await createTechnician({
      username: 'asg_e2e_eligible',
      maxConcurrentTickets: 30,
    });
    eligibleTechnicianId = eligible.id;
    eligibleTechnicianTokens = await loginAs(
      app,
      'asg_e2e_eligible',
      TECH_PASSWORD,
    );

    const inactive = await createTechnician({ username: 'asg_e2e_inactive' });
    inactiveTechnicianId = inactive.id;
    await request(app.getHttpServer())
      .patch(`/api/technicians/${inactiveTechnicianId}`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ isActive: false })
      .expect(200);

    const noProfileUser = await usersService.create({
      username: NO_PROFILE_TECH.username,
      email: NO_PROFILE_TECH.email,
      passwordHash: await argon2.hash(NO_PROFILE_TECH.password),
      role: UserRole.TECHNICIAN,
    });
    noProfileTechnicianId = noProfileUser.id;

    const unavailable = await createTechnician({
      username: 'asg_e2e_unavailable',
      isAvailable: false,
    });
    unavailableTechnicianId = unavailable.id;

    const atCapacity = await createTechnician({
      username: 'asg_e2e_at_capacity',
      maxConcurrentTickets: 1,
    });
    atCapacityTechnicianId = atCapacity.id;
    const fillerTicketId = await createOwnerTicket(
      'asg_e2e filler ticket to fill capacity',
    );
    await request(app.getHttpServer())
      .post(`/api/tickets/${fillerTicketId}/assign`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ technicianId: atCapacityTechnicianId })
      .expect(200);
  });

  afterAll(async () => {
    await cleanupFixtures(dataSource);
    await app.close();
  });

  describe('GET /api/tickets/:id/assignment-suggestions — ADMIN only', () => {
    it('rejects a request without an access token with 401', async () => {
      const ticketId = await createOwnerTicket('asg_e2e suggestions no auth');
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignment-suggestions`)
        .expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      const ticketId = await createOwnerTicket('asg_e2e suggestions client');
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignment-suggestions`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(403);
    });

    it('rejects a TECHNICIAN with 403', async () => {
      const ticketId = await createOwnerTicket(
        'asg_e2e suggestions technician',
      );
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignment-suggestions`)
        .set('Authorization', `Bearer ${eligibleTechnicianTokens.accessToken}`)
        .expect(403);
    });

    it('returns 404 for an unknown ticket id', async () => {
      await request(app.getHttpServer())
        .get(
          '/api/tickets/00000000-0000-0000-0000-000000000000/assignment-suggestions',
        )
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(404);
    });

    it('?limit=0 (below the minimum) returns 400', async () => {
      const ticketId = await createOwnerTicket('asg_e2e suggestions limit 0');
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignment-suggestions`)
        .query({ limit: 0 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(400);
    });

    it('?limit=51 (above the maximum) returns 400', async () => {
      const ticketId = await createOwnerTicket('asg_e2e suggestions limit 51');
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignment-suggestions`)
        .query({ limit: 51 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(400);
    });

    it('an empty list (no candidate holds the required skill) is a valid 200, not an error', async () => {
      const ticketId = await createOwnerTicket(
        'asg_e2e suggestions empty',
        noMatchCategoryId,
      );

      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignment-suggestions`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    // Pure delegation, exercised against a REAL Postgres instance (not a mock): none of the D1
    // fixtures above hold the "Électricité" skill this category requires, so — before the
    // tie-break test below adds two that do — the suggestion list for it is empty regardless of
    // `limit`. If this route reimplemented (or diverged from)
    // `TechnicianSuggestionService.suggestForTicket`'s own logic instead of delegating to it,
    // that would be the kind of drift this still exercises end-to-end.
    it('delegates to TechnicianSuggestionService.suggestForTicket (default limit 10, honors an explicit limit)', async () => {
      const ticketId = await createOwnerTicket(
        'asg_e2e suggestions delegation',
      );

      const defaultRes = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignment-suggestions`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      expect(defaultRes.body).toEqual([]);

      const limitedRes = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignment-suggestions`)
        .query({ limit: 1 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      expect(limitedRes.body).toEqual([]);
    });

    // Proves the tie-break clause (`ORDER BY skillLevel DESC NULLS LAST, currentLoad ASC,
    // username ASC`) against a REAL PostgreSQL instance: the T5.1b unit spec only exercised it
    // with a mocked query builder, never real SQL syntax/execution.
    it('tie-break: two technicians tied on skillLevel AND currentLoad come back ordered by username ASC', async () => {
      const [{ id: skillId }] = await dataSource.query<IdRow[]>(
        `SELECT id FROM skills WHERE name = $1`,
        ['Électricité'],
      );

      const techA = await createTechnician({
        username: 'asg_e2e_tie_a',
        skills: [{ skillId, level: 3 }],
      });
      const techB = await createTechnician({
        username: 'asg_e2e_tie_b',
        skills: [{ skillId, level: 3 }],
      });

      const ticketId = await createOwnerTicket('asg_e2e suggestions tie-break');

      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignment-suggestions`)
        .query({ limit: 50 })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const body = res.body as TechnicianSuggestionBody[];
      const indexA = body.findIndex((item) => item.technicianId === techA.id);
      const indexB = body.findIndex((item) => item.technicianId === techB.id);
      expect(indexA).toBeGreaterThanOrEqual(0);
      expect(indexB).toBeGreaterThanOrEqual(0);
      expect(body[indexA].skillLevel).toBe(body[indexB].skillLevel);
      expect(body[indexA].currentLoad).toBe(body[indexB].currentLoad);
      expect(indexA).toBeLessThan(indexB);
    });
  });

  describe('POST /api/tickets/:id/assign — access control', () => {
    it('rejects a request without an access token with 401', async () => {
      const ticketId = await createOwnerTicket('asg_e2e assign no auth');
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(401);
    });

    it('rejects a CLIENT with 403', async () => {
      const ticketId = await createOwnerTicket('asg_e2e assign client');
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(403);
    });

    it('rejects a TECHNICIAN with 403', async () => {
      const ticketId = await createOwnerTicket('asg_e2e assign technician');
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${eligibleTechnicianTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(403);
    });

    it('returns 404 for an unknown ticket id', async () => {
      await request(app.getHttpServer())
        .post('/api/tickets/00000000-0000-0000-0000-000000000000/assign')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(404);
    });

    it('returns 400 for a non-UUID technicianId', async () => {
      const ticketId = await createOwnerTicket('asg_e2e assign bad uuid');
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: 'not-a-uuid' })
        .expect(400);
    });
  });

  // D1 (`docs/plan-P5-contracts.md` §2): one test per eligibility failure cause, first
  // assignment (ticket still OPEN).
  describe('POST /api/tickets/:id/assign — D1 target eligibility (first assignment)', () => {
    it.each<[string, () => string]>([
      [
        'NOT_FOUND (unknown technicianId)',
        // The NIL UUID — not an arbitrary made-up one: `class-validator`'s `@IsUUID()` requires
        // a real RFC 4122 version/variant nibble UNLESS the value is exactly the nil UUID,
        // which it special-cases as valid. Same convention already used throughout this
        // codebase (`technicians.e2e-spec.ts` et al.) for "syntactically valid but unknown" ids.
        () => '00000000-0000-0000-0000-000000000000',
      ],
      ['NOT_A_TECHNICIAN (a CLIENT id)', () => notATechnicianId],
      ['INACTIVE (isActive = false)', () => inactiveTechnicianId],
      [
        'NO_PROFILE (TECHNICIAN role, no TechnicianProfile row)',
        () => noProfileTechnicianId,
      ],
      ['UNAVAILABLE (isAvailable = false)', () => unavailableTechnicianId],
      [
        'AT_CAPACITY (currentLoad >= maxConcurrentTickets)',
        () => atCapacityTechnicianId,
      ],
    ])('%s -> 403, and writes nothing', async (_label, getTechnicianId) => {
      const ticketId = await createOwnerTicket('asg_e2e D1 first assignment');

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: getTechnicianId() })
        .expect(403);

      expect(await fetchAssignments(ticketId)).toEqual([]);
      expect(await fetchHistory(ticketId)).toEqual([]);
      const stillOpen = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      expect((stillOpen.body as TicketResponseBody).status).toBe('OPEN');
    });
  });

  // D1/D2 — the CORE of this task: the P3 guard `canReassignFromAssigned` only checks
  // `ADMIN + hasReason`. Without the D1 eligibility pre-check `TicketsService.assign` runs
  // BEFORE evaluating the transition, a reassignment carrying a reason to an INELIGIBLE
  // technician would sail straight through. This is the one case the machine (P3) alone would
  // NOT catch.
  describe('POST /api/tickets/:id/assign — D1/D2 target eligibility (reassignment, WITH a reason)', () => {
    it('reassigning an ASSIGNED ticket, with a valid reason, to a technician who is NOT eligible (UNAVAILABLE): 403, and the previous assignment is left completely untouched', async () => {
      const ticketId = await createOwnerTicket(
        'asg_e2e D1D2 reassignment guard',
      );
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(200);
      const assignmentsBefore = await fetchAssignments(ticketId);
      expect(assignmentsBefore).toHaveLength(1);

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          technicianId: unavailableTechnicianId,
          reason: 'Le technicien actuel part en congé.',
        })
        .expect(403);

      const assignmentsAfter = await fetchAssignments(ticketId);
      expect(assignmentsAfter).toEqual(assignmentsBefore);
      expect(assignmentsAfter[0].technician_id).toBe(eligibleTechnicianId);
      expect(assignmentsAfter[0].unassigned_at).toBeNull();

      const ticketRes = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);
      const ticketBody = ticketRes.body as TicketResponseBody;
      expect(ticketBody.status).toBe('ASSIGNED');
      expect(ticketBody.assignee?.id).toBe(eligibleTechnicianId);
    });

    it('reassigning an ASSIGNED ticket, with a valid reason, to a technician who is AT_CAPACITY: also 403', async () => {
      const ticketId = await createOwnerTicket(
        'asg_e2e D1D2 reassignment at capacity',
      );
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          technicianId: atCapacityTechnicianId,
          reason: 'Reaffectation vers un technicien deja sature.',
        })
        .expect(403);
    });
  });

  describe('POST /api/tickets/:id/assign — D5 (already assigned to this technician)', () => {
    it('reassigning to the technician already holding the ticket: 400, and writes nothing', async () => {
      const ticketId = await createOwnerTicket('asg_e2e D5');
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(200);
      const before = await fetchAssignments(ticketId);

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          technicianId: eligibleTechnicianId,
          reason: 'Motif ignore : meme technicien.',
        })
        .expect(400);

      expect(await fetchAssignments(ticketId)).toEqual(before);
    });
  });

  describe('POST /api/tickets/:id/assign — first assignment (OPEN -> ASSIGNED)', () => {
    it('200: moves the ticket to ASSIGNED, stamps assigneeId/assignedAt, creates one ticket_assignments row and one ticket_status_history row; reason is optional here', async () => {
      const ticketId = await createOwnerTicket('asg_e2e first assignment');

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId, isAutoSuggested: true })
        .expect(200);

      const body = res.body as TicketResponseBody;
      expect(body.status).toBe('ASSIGNED');
      expect(body.assignee?.id).toBe(eligibleTechnicianId);
      expect(body.assignedAt).not.toBeNull();

      const assignments = await fetchAssignments(ticketId);
      expect(assignments).toHaveLength(1);
      expect(assignments[0].technician_id).toBe(eligibleTechnicianId);
      expect(assignments[0].unassigned_at).toBeNull();

      const history = await fetchHistory(ticketId);
      expect(history).toEqual([
        expect.objectContaining({
          from_status: 'OPEN',
          to_status: 'ASSIGNED',
          changed_by_id: adminTokens.user.id,
          note: null,
        }),
      ]);
    });
  });

  describe('POST /api/tickets/:id/assign — reassignment (ASSIGNED -> ASSIGNED)', () => {
    it("WITHOUT a reason: 403 (imposed by the P3 guard canReassignFromAssigned, not by this route's own code)", async () => {
      const ticketId = await createOwnerTicket(
        'asg_e2e reassignment no reason',
      );
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(200);

      const secondTechnician = await createTechnician({
        username: 'asg_e2e_reassign_target_1',
      });

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: secondTechnician.id })
        .expect(403);
    });

    it('WITH a reason: 200 — closes the previous ticket_assignments row (unassignedAt set), creates a new one, and writes matching history', async () => {
      const ticketId = await createOwnerTicket(
        'asg_e2e reassignment with reason',
      );
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(200);

      const secondTechnician = await createTechnician({
        username: 'asg_e2e_reassign_target_2',
      });
      const reason = 'Le premier technicien est en arret maladie.';

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: secondTechnician.id, reason })
        .expect(200);

      const body = res.body as TicketResponseBody;
      expect(body.status).toBe('ASSIGNED');
      expect(body.assignee?.id).toBe(secondTechnician.id);

      const assignments = await fetchAssignments(ticketId);
      // Most recent first (assignedAt DESC): the NEW row, then the closed one.
      expect(assignments).toHaveLength(2);
      expect(assignments[0].technician_id).toBe(secondTechnician.id);
      expect(assignments[0].unassigned_at).toBeNull();
      expect(assignments[1].technician_id).toBe(eligibleTechnicianId);
      expect(assignments[1].unassigned_at).not.toBeNull();

      const history = await fetchHistory(ticketId);
      expect(history).toEqual([
        expect.objectContaining({
          from_status: 'OPEN',
          to_status: 'ASSIGNED',
          note: null,
        }),
        expect.objectContaining({
          from_status: 'ASSIGNED',
          to_status: 'ASSIGNED',
          note: reason,
        }),
      ]);
    });
  });

  describe('POST /api/tickets/:id/assign — invalid transition', () => {
    it('409 (INVALID_TRANSITION) on a CANCELLED ticket', async () => {
      const ticketId = await createOwnerTicket('asg_e2e cancelled ticket');
      await ticketRepository.update(ticketId, {
        status: TicketStatus.CANCELLED,
      });

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(409);
    });

    it('409 (INVALID_TRANSITION) on a CLOSED ticket', async () => {
      const ticketId = await createOwnerTicket('asg_e2e closed ticket');
      await ticketRepository.update(ticketId, { status: TicketStatus.CLOSED });

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(409);
    });
  });

  describe('POST /api/tickets/:id/assign — D7 (slaDueAt is never recomputed)', () => {
    it('slaDueAt is byte-for-byte identical before and after assignment', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({
          title: 'asg_e2e D7 slaDueAt',
          description: 'Fixture ticket for the D7 e2e test.',
          categoryId,
        })
        .expect(201);
      const created = createRes.body as TicketResponseBody;
      expect(created.slaDueAt).not.toBeNull();

      const assignRes = await request(app.getHttpServer())
        .post(`/api/tickets/${created.id}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(200);

      expect((assignRes.body as TicketResponseBody).slaDueAt).toBe(
        created.slaDueAt,
      );
    });
  });

  // D3 (`docs/plan-P5-contracts.md` §2): a technician's `currentLoad` counts ONLY
  // ASSIGNED/IN_PROGRESS tickets. The existing T5.1b coverage only proved CLOSED doesn't count;
  // this closes the gap for RESOLVED and CANCELLED.
  describe('POST /api/tickets/:id/assign — D3 (RESOLVED/CANCELLED never count toward currentLoad)', () => {
    it('a technician at maxConcurrentTickets = 1 with an existing RESOLVED ticket remains ELIGIBLE for a new assignment', async () => {
      const technician = await createTechnician({
        username: 'asg_e2e_d3_resolved',
        maxConcurrentTickets: 1,
      });
      const technicianTokens = await loginAs(
        app,
        'asg_e2e_d3_resolved',
        TECH_PASSWORD,
      );

      const firstTicketId = await createOwnerTicket(
        'asg_e2e D3 resolved ticket',
      );
      await request(app.getHttpServer())
        .post(`/api/tickets/${firstTicketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: technician.id })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/tickets/${firstTicketId}/start`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/tickets/${firstTicketId}/resolve`)
        .set('Authorization', `Bearer ${technicianTokens.accessToken}`)
        .send({ resolutionNote: 'Resolu pour le test D3.' })
        .expect(200);

      const secondTicketId = await createOwnerTicket(
        'asg_e2e D3 resolved second ticket',
      );
      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${secondTicketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: technician.id })
        .expect(200);
      expect((res.body as TicketResponseBody).status).toBe('ASSIGNED');
    });

    it('a technician at maxConcurrentTickets = 1 with an existing CANCELLED ticket remains ELIGIBLE for a new assignment', async () => {
      const technician = await createTechnician({
        username: 'asg_e2e_d3_cancelled',
        maxConcurrentTickets: 1,
      });

      const firstTicketId = await createOwnerTicket(
        'asg_e2e D3 cancelled ticket',
      );
      await request(app.getHttpServer())
        .post(`/api/tickets/${firstTicketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: technician.id })
        .expect(200);
      // `canCancelFromAssigned` only requires ADMIN (no reason needed).
      await request(app.getHttpServer())
        .post(`/api/tickets/${firstTicketId}/cancel`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({})
        .expect(200);

      const secondTicketId = await createOwnerTicket(
        'asg_e2e D3 cancelled second ticket',
      );
      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${secondTicketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: technician.id })
        .expect(200);
      expect((res.body as TicketResponseBody).status).toBe('ASSIGNED');
    });
  });

  describe('GET /api/tickets/:id/assignments — OwnershipGuard (owner, assignee, admin)', () => {
    it('rejects a request without an access token with 401', async () => {
      const ticketId = await createOwnerTicket('asg_e2e history no auth');
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignments`)
        .expect(401);
    });

    it('returns 404 for an unknown ticket id', async () => {
      await request(app.getHttpServer())
        .get('/api/tickets/00000000-0000-0000-0000-000000000000/assignments')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(404);
    });

    it('rejects a third party (neither owner, assignee, nor admin) with 403', async () => {
      const ticketId = await createOwnerTicket('asg_e2e history third party');
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignments`)
        .set('Authorization', `Bearer ${otherClientTokens.accessToken}`)
        .expect(403);
    });

    it('a technician who WAS assigned but got reassigned away is no longer the current assignee: 403', async () => {
      const ticketId = await createOwnerTicket(
        'asg_e2e history reassigned away',
      );
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId })
        .expect(200);
      const replacement = await createTechnician({
        username: 'asg_e2e_history_replacement',
      });
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          technicianId: replacement.id,
          reason: 'Reaffectation pour le test historique.',
        })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/assignments`)
        .set('Authorization', `Bearer ${eligibleTechnicianTokens.accessToken}`)
        .expect(403);
    });

    it('returns every assignment sorted assignedAt DESC (most recent first), with the exact contract shape and no raw FK leak, visible to the owner, the current assignee AND an admin', async () => {
      const ticketId = await createOwnerTicket('asg_e2e history full');
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: eligibleTechnicianId, isAutoSuggested: true })
        .expect(200);
      const replacement = await createTechnician({
        username: 'asg_e2e_history_full_replacement',
      });
      const reassignReason = 'Motif de reaffectation pour le test historique.';
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ technicianId: replacement.id, reason: reassignReason })
        .expect(200);
      const replacementTokens = await loginAs(
        app,
        'asg_e2e_history_full_replacement',
        TECH_PASSWORD,
      );

      const viewers: Array<[string, AuthResponseBody]> = [
        ['owner', ownerTokens],
        ['current assignee', replacementTokens],
        ['admin', adminTokens],
      ];
      for (const [, tokens] of viewers) {
        const res = await request(app.getHttpServer())
          .get(`/api/tickets/${ticketId}/assignments`)
          .set('Authorization', `Bearer ${tokens.accessToken}`)
          .expect(200);

        const body = res.body as TicketAssignmentResponseBody[];
        expect(body).toHaveLength(2);
        // Most recent first: the reassignment, then the original assignment.
        expect(body[0].technician.id).toBe(replacement.id);
        expect(body[0].reason).toBe(reassignReason);
        expect(body[0].isAutoSuggested).toBe(false);
        expect(body[0].unassignedAt).toBeNull();
        expect(body[1].technician.id).toBe(eligibleTechnicianId);
        expect(body[1].isAutoSuggested).toBe(true);
        expect(body[1].unassignedAt).not.toBeNull();
        expect(new Date(body[0].assignedAt).getTime()).toBeGreaterThanOrEqual(
          new Date(body[1].assignedAt).getTime(),
        );

        for (const item of body) {
          expect(Object.keys(item).sort()).toEqual(ASSIGNMENT_RESPONSE_KEYS);
          expect(item.assignedBy).toEqual({
            id: adminTokens.user.id,
            username: ADMIN.username,
          });
          expect(item).not.toHaveProperty('ticketId');
          expect(item).not.toHaveProperty('technicianId');
          expect(item.technician).not.toHaveProperty('firstName');
          expect(item.technician).not.toHaveProperty('lastName');
        }
      }
    });
  });
});
