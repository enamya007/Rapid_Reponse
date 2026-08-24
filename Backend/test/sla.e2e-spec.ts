import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TicketPriority } from '../src/modules/tickets/enums/ticket-priority.enum';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { UsersService } from '../src/modules/users/users.service';

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string };
}

interface SlaPolicyBody {
  priority: string;
  resolutionTargetMinutes: number;
  updatedAt: string;
}

interface TicketResponseBody {
  id: string;
  slaDueAt: string | null;
  createdAt: string;
}

interface CategoryBody {
  id: string;
}

interface PolicyRow {
  priority: string;
  resolution_target_minutes: number;
}

const SLA_RESPONSE_KEYS = [
  'priority',
  'resolutionTargetMinutes',
  'updatedAt',
].sort();

// `sla_e2e_` for the user fixtures. The `sla_policies` table itself is SHARED, seeded reference
// data bounded to one row per priority — this suite therefore cannot create disposable rows the
// way the other suites do. It snapshots the four rows in `beforeAll` and restores them exactly
// in `afterAll`, so it leaves the database as it found it for the suites that run after it.
const ADMIN = {
  username: 'sla_e2e_admin',
  email: 'sla_e2e_admin@test.local',
  password: 'SlaE2eAdmin123',
};
const CLIENT = {
  username: 'sla_e2e_client',
  email: 'sla_e2e_client@test.local',
  password: 'SlaE2eClient123',
};

async function cleanupUserFixtures(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    `DELETE FROM notifications
     WHERE recipient_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    ['sla_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM ticket_status_history
     WHERE ticket_id IN (
       SELECT id FROM tickets
       WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
     )`,
    ['sla_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM tickets
     WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    ['sla_e2e_%'],
  );
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
    'sla_e2e_%',
  ]);
}

