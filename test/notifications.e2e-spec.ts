import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { MailMessage } from '../src/modules/mail/dto/mail-message';
import { MailQueueService } from '../src/modules/mail/mail-queue.service';
import { Category } from '../src/modules/categories/entities/category.entity';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { UsersService } from '../src/modules/users/users.service';

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string };
}

interface TicketResponseBody {
  id: string;
  reference: string;
  status: string;
  assignee: { id: string } | null;
}

interface TechnicianResponseBody {
  id: string;
  username: string;
}

interface NotificationResponseBody {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  ticketId: string | null;
  ticketReference: string | null;
  readAt: string | null;
  createdAt: string;
}

interface PaginationMetaBody {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface NotificationListResponseBody {
  data: NotificationResponseBody[];
  meta: PaginationMetaBody;
}

interface UnreadCountResponseBody {
  count: number;
}

// `ntf_e2e_` — NOT `e2e_%` (wiped by `auth.e2e-spec.ts`'s own `beforeAll`/`afterAll`), and not
// any other suite's own prefix, so this suite's data can never be deleted mid-run by another
// spec file, nor vice versa. Jest runs e2e specs serially (`maxWorkers: 1`, `test/jest-e2e.json`)
// against one shared, real database.
const ADMIN_1 = {
  username: 'ntf_e2e_admin1',
  email: 'ntf_e2e_admin1@test.local',
  password: 'NtfE2eAdmin1a',
};
const ADMIN_2 = {
  username: 'ntf_e2e_admin2',
  email: 'ntf_e2e_admin2@test.local',
  password: 'NtfE2eAdmin2a',
};
const OWNER = {
  username: 'ntf_e2e_owner',
  email: 'ntf_e2e_owner@test.local',
  password: 'NtfE2eOwner1a',
};
const OTHER_CLIENT = {
  username: 'ntf_e2e_other_client',
  email: 'ntf_e2e_other_client@test.local',
  password: 'NtfE2eOther1a',
};
const TECH_PASSWORD = 'NtfE2eTechGen1';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `TicketsService`/`TicketCommentsService` call `EventEmitter2.emit()` (never `emitAsync`,
// never awaited — confirmed by reading `eventemitter2`'s own `emit()`: it invokes each listener
// but never awaits an async listener's returned promise) strictly AFTER their own write has
// already committed and the HTTP response is already on its way back to the caller (P6 contract
// D1/D2). The notification fan-out this suite exercises is therefore genuinely asynchronous
// relative to the request that triggered it — reading it back immediately after `.expect(2xx)`
// is a real race, not a hypothetical one (this raced visibly while writing this suite).
//
// Polling with a short interval, bounded by a generous timeout, is the standard way to assert
// against an eventually-consistent side effect without coupling this suite to how long any
// particular listener happens to take on a given machine. This never waits longer than it has
// to: `isReady` is checked immediately, before the first sleep.
async function waitFor<T>(
  poll: () => Promise<T>,
  isReady: (value: T) => boolean,
  {
    timeoutMs = 3000,
    intervalMs = 25,
  }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await poll();
    if (isReady(value)) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `waitFor: condition not satisfied within ${timeoutMs}ms. Last value: ${JSON.stringify(value)}`,
      );
    }
    await sleep(intervalMs);
  }
}

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let admin1Tokens: AuthResponseBody;
  let admin2Tokens: AuthResponseBody;
  let ownerTokens: AuthResponseBody;
  let otherClientTokens: AuthResponseBody;
  let categoryId: string;
  let createdFallbackCategoryId: string | null = null;

  // §9 (`docs/plan-P6-contracts.md`): the mail file's PRODUCER is doubled — never a real SMTP
  // connection, never Mailpit — exactly the pattern `attachments.e2e-spec.ts` uses for
  // `StorageService`. Every assertion on "was an email sent" below reads this mock instead of
  // any external system.
  const mailQueueMock = {
    enqueue: jest
      .fn<Promise<void>, [MailMessage]>()
      .mockResolvedValue(undefined),
  };

  async function createTechnician(
    username: string,
  ): Promise<TechnicianResponseBody> {
    const res = await request(app.getHttpServer())
      .post('/api/technicians')
      .set('Authorization', `Bearer ${admin1Tokens.accessToken}`)
      .send({
        username,
        email: `${username}@test.local`,
        password: TECH_PASSWORD,
      })
      .expect(201);
    return res.body as TechnicianResponseBody;
  }

  async function createOwnerTicket(title: string): Promise<TicketResponseBody> {
    const res = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
      .send({
        title,
        description: 'Ticket créé pour la suite e2e notifications.',
        categoryId,
      })
      .expect(201);
    return res.body as TicketResponseBody;
  }

  async function listNotifications(
    token: string,
    query = '',
  ): Promise<NotificationListResponseBody> {
    const res = await request(app.getHttpServer())
      .get(`/api/notifications${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as NotificationListResponseBody;
  }

  async function unreadCount(token: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as UnreadCountResponseBody).count;
  }

  // Polls `GET /notifications` for `token` until at least one entry matches `predicate`, then
  // returns it. See the top-of-file comment on `waitFor` for why this polling is needed at all.
  async function waitForNotification(
    token: string,
    predicate: (n: NotificationResponseBody) => boolean,
  ): Promise<NotificationResponseBody> {
    const list = await waitFor(
      () => listNotifications(token),
      (result) => result.data.some(predicate),
    );
    // Non-null: `waitFor` only returns once `isReady` (i.e. `.some(predicate)`) was true for
    // this exact `list`.
    return list.data.find(predicate)!;
  }

  // Same idea, for assertions that need a COUNT of matching entries (e.g. "tech1 now has TWO
  // TICKET_ASSIGNED rows") rather than just "at least one".
  async function waitForNotificationCount(
    token: string,
    predicate: (n: NotificationResponseBody) => boolean,
    expectedCount: number,
  ): Promise<NotificationResponseBody[]> {
    const list = await waitFor(
      () => listNotifications(token),
      (result) => result.data.filter(predicate).length >= expectedCount,
    );
    return list.data.filter(predicate);
  }

  async function waitForMailCallCount(expectedCount: number): Promise<void> {
    await waitFor(
      () => Promise.resolve(mailQueueMock.enqueue.mock.calls.length),
      (count) => count >= expectedCount,
    );
  }

  // Creates a ticket and waits for `watcherToken`'s OWN `TICKET_CREATED` notification for it to
  // be visible before returning — i.e. the async fan-out this ticket triggers has settled from
  // that specific recipient's point of view. Used by describe blocks below whose own assertions
  // only ever read `watcherToken`'s notifications, so settling for that one recipient is enough.
  async function createOwnerTicketSettled(
    title: string,
    watcherToken: string,
  ): Promise<TicketResponseBody> {
    const ticket = await createOwnerTicket(title);
    await waitForNotification(
      watcherToken,
      (n) => n.type === 'TICKET_CREATED' && n.ticketId === ticket.id,
    );
    return ticket;
  }

  async function cleanupFixtures(ds: DataSource): Promise<void> {
    // Dependency order: notifications -> ticket_comments/ticket_assignments/
    // ticket_status_history -> technician_skills -> technician_profiles -> tickets -> users.
    // `tickets.created_by_id` is `ON DELETE RESTRICT` (`docs/data-model.md` §2.7), so tickets
    // must go before users, and `notifications.recipient_id`/`.ticket_id` are both `ON DELETE
    // CASCADE` -- the explicit `DELETE FROM notifications` first is defense in depth
    // (belt-and-braces, matching every other P4-P6 e2e suite's own cleanup style), not strictly
    // required.
    await ds.query(
      `DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      ['ntf_e2e_%'],
    );
    await ds.query(
      `DELETE FROM ticket_comments
       WHERE ticket_id IN (
         SELECT id FROM tickets
         WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
            OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
       )`,
      ['ntf_e2e_%'],
    );
    await ds.query(
      `DELETE FROM ticket_assignments
       WHERE ticket_id IN (
         SELECT id FROM tickets
         WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
            OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
       )`,
      ['ntf_e2e_%'],
    );
    await ds.query(
      `DELETE FROM ticket_status_history
       WHERE ticket_id IN (
         SELECT id FROM tickets
         WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
            OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
       )`,
      ['ntf_e2e_%'],
    );
    await ds.query(
      `DELETE FROM technician_skills
       WHERE technician_profile_id IN (
         SELECT tp.id FROM technician_profiles tp
         JOIN users u ON u.id = tp.user_id
         WHERE u.username LIKE $1
       )`,
      ['ntf_e2e_%'],
    );
    await ds.query(
      `DELETE FROM technician_profiles
       WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      ['ntf_e2e_%'],
    );
    await ds.query(
      `DELETE FROM tickets
       WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
          OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      ['ntf_e2e_%'],
    );
    await ds.query('DELETE FROM users WHERE username LIKE $1', ['ntf_e2e_%']);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailQueueService)
      .useValue(mailQueueMock)
      .compile();

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

    const categoryRepository = dataSource.getRepository(Category);
    const existingCategory = await categoryRepository.findOne({
      where: { isActive: true },
    });
    if (existingCategory) {
      categoryId = existingCategory.id;
    } else {
      const created = await categoryRepository.save(
        categoryRepository.create({
          name: 'Notifications E2E Fallback Category',
          isActive: true,
        }),
      );
      categoryId = created.id;
      createdFallbackCategoryId = created.id;
    }

    ownerTokens = await registerClient(app, OWNER);
    otherClientTokens = await registerClient(app, OTHER_CLIENT);

    const usersService = app.get(UsersService);
    const admin1Hash = await argon2.hash(ADMIN_1.password);
    await usersService.create({
      username: ADMIN_1.username,
      email: ADMIN_1.email,
      passwordHash: admin1Hash,
      role: UserRole.ADMIN,
    });
    admin1Tokens = await loginAs(app, ADMIN_1.username, ADMIN_1.password);

    const admin2Hash = await argon2.hash(ADMIN_2.password);
    await usersService.create({
      username: ADMIN_2.username,
      email: ADMIN_2.email,
      passwordHash: admin2Hash,
      role: UserRole.ADMIN,
    });
    admin2Tokens = await loginAs(app, ADMIN_2.username, ADMIN_2.password);
  });

  afterEach(() => {
    mailQueueMock.enqueue.mockClear();
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

  describe('Ticket lifecycle fan-out (P6 contract §5)', () => {
    let ticket: TicketResponseBody;
    let tech1: TechnicianResponseBody;
    let tech1Tokens: AuthResponseBody;
    let tech2: TechnicianResponseBody;
    let tech2Tokens: AuthResponseBody;

    beforeAll(async () => {
      tech1 = await createTechnician('ntf_e2e_tech1');
      tech1Tokens = await loginAs(app, 'ntf_e2e_tech1', TECH_PASSWORD);
      tech2 = await createTechnician('ntf_e2e_tech2');
      tech2Tokens = await loginAs(app, 'ntf_e2e_tech2', TECH_PASSWORD);
    });

    it('ticket.created: notifies every active ADMIN in-app, and sends NO email', async () => {
      ticket = await createOwnerTicket('Panne de climatisation salle serveur');

      const [admin1Entry] = await Promise.all([
        waitForNotification(
          admin1Tokens.accessToken,
          (n) => n.type === 'TICKET_CREATED' && n.ticketId === ticket.id,
        ),
        waitForNotification(
          admin2Tokens.accessToken,
          (n) => n.type === 'TICKET_CREATED' && n.ticketId === ticket.id,
        ),
      ]);

      expect(admin1Entry.title).toBe(`Nouveau ticket ${ticket.reference}`);
      expect(admin1Entry.ticketReference).toBe(ticket.reference);
      expect(admin1Entry.readAt).toBeNull();

      expect(mailQueueMock.enqueue).not.toHaveBeenCalled();
    });

    it('ticket.assigned (first assignment): notifies AND emails only the new assignee', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign`)
        .set('Authorization', `Bearer ${admin1Tokens.accessToken}`)
        .send({ technicianId: tech1.id })
        .expect(200);

      const entry = await waitForNotification(
        tech1Tokens.accessToken,
        (n) => n.type === 'TICKET_ASSIGNED' && n.ticketId === ticket.id,
      );
      expect(entry.title).toBe(`Ticket ${ticket.reference} affecté`);
      expect(entry.body).toContain('vous a été affecté');

      await waitForMailCallCount(1);
      expect(mailQueueMock.enqueue).toHaveBeenCalledTimes(1);
      const [message] = mailQueueMock.enqueue.mock.calls[0];
      expect(message.to).toBe('ntf_e2e_tech1@test.local');
      expect(message.subject).toContain(ticket.reference);
    });

    it('ticket.assigned (reassignment): notifies BOTH technicians in-app, but emails ONLY the new one', async () => {
      mailQueueMock.enqueue.mockClear();

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign`)
        .set('Authorization', `Bearer ${admin1Tokens.accessToken}`)
        .send({
          technicianId: tech2.id,
          reason: 'Le technicien précédent est indisponible.',
        })
        .expect(200);

      // tech1 ends up with TWO TICKET_ASSIGNED entries for this ticket: the original assignment
      // (previous test) and this reassignment notifying them as the outgoing assignee.
      const tech1Entries = await waitForNotificationCount(
        tech1Tokens.accessToken,
        (n) => n.type === 'TICKET_ASSIGNED' && n.ticketId === ticket.id,
        2,
      );
      const tech2Entry = await waitForNotification(
        tech2Tokens.accessToken,
        (n) => n.type === 'TICKET_ASSIGNED' && n.ticketId === ticket.id,
      );
      expect(tech1Entries.length).toBe(2);
      expect(tech2Entry).toBeDefined();

      await waitForMailCallCount(1);
      expect(mailQueueMock.enqueue).toHaveBeenCalledTimes(1);
      const [message] = mailQueueMock.enqueue.mock.calls[0];
      expect(message.to).toBe('ntf_e2e_tech2@test.local');
    });

    it('ticket.status-changed: notifies AND emails BOTH the owning client and the assignee', async () => {
      mailQueueMock.enqueue.mockClear();

      // Actor is ADMIN_1 here (allowed by `canStartFromAssigned`), which is neither the owning
      // client nor the assignee -- so BOTH of them are notified (D8 only excludes the actor).
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/start`)
        .set('Authorization', `Bearer ${admin1Tokens.accessToken}`)
        .expect(200);

      const [ownerEntry, tech2Entry] = await Promise.all([
        waitForNotification(
          ownerTokens.accessToken,
          (n) => n.type === 'TICKET_STATUS_CHANGED' && n.ticketId === ticket.id,
        ),
        waitForNotification(
          tech2Tokens.accessToken,
          (n) => n.type === 'TICKET_STATUS_CHANGED' && n.ticketId === ticket.id,
        ),
      ]);
      expect(ownerEntry.body).toBe('Statut passé de ASSIGNED à IN_PROGRESS.');
      expect(tech2Entry).toBeDefined();

      await waitForMailCallCount(2);
      expect(mailQueueMock.enqueue).toHaveBeenCalledTimes(2);
      const recipients = mailQueueMock.enqueue.mock.calls.map(
        ([message]) => message.to,
      );
      expect(recipients.sort()).toEqual(
        ['ntf_e2e_owner@test.local', 'ntf_e2e_tech2@test.local'].sort(),
      );
    });

    it('ticket.commented PUBLIC: notifies AND emails the owning client (the assignee is the actor, excluded by D8)', async () => {
      mailQueueMock.enqueue.mockClear();

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${tech2Tokens.accessToken}`)
        .send({ body: 'Intervention prévue demain matin.' })
        .expect(201);

      const publicEntries = await waitForNotificationCount(
        ownerTokens.accessToken,
        (n) => n.type === 'TICKET_COMMENTED' && n.ticketId === ticket.id,
        1,
      );
      expect(publicEntries.length).toBe(1);
      // D6: never the comment body, only the fixed sentence built from the ticket's own title.
      expect(publicEntries[0].body).toBe(
        'Un commentaire a été ajouté au ticket « Panne de climatisation salle serveur ».',
      );
      expect(publicEntries[0].body).not.toContain('Intervention prévue');

      await waitForMailCallCount(1);
      expect(mailQueueMock.enqueue).toHaveBeenCalledTimes(1);
      const [message] = mailQueueMock.enqueue.mock.calls[0];
      expect(message.to).toBe('ntf_e2e_owner@test.local');
    });

    // D7/D6 — the leak test explicitly required by the brief: an INTERNAL comment must produce
    // NO notification at all for the ticket's owning CLIENT, and no email for anyone.
    it('ticket.commented INTERNAL: notifies ADMIN + assignee in-app only, NEVER the owning CLIENT, and sends no email', async () => {
      mailQueueMock.enqueue.mockClear();
      const ownerListBefore = await listNotifications(ownerTokens.accessToken);
      const commentedCountBefore = ownerListBefore.data.filter(
        (n) => n.type === 'TICKET_COMMENTED' && n.ticketId === ticket.id,
      ).length;

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${tech2Tokens.accessToken}`)
        .send({
          body: 'Note interne : pièce détachée en commande, ne pas communiquer au client.',
          visibility: 'INTERNAL',
        })
        .expect(201);

      // Wait for BOTH admins' notifications: `NotificationsService` processes candidates
      // sequentially, one full `save -> emit -> (maybe) enqueue` per recipient before moving to
      // the next, so once BOTH of the two real candidates for this event are confirmed
      // persisted, the entire fan-out for this comment has necessarily finished — including
      // whatever it did (or, correctly, did NOT do) regarding the owning CLIENT, who is never a
      // candidate at all in a correct implementation.
      await Promise.all([
        waitForNotification(
          admin1Tokens.accessToken,
          (n) => n.type === 'TICKET_COMMENTED' && n.ticketId === ticket.id,
        ),
        waitForNotification(
          admin2Tokens.accessToken,
          (n) => n.type === 'TICKET_COMMENTED' && n.ticketId === ticket.id,
        ),
      ]);

      // THE leak assertion: the owning CLIENT's TICKET_COMMENTED count for this ticket must NOT
      // have grown -- they received nothing for the INTERNAL comment.
      const ownerListAfter = await listNotifications(ownerTokens.accessToken);
      const commentedCountAfter = ownerListAfter.data.filter(
        (n) => n.type === 'TICKET_COMMENTED' && n.ticketId === ticket.id,
      ).length;
      expect(commentedCountAfter).toBe(commentedCountBefore);
      for (const entry of ownerListAfter.data) {
        expect(entry.body).not.toContain('pièce détachée');
      }

      expect(mailQueueMock.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('GET /notifications — scoping, pagination, unreadOnly (D16, D18)', () => {
    let paginationTicket: TicketResponseBody;

    beforeAll(async () => {
      // Three fresh tickets, each producing exactly one MORE `TICKET_CREATED` notification for
      // every active ADMIN, on top of whatever the lifecycle describe block above already left
      // ADMIN_2 with (it also notifies every admin, twice: `ticket.created` and the INTERNAL
      // comment). The assertions below never hardcode an exact total for that reason -- they
      // read `meta.total` back from the API first and assert relative to it.
      // `...Settled` waits for ADMIN_2's own notification for each ticket before moving to the
      // next, so by the time this `beforeAll` returns, ADMIN_2's list has genuinely settled.
      paginationTicket = await createOwnerTicketSettled(
        'Ticket pour la pagination 1',
        admin2Tokens.accessToken,
      );
      await createOwnerTicketSettled(
        'Ticket pour la pagination 2',
        admin2Tokens.accessToken,
      );
      await createOwnerTicketSettled(
        'Ticket pour la pagination 3',
        admin2Tokens.accessToken,
      );
    });

    it('scopes strictly to the caller: OTHER_CLIENT (uninvolved) sees no notification at all', async () => {
      const list = await listNotifications(otherClientTokens.accessToken);
      expect(list.data).toEqual([]);
      expect(list.meta.total).toBe(0);
    });

    it('paginates: limit=2 returns 2 items and a correct meta.total/meta.totalPages', async () => {
      const fullList = await listNotifications(admin2Tokens.accessToken);
      const total = fullList.meta.total;
      expect(total).toBeGreaterThanOrEqual(3);

      const page1 = await listNotifications(
        admin2Tokens.accessToken,
        '?page=1&limit=2',
      );
      expect(page1.data.length).toBe(2);
      expect(page1.meta.total).toBe(total);
      expect(page1.meta.totalPages).toBe(Math.ceil(total / 2));
    });

    it('orders by createdAt DESC (the most recently created ticket notification comes first)', async () => {
      const list = await listNotifications(admin2Tokens.accessToken);
      const timestamps = list.data.map((n) => new Date(n.createdAt).getTime());
      const sorted = [...timestamps].sort((a, b) => b - a);
      expect(timestamps).toEqual(sorted);
    });

    it('unreadOnly=true returns only unread notifications', async () => {
      // Mark exactly one notification read directly through the API, then confirm it is
      // excluded from `?unreadOnly=true`.
      const before = await listNotifications(admin2Tokens.accessToken);
      const target = before.data.find(
        (n) => n.ticketId === paginationTicket.id,
      );
      expect(target).toBeDefined();

      await request(app.getHttpServer())
        .patch(`/api/notifications/${target!.id}/read`)
        .set('Authorization', `Bearer ${admin2Tokens.accessToken}`)
        .expect(204);

      const unread = await listNotifications(
        admin2Tokens.accessToken,
        '?unreadOnly=true',
      );
      expect(unread.data.some((n) => n.id === target!.id)).toBe(false);
      expect(unread.meta.total).toBe(before.meta.total - 1);
    });

    // D18, and the exact case that demasked the bug in P5: `?unreadOnly=false` must behave
    // EXACTLY like the parameter being absent (i.e. return everything, read AND unread), not
    // like `?unreadOnly=true` (`Boolean('false') === true` is the trap).
    //
    // MUTATION PROOF (documented in the task report): replacing `NotificationQueryDto`'s
    // `@Transform(parseBooleanQuery)` with a naive `@Transform(({ value }) => Boolean(value))`
    // makes THIS test red — `unreadOnly=false` would then be parsed as `true`, and the response
    // would (incorrectly) omit the already-read notification.
    it('unreadOnly=false behaves exactly like the parameter being absent (D18)', async () => {
      const absent = await listNotifications(admin2Tokens.accessToken);
      const explicitFalse = await listNotifications(
        admin2Tokens.accessToken,
        '?unreadOnly=false',
      );

      expect(explicitFalse.meta.total).toBe(absent.meta.total);
      expect(explicitFalse.data.map((n) => n.id).sort()).toEqual(
        absent.data.map((n) => n.id).sort(),
      );
      // Sanity: at least one of them is the notification marked read in the previous test, so
      // this genuinely exercises "read notifications are still included", not a vacuous case.
      const anyRead = explicitFalse.data.some((n) => n.readAt !== null);
      expect(anyRead).toBe(true);
    });
  });

  describe('GET /notifications/unread-count, PATCH read-all, PATCH :id/read (D16, route order)', () => {
    let localAdminTokens: AuthResponseBody;

    beforeAll(async () => {
      const usersService = app.get(UsersService);
      const hash = await argon2.hash('NtfE2eAdminRc1a');
      await usersService.create({
        username: 'ntf_e2e_admin_rc',
        email: 'ntf_e2e_admin_rc@test.local',
        passwordHash: hash,
        role: UserRole.ADMIN,
      });
      localAdminTokens = await loginAs(
        app,
        'ntf_e2e_admin_rc',
        'NtfE2eAdminRc1a',
      );

      // Two fresh tickets -> two TICKET_CREATED notifications for this admin, both unread.
      // `...Settled` waits for each one before creating the next.
      await createOwnerTicketSettled(
        'Ticket pour unread-count/read-all 1',
        localAdminTokens.accessToken,
      );
      await createOwnerTicketSettled(
        'Ticket pour unread-count/read-all 2',
        localAdminTokens.accessToken,
      );
    });

    it('GET /notifications/unread-count is NOT swallowed by the :id/read route (route order)', async () => {
      const count = await unreadCount(localAdminTokens.accessToken);
      expect(count).toBe(2);
    });

    it('PATCH /notifications/read-all is NOT swallowed by the :id/read route, and marks everything read', async () => {
      await request(app.getHttpServer())
        .patch('/api/notifications/read-all')
        .set('Authorization', `Bearer ${localAdminTokens.accessToken}`)
        .expect(204);

      const count = await unreadCount(localAdminTokens.accessToken);
      expect(count).toBe(0);

      const list = await listNotifications(localAdminTokens.accessToken);
      expect(list.data.every((n) => n.readAt !== null)).toBe(true);
    });

    it('PATCH /notifications/:id/read is idempotent — reading an already-read notification is still 204 and does not error', async () => {
      const list = await listNotifications(localAdminTokens.accessToken);
      const [first] = list.data;

      await request(app.getHttpServer())
        .patch(`/api/notifications/${first.id}/read`)
        .set('Authorization', `Bearer ${localAdminTokens.accessToken}`)
        .expect(204);
    });

    // D16, and the exact status-code contract required by the brief: a 403 here would reveal
    // the notification's existence to a caller who cannot see it -- 404 both when the id is
    // unknown AND when it belongs to someone else.
    //
    // MUTATION PROOF (documented in the task report): changing `NotificationsService.markRead`
    // to "find by id only, then throw `ForbiddenException` if `recipientId` mismatches" makes
    // THIS test red (`403` instead of `404`).
    it('PATCH /notifications/:id/read returns 404 (never 403) for a notification belonging to someone else', async () => {
      const list = await listNotifications(localAdminTokens.accessToken);
      const foreignNotificationId = list.data[0].id;

      await request(app.getHttpServer())
        .patch(`/api/notifications/${foreignNotificationId}/read`)
        .set('Authorization', `Bearer ${otherClientTokens.accessToken}`)
        .expect(404);
    });

    it('PATCH /notifications/:id/read returns 404 for a well-formed but non-existent id', async () => {
      await request(app.getHttpServer())
        .patch('/api/notifications/00000000-0000-4000-8000-000000000000/read')
        .set('Authorization', `Bearer ${localAdminTokens.accessToken}`)
        .expect(404);
    });
  });

  describe('Authentication', () => {
    it('rejects every route without an access token with 401', async () => {
      await request(app.getHttpServer()).get('/api/notifications').expect(401);
      await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .expect(401);
      await request(app.getHttpServer())
        .patch('/api/notifications/read-all')
        .expect(401);
      await request(app.getHttpServer())
        .patch('/api/notifications/00000000-0000-4000-8000-000000000000/read')
        .expect(401);
    });
  });
});
