import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Category } from '../src/modules/categories/entities/category.entity';
import { TicketAssignment } from '../src/modules/tickets/entities/ticket-assignment.entity';
import { TicketStatusHistory } from '../src/modules/tickets/entities/ticket-status-history.entity';
import { Ticket } from '../src/modules/tickets/entities/ticket.entity';
import { TicketStatus } from '../src/modules/tickets/enums/ticket-status.enum';
import { User } from '../src/modules/users/entities/user.entity';
import { UserRole } from '../src/modules/users/enums/user-role.enum';

// TD3 — proves, against a REAL PostgreSQL instance, the transactional guarantee the unit specs
// (`tickets.service.spec.ts`) can only assert structurally (one `manager.transaction` call, the
// right `save`s inside it, no reload after failure) because their `EntityManager` is a
// `jest.Mock`. This suite never calls `TicketsService` at all — `src/**` is out of scope for
// this task — it instead re-executes the exact write sequence of the private `applyTransition`
// method and of the `assign` method (both in `src/modules/tickets/tickets.service.ts`), each run
// inside their own `dataSource.manager.transaction(async (em) => { ... })` block, against the
// real domain entities, and proves the rollback with direct `SELECT`s once the (aborted)
// transaction has already been rolled back and its connection released.
//
// The forced failure is always a genuine PostgreSQL foreign key violation (SQLSTATE 23503), not
// a hand-thrown JS error: `changedById` on the final `ticket_status_history` insert — the last
// write in BOTH patterns — is set to a syntactically valid but non-existent user id. That FK is
// `FK_b30e46a9e8ef7c01564465a30a3` (`ticket_status_history.changed_by_id` ->
// `users.id`, added by `src/database/migrations/1785254838687-TicketDomain.ts`), asserted below
// by name so a future migration change to this constraint would fail this suite loudly instead
// of silently degrading it into "any error at all".
//
// `txn_e2e_` — not `e2e_%` (wiped by `auth.e2e-spec.ts`'s own cleanup) and not any other
// suite's own prefix. Jest runs every `*.e2e-spec.ts` file serially (`test/jest-e2e.json`,
// `maxWorkers: 1`) against one shared, real database.

interface TicketRow {
  id: string;
  status: string;
  assignee_id: string | null;
  assigned_at: Date | null;
  started_at: Date | null;
  updated_at: Date;
}

interface HistoryRow {
  from_status: string | null;
  to_status: string;
  changed_by_id: string | null;
  note: string | null;
}

interface AssignmentRow {
  id: string;
  technician_id: string;
  unassigned_at: Date | null;
}

// The nil UUID: syntactically valid (passes any FK-column type check) but guaranteed to never
// match a real row — the same "unknown but well-formed id" convention already used throughout
// this codebase's e2e suites (e.g. `ticket-assignment.e2e-spec.ts`'s `NOT_FOUND` case).
const NON_EXISTENT_USER_ID = '00000000-0000-0000-0000-000000000000';

// See the file-level comment above for where this name comes from.
const HISTORY_CHANGED_BY_FK = 'FK_b30e46a9e8ef7c01564465a30a3';

const OWNER = { username: 'txn_e2e_owner', email: 'txn_e2e_owner@test.local' };
const ACTOR = { username: 'txn_e2e_actor', email: 'txn_e2e_actor@test.local' };
const TECH1 = { username: 'txn_e2e_tech1', email: 'txn_e2e_tech1@test.local' };
const TECH2 = { username: 'txn_e2e_tech2', email: 'txn_e2e_tech2@test.local' };