describe('SLA policies (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  let adminTokens: AuthResponseBody;
  let clientTokens: AuthResponseBody;
  let categoryId: string;
  let originalPolicies: PolicyRow[];

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
    await cleanupUserFixtures(dataSource);

    originalPolicies = await dataSource.query<PolicyRow[]>(
      'SELECT priority, resolution_target_minutes FROM sla_policies',
    );

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

    const categoriesRes = await request(app.getHttpServer())
      .get('/api/categories?isActive=true')
      .set('Authorization', `Bearer ${clientTokens.accessToken}`)
      .expect(200);
    categoryId = (categoriesRes.body as CategoryBody[])[0].id;
  });

  afterAll(async () => {
    // Restore the shared referential to its exact pre-suite state, including deleting any row
    // this suite created for a priority that had none.
    await dataSource.query('DELETE FROM sla_policies');
    for (const row of originalPolicies) {
      await dataSource.query(
        'INSERT INTO sla_policies (priority, resolution_target_minutes) VALUES ($1, $2)',
        [row.priority, row.resolution_target_minutes],
      );
    }
    await cleanupUserFixtures(dataSource);
    await app.close();
  });

  describe('GET /api/sla-policies — every authenticated role (D9)', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer()).get('/api/sla-policies').expect(401);
    });

    it('is accessible to a CLIENT: the resolution target is a commitment made to the requester', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/sla-policies')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect((res.body as SlaPolicyBody[]).length).toBeGreaterThan(0);
    });

    it('orders by business severity — CRITICAL, HIGH, NORMAL, LOW', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/sla-policies')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      const priorities = (res.body as SlaPolicyBody[]).map((p) => p.priority);
      // Alphabetical would give CRITICAL, HIGH, LOW, NORMAL — this assertion excludes it.
      expect(priorities).toEqual([
        TicketPriority.CRITICAL,
        TicketPriority.HIGH,
        TicketPriority.NORMAL,
        TicketPriority.LOW,
      ]);
    });

    it('exposes exactly priority/resolutionTargetMinutes/updatedAt — never the row id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/sla-policies')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      for (const item of res.body as SlaPolicyBody[]) {
        expect(Object.keys(item).sort()).toEqual(SLA_RESPONSE_KEYS);
      }
    });
  });

  describe('PUT /api/sla-policies/:priority — ADMIN only', () => {
    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .put('/api/sla-policies/HIGH')
        .send({ resolutionTargetMinutes: 60 })
        .expect(401);
    });

    it('rejects a CLIENT with 403, and changes nothing', async () => {
      await request(app.getHttpServer())
        .put('/api/sla-policies/HIGH')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({ resolutionTargetMinutes: 1 })
        .expect(403);

      const rows = await dataSource.query<PolicyRow[]>(
        'SELECT resolution_target_minutes FROM sla_policies WHERE priority = $1',
        [TicketPriority.HIGH],
      );
      expect(rows[0].resolution_target_minutes).not.toBe(1);
    });

    it('lets an ADMIN update an existing policy, and persists it', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/sla-policies/HIGH')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ resolutionTargetMinutes: 999 })
        .expect(200);

      expect((res.body as SlaPolicyBody).resolutionTargetMinutes).toBe(999);

      const rows = await dataSource.query<PolicyRow[]>(
        'SELECT resolution_target_minutes FROM sla_policies WHERE priority = $1',
        [TicketPriority.HIGH],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].resolution_target_minutes).toBe(999);
    });

    it('D8: creates the row when that priority has none — the "no SLA policy configured" hole', async () => {
      await dataSource.query('DELETE FROM sla_policies WHERE priority = $1', [
        TicketPriority.LOW,
      ]);
      const before = await dataSource.query<PolicyRow[]>(
        'SELECT priority FROM sla_policies WHERE priority = $1',
        [TicketPriority.LOW],
      );
      expect(before).toHaveLength(0);

      const res = await request(app.getHttpServer())
        .put('/api/sla-policies/LOW')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ resolutionTargetMinutes: 8000 })
        .expect(200);

      expect((res.body as SlaPolicyBody).priority).toBe(TicketPriority.LOW);

      const after = await dataSource.query<PolicyRow[]>(
        'SELECT resolution_target_minutes FROM sla_policies WHERE priority = $1',
        [TicketPriority.LOW],
      );
      expect(after).toHaveLength(1);
      expect(after[0].resolution_target_minutes).toBe(8000);
    });

    it('never creates a second row for a priority that already has one', async () => {
      await request(app.getHttpServer())
        .put('/api/sla-policies/NORMAL')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ resolutionTargetMinutes: 500 })
        .expect(200);
      await request(app.getHttpServer())
        .put('/api/sla-policies/NORMAL')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ resolutionTargetMinutes: 600 })
        .expect(200);

      const rows = await dataSource.query<PolicyRow[]>(
        'SELECT resolution_target_minutes FROM sla_policies WHERE priority = $1',
        [TicketPriority.NORMAL],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].resolution_target_minutes).toBe(600);
    });

    it('400s on an unknown priority (ParseEnumPipe)', async () => {
      await request(app.getHttpServer())
        .put('/api/sla-policies/URGENT')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ resolutionTargetMinutes: 60 })
        .expect(400);
    });

    it('400s on a non-integer, a zero, or an out-of-range target', async () => {
      for (const resolutionTargetMinutes of [0, -5, 1.5, 525_601]) {
        await request(app.getHttpServer())
          .put('/api/sla-policies/CRITICAL')
          .set('Authorization', `Bearer ${adminTokens.accessToken}`)
          .send({ resolutionTargetMinutes })
          .expect(400);
      }
    });

    it('400s when the body carries an unknown field, priority included (it belongs to the URL)', async () => {
      await request(app.getHttpServer())
        .put('/api/sla-policies/CRITICAL')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ resolutionTargetMinutes: 60, priority: 'LOW' })
        .expect(400);
    });
  });

  describe('D8 — a new target governs future tickets, not existing ones', () => {
    it('a ticket created after the change gets its slaDueAt from the NEW target', async () => {
      await request(app.getHttpServer())
        .put('/api/sla-policies/CRITICAL')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ resolutionTargetMinutes: 90 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({
          title: 'sla_e2e ticket under the new critical target',
          description: 'Its slaDueAt must be 90 minutes after its creation.',
          categoryId,
          priority: TicketPriority.CRITICAL,
        })
        .expect(201);

      const ticket = res.body as TicketResponseBody;
      expect(ticket.slaDueAt).not.toBeNull();

      const elapsedMinutes =
        (new Date(ticket.slaDueAt as string).getTime() -
          new Date(ticket.createdAt).getTime()) /
        60_000;
      // The seeded CRITICAL target is 240 minutes; reading 90 proves the API write, not the
      // seed, is what the calculation used.
      expect(Math.round(elapsedMinutes)).toBe(90);
    });

    it('a ticket created BEFORE a change keeps the slaDueAt it was given', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${clientTokens.accessToken}`)
        .send({
          title: 'sla_e2e ticket predating a target change',
          description: 'Its slaDueAt must not move when the policy changes.',
          categoryId,
          priority: TicketPriority.CRITICAL,
        })
        .expect(201);
      const before = created.body as TicketResponseBody;

      await request(app.getHttpServer())
        .put('/api/sla-policies/CRITICAL')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ resolutionTargetMinutes: 10 })
        .expect(200);

      const reread = await request(app.getHttpServer())
        .get(`/api/tickets/${before.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(200);

      // `slaDueAt` is materialized at creation: changing the policy must not retroactively move
      // a deadline already communicated, nor rewrite SLA attainment already measured.
      expect((reread.body as TicketResponseBody).slaDueAt).toBe(
        before.slaDueAt,
      );
    });
  });
});