async function cleanupFixtures(dataSource: DataSource): Promise<void> {
  // Dependency order (children first): ticket_assignments -> ticket_status_history -> tickets
  // -> users. Scoped exclusively to `txn_e2e_%` usernames; seeded skills/categories are NEVER
  // touched here.
  await dataSource.query(
    `DELETE FROM ticket_assignments
     WHERE ticket_id IN (
       SELECT id FROM tickets
       WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
          OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
     )`,
    ['txn_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM ticket_status_history
     WHERE ticket_id IN (
       SELECT id FROM tickets
       WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
          OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
     )`,
    ['txn_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM tickets
     WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
        OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    ['txn_e2e_%'],
  );
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
    'txn_e2e_%',
  ]);
}

async function insertUser(
  userRepository: Repository<User>,
  overrides: { username: string; email: string; role: UserRole },
): Promise<User> {
  return userRepository.save(
    userRepository.create({
      username: overrides.username,
      email: overrides.email,
      // Never authenticated through in this suite (no HTTP call, no login): only the NOT NULL
      // column constraint matters, not a real argon2 hash.
      password: 'txn_e2e-unused-password-hash',
      role: overrides.role,
    }),
  );
}

async function insertOpenTicket(
  ticketRepository: Repository<Ticket>,
  overrides: { createdById: string; categoryId: string },
): Promise<Ticket> {
  return ticketRepository.save(
    ticketRepository.create({
      title: 'txn_e2e applyTransition-pattern fixture ticket',
      description: 'Fixture ticket for the transaction-atomicity e2e suite.',
      status: TicketStatus.OPEN,
      categoryId: overrides.categoryId,
      createdById: overrides.createdById,
    }),
  );
}

async function insertAssignedTicket(
  ticketRepository: Repository<Ticket>,
  assignmentRepository: Repository<TicketAssignment>,
  overrides: {
    createdById: string;
    categoryId: string;
    technicianId: string;
    assignedById: string;
  },
): Promise<Ticket> {
  const assignedAt = new Date();
  const ticket = await ticketRepository.save(
    ticketRepository.create({
      title: 'txn_e2e assign-pattern fixture ticket',
      description: 'Fixture ticket for the transaction-atomicity e2e suite.',
      status: TicketStatus.ASSIGNED,
      categoryId: overrides.categoryId,
      createdById: overrides.createdById,
      assigneeId: overrides.technicianId,
      assignedAt,
    }),
  );
  await assignmentRepository.save(
    assignmentRepository.create({
      ticketId: ticket.id,
      technicianId: overrides.technicianId,
      assignedById: overrides.assignedById,
      reason: null,
      isAutoSuggested: false,
      assignedAt,
      unassignedAt: null,
    }),
  );
  return ticket;
}

async function fetchTicketRow(
  dataSource: DataSource,
  id: string,
): Promise<TicketRow> {
  const rows = await dataSource.query<TicketRow[]>(
    `SELECT id, status, assignee_id, assigned_at, started_at, updated_at
     FROM tickets WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function fetchHistory(
  dataSource: DataSource,
  ticketId: string,
): Promise<HistoryRow[]> {
  return dataSource.query<HistoryRow[]>(
    `SELECT from_status, to_status, changed_by_id, note
     FROM ticket_status_history WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId],
  );
}

async function fetchAssignments(
  dataSource: DataSource,
  ticketId: string,
): Promise<AssignmentRow[]> {
  return dataSource.query<AssignmentRow[]>(
    `SELECT id, technician_id, unassigned_at
     FROM ticket_assignments WHERE ticket_id = $1 ORDER BY assigned_at DESC`,
    [ticketId],
  );
}

describe('Transaction atomicity — real PostgreSQL rollback (TD3)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ticketRepository: Repository<Ticket>;
  let userRepository: Repository<User>;
  let assignmentRepository: Repository<TicketAssignment>;

  let categoryId: string;
  // Only set (and only cleaned up) if no active category already existed to reuse — mirrors
  // `tickets.e2e-spec.ts`: this suite never deletes pre-existing reference data, only what it
  // created itself.
  let createdFallbackCategoryId: string | null = null;

  let ownerId: string;
  let actorId: string;
  let tech1Id: string;
  let tech2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // The real `DataSource` from the Nest context, exactly like every other e2e suite — never a
    // hand-rolled `new DataSource(...)`.
    dataSource = app.get(DataSource);
    ticketRepository = dataSource.getRepository(Ticket);
    userRepository = dataSource.getRepository(User);
    assignmentRepository = dataSource.getRepository(TicketAssignment);

    await cleanupFixtures(dataSource);

    const categoryRepository = dataSource.getRepository(Category);
    const existingCategory = await categoryRepository.findOne({
      where: { isActive: true },
    });
    if (existingCategory) {
      categoryId = existingCategory.id;
    } else {
      const created = await categoryRepository.save(
        categoryRepository.create({
          name: 'Txn E2E Fallback Category',
          isActive: true,
        }),
      );
      categoryId = created.id;
      createdFallbackCategoryId = created.id;
    }

    ownerId = (
      await insertUser(userRepository, { ...OWNER, role: UserRole.CLIENT })
    ).id;
    actorId = (
      await insertUser(userRepository, { ...ACTOR, role: UserRole.ADMIN })
    ).id;
    tech1Id = (
      await insertUser(userRepository, { ...TECH1, role: UserRole.TECHNICIAN })
    ).id;
    tech2Id = (
      await insertUser(userRepository, { ...TECH2, role: UserRole.TECHNICIAN })
    ).id;
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

  // Mirrors `TicketsService.applyTransition`'s own write order exactly (ticket first, history
  // second, both through the same transactional `em`).
  describe('applyTransition pattern: ticket update + history insert in one manager.transaction', () => {
    it('rolls back a real Postgres FK violation on the history insert: the ticket update is undone too (SQLSTATE 23503)', async () => {
      const ticket = await insertOpenTicket(ticketRepository, {
        createdById: ownerId,
        categoryId,
      });
      const before = await fetchTicketRow(dataSource, ticket.id);
      expect(before.status).toBe(TicketStatus.OPEN);
      expect(before.started_at).toBeNull();

      const runTransition = () =>
        dataSource.manager.transaction(async (em) => {
          ticket.status = TicketStatus.IN_PROGRESS;
          ticket.startedAt = new Date();
          await em.save(ticket);
          await em.save(
            em.create(TicketStatusHistory, {
              ticketId: ticket.id,
              fromStatus: TicketStatus.OPEN,
              toStatus: TicketStatus.IN_PROGRESS,
              // A real FK violation, not a thrown JS error: no user with this id exists.
              changedById: NON_EXISTENT_USER_ID,
              note: null,
            }),
          );
        });

      await expect(runTransition()).rejects.toMatchObject({
        code: '23503',
        constraint: HISTORY_CHANGED_BY_FK,
      });

      // `dataSource.manager.transaction` has already rolled back and released the aborted
      // connection by the time the rejection above resolves (see `EntityManager.transaction` in
      // `node_modules/typeorm/entity-manager/EntityManager.js`: `rollbackTransaction()` then
      // `release()` both run in the same `catch`/`finally` before the error is rethrown to us).
      // These `SELECT`s therefore run on a clean connection, never inside the aborted
      // transaction.
      const after = await fetchTicketRow(dataSource, ticket.id);
      // Full revert: status AND the timestamp columns the (aborted) UPDATE touched are back to
      // their pre-transaction values — not just "some rollback happened".
      expect(after).toEqual(before);
      expect(await fetchHistory(dataSource, ticket.id)).toEqual([]);
    });

    // Contrepoint required by the brief: without this test, a transaction pattern that wrote
    // NOTHING at all would also pass the rollback test above — that would be tautological. This
    // proves the exact same pattern, run without a violation, commits BOTH writes.
    it('control: without a violation, the same pattern commits both the ticket update and the history row', async () => {
      const ticket = await insertOpenTicket(ticketRepository, {
        createdById: ownerId,
        categoryId,
      });

      await dataSource.manager.transaction(async (em) => {
        ticket.status = TicketStatus.IN_PROGRESS;
        ticket.startedAt = new Date();
        await em.save(ticket);
        await em.save(
          em.create(TicketStatusHistory, {
            ticketId: ticket.id,
            fromStatus: TicketStatus.OPEN,
            toStatus: TicketStatus.IN_PROGRESS,
            changedById: actorId,
            note: null,
          }),
        );
      });

      const after = await fetchTicketRow(dataSource, ticket.id);
      expect(after.status).toBe(TicketStatus.IN_PROGRESS);
      expect(after.started_at).not.toBeNull();

      expect(await fetchHistory(dataSource, ticket.id)).toEqual([
        expect.objectContaining({
          from_status: TicketStatus.OPEN,
          to_status: TicketStatus.IN_PROGRESS,
          changed_by_id: actorId,
          note: null,
        }),
      ]);
    });
  });

  // Anti-tautology demonstration required by the brief: re-runs the FIRST scenario above with
  // the exact same writes but WITHOUT `manager.transaction(...)` — i.e. the pattern
  // `applyTransition` would have if its transactional wrapper were ever removed. If the
  // rollback proven above were actually coming from something other than that wrapper (e.g. an
  // accidental Postgres default, or a tautological assertion that would pass even with no writes
  // at all), this test would also show a full revert. It does not: the ticket update, having
  // already auto-committed on its own before the history insert fails, is left in place. This is
  // the empirical proof that `manager.transaction(...)` — not something else — is what produces
  // the rollback demonstrated above.
  describe('anti-tautology control: same scenario WITHOUT manager.transaction', () => {
    it('outside a transaction, the same FK violation leaves the earlier, already-committed ticket update in place', async () => {
      const ticket = await insertOpenTicket(ticketRepository, {
        createdById: ownerId,
        categoryId,
      });
      const before = await fetchTicketRow(dataSource, ticket.id);

      // Deliberately NOT wrapped in `dataSource.manager.transaction(...)`: each `.save()` call
      // below runs (and commits) on its own, exactly what `applyTransition` would do if its
      // `manager.transaction(...)` wrapper were removed.
      ticket.status = TicketStatus.IN_PROGRESS;
      ticket.startedAt = new Date();
      await dataSource.manager.save(ticket); // write #1 — commits immediately, nothing to undo it

      const historyInsert = dataSource.manager.save(
        dataSource.manager.create(TicketStatusHistory, {
          ticketId: ticket.id,
          fromStatus: TicketStatus.OPEN,
          toStatus: TicketStatus.IN_PROGRESS,
          changedById: NON_EXISTENT_USER_ID,
          note: null,
        }),
      );
      await expect(historyInsert).rejects.toMatchObject({
        code: '23503',
        constraint: HISTORY_CHANGED_BY_FK,
      });

      // The exact assertion `expect(after).toEqual(before)` used by the transactional test above
      // would FAIL here — that is the point of this test.
      const after = await fetchTicketRow(dataSource, ticket.id);
      expect(after).not.toEqual(before);
      expect(after.status).toBe(TicketStatus.IN_PROGRESS); // the "orphaned" partial write survived
      expect(after.started_at).not.toBeNull();
      // The history row is still missing (its insert is what failed) — only the ticket write,
      // which had nothing left to roll it back, survived. That mismatch — one table updated, the
      // other not — is exactly the partial-write scenario the transactional pattern exists to
      // prevent.
      expect(await fetchHistory(dataSource, ticket.id)).toEqual([]);
    });
  });

  // Mirrors `TicketsService.assign`'s own write order exactly for a reassignment (close the
  // previous `ticket_assignments` row, insert the new one, update the ticket, insert history).
  describe('assign pattern: close previous assignment + new assignment + ticket update + history insert in one manager.transaction', () => {
    it('reassignment: a real FK violation on the history insert rolls back all four writes, including the already-closed previous assignment (SQLSTATE 23503)', async () => {
      const ticket = await insertAssignedTicket(
        ticketRepository,
        assignmentRepository,
        {
          createdById: ownerId,
          categoryId,
          technicianId: tech1Id,
          assignedById: actorId,
        },
      );
      const beforeTicket = await fetchTicketRow(dataSource, ticket.id);
      const beforeAssignments = await fetchAssignments(dataSource, ticket.id);
      expect(beforeAssignments).toHaveLength(1);
      expect(beforeAssignments[0].technician_id).toBe(tech1Id);
      expect(beforeAssignments[0].unassigned_at).toBeNull();

      const reason = 'txn_e2e reassignment reason (rollback case)';
      const now = new Date();

      const runAssign = () =>
        dataSource.manager.transaction(async (em) => {
          const currentAssignment = await em.findOne(TicketAssignment, {
            where: { ticketId: ticket.id, unassignedAt: IsNull() },
          });
          if (currentAssignment) {
            currentAssignment.unassignedAt = now;
            await em.save(currentAssignment);
          }

          await em.save(
            em.create(TicketAssignment, {
              ticketId: ticket.id,
              technicianId: tech2Id,
              assignedById: actorId,
              reason,
              isAutoSuggested: false,
              assignedAt: now,
              unassignedAt: null,
            }),
          );

          ticket.assigneeId = tech2Id;
          ticket.assignedAt = now;
          ticket.status = TicketStatus.ASSIGNED;
          await em.save(ticket);

          await em.save(
            em.create(TicketStatusHistory, {
              ticketId: ticket.id,
              fromStatus: TicketStatus.ASSIGNED,
              toStatus: TicketStatus.ASSIGNED,
              changedById: NON_EXISTENT_USER_ID,
              note: reason,
            }),
          );
        });

      await expect(runAssign()).rejects.toMatchObject({
        code: '23503',
        constraint: HISTORY_CHANGED_BY_FK,
      });

      const afterTicket = await fetchTicketRow(dataSource, ticket.id);
      expect(afterTicket).toEqual(beforeTicket);

      const afterAssignments = await fetchAssignments(dataSource, ticket.id);
      // Still exactly the ORIGINAL row: no new tech2 assignment, and the close on the tech1 row
      // (`unassignedAt = now`) never survived either.
      expect(afterAssignments).toEqual(beforeAssignments);
      expect(afterAssignments[0].technician_id).toBe(tech1Id);
      expect(afterAssignments[0].unassigned_at).toBeNull();

      expect(await fetchHistory(dataSource, ticket.id)).toEqual([]);
    });

    // Contrepoint required by the brief, same reasoning as the applyTransition control above.
    it('control: without a violation, the same reassignment pattern commits all four writes', async () => {
      const ticket = await insertAssignedTicket(
        ticketRepository,
        assignmentRepository,
        {
          createdById: ownerId,
          categoryId,
          technicianId: tech1Id,
          assignedById: actorId,
        },
      );

      const reason = 'txn_e2e reassignment reason (success case)';
      const now = new Date();

      await dataSource.manager.transaction(async (em) => {
        const currentAssignment = await em.findOne(TicketAssignment, {
          where: { ticketId: ticket.id, unassignedAt: IsNull() },
        });
        if (currentAssignment) {
          currentAssignment.unassignedAt = now;
          await em.save(currentAssignment);
        }

        await em.save(
          em.create(TicketAssignment, {
            ticketId: ticket.id,
            technicianId: tech2Id,
            assignedById: actorId,
            reason,
            isAutoSuggested: false,
            assignedAt: now,
            unassignedAt: null,
          }),
        );

        ticket.assigneeId = tech2Id;
        ticket.assignedAt = now;
        ticket.status = TicketStatus.ASSIGNED;
        await em.save(ticket);

        await em.save(
          em.create(TicketStatusHistory, {
            ticketId: ticket.id,
            fromStatus: TicketStatus.ASSIGNED,
            toStatus: TicketStatus.ASSIGNED,
            changedById: actorId,
            note: reason,
          }),
        );
      });

      const assignments = await fetchAssignments(dataSource, ticket.id);
      expect(assignments).toHaveLength(2);
      const newRow = assignments.find((a) => a.technician_id === tech2Id);
      const oldRow = assignments.find((a) => a.technician_id === tech1Id);
      expect(newRow?.unassigned_at).toBeNull();
      expect(oldRow?.unassigned_at).not.toBeNull();

      const afterTicket = await fetchTicketRow(dataSource, ticket.id);
      expect(afterTicket.assignee_id).toBe(tech2Id);
      expect(afterTicket.status).toBe(TicketStatus.ASSIGNED);

      expect(await fetchHistory(dataSource, ticket.id)).toEqual([
        expect.objectContaining({
          from_status: TicketStatus.ASSIGNED,
          to_status: TicketStatus.ASSIGNED,
          changed_by_id: actorId,
          note: reason,
        }),
      ]);
    });
  });
});
