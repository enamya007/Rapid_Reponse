import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { MailMessage } from '../src/modules/mail/dto/mail-message';
import { MailQueueService } from '../src/modules/mail/mail-queue.service';
import { NOTIFICATION_CREATED_CLIENT_EVENT } from '../src/modules/notifications/notifications.gateway';
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
}

interface TechnicianResponseBody {
  id: string;
  username: string;
}

// Mirrors `NotificationResponseDto` (`src/modules/notifications/dto/notification-response.dto.ts`)
// field for field — this is exactly what P6 contract D21 requires the WebSocket push to carry:
// the SAME shape the REST API returns, not a second one.
interface NotificationEventBody {
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

interface NotificationListResponseBody {
  data: NotificationEventBody[];
}

// `ntg_e2e_` — NOT `e2e_%` (wiped by `auth.e2e-spec.ts`), and distinct from `ntf_e2e_`
// (`notifications.e2e-spec.ts`, the REST/persistence suite this one complements). Jest runs e2e
// specs serially (`maxWorkers: 1`, `test/jest-e2e.json`) against one shared, real database.
const ADMIN = {
  username: 'ntg_e2e_admin',
  email: 'ntg_e2e_admin@test.local',
  password: 'NtgE2eAdmin1a',
};
const OWNER = {
  username: 'ntg_e2e_owner',
  email: 'ntg_e2e_owner@test.local',
  password: 'NtgE2eOwner1a',
};
const TECH_PASSWORD = 'NtgE2eTechGen1';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The WS-native equivalent of `notifications.e2e-spec.ts`'s own `waitFor` polling helper: that
// suite polls a REST endpoint because REST has no push primitive, but a socket is push-based
// already, so the bounded wait here is a plain event listener with a timeout instead of a poll
// loop — same principle ("never wait longer than necessary for an eventually-consistent async
// side effect, but never wait forever either"), the WS-appropriate mechanism.
function waitForSocketEvent<T = unknown>(
  socket: Socket,
  event: string,
  predicate?: (payload: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(
        new Error(
          `waitForSocketEvent: "${event}" not observed within ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    function handler(payload: T): void {
      if (predicate && !predicate(payload)) {
        return;
      }
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

interface ConnectOptions {
  // P6 contract D21 primary path: the token travels inside the Engine.IO/socket.io CONNECT
  // packet payload itself, not as an HTTP header — transport-agnostic by construction.
  authToken?: string;
  // The convenience fallback this suite exists to verify "for real" (see the dedicated describe
  // block below) rather than merely in theory.
  headerToken?: string;
  transports?: string[];
}

describe('Notifications Gateway (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let baseUrl: string;
  let categoryId: string;
  let createdFallbackCategoryId: string | null = null;
  let adminTokens: AuthResponseBody;
  let ownerTokens: AuthResponseBody;
  let techA: TechnicianResponseBody;
  let techATokens: AuthResponseBody;
  let techB: TechnicianResponseBody;
  let techBTokens: AuthResponseBody;

  // §9 (`docs/plan-P6-contracts.md`): the mail queue PRODUCER is doubled, exactly like every
  // other P6 e2e suite — this suite never opens a real SMTP connection, even though assigning a
  // ticket also enqueues an email (P6 contract §5) alongside the in-app/WS notification this
  // suite actually exercises.
  const mailQueueMock = {
    enqueue: jest
      .fn<Promise<void>, [MailMessage]>()
      .mockResolvedValue(undefined),
  };

  // Every socket opened by any test, closed unconditionally in `afterAll` — the brief's own
  // explicit warning: leaked socket.io connections keep timers/handles alive and jest will not
  // return control without `--forceExit`, which is forbidden.
  const openSockets: Socket[] = [];

  function trackSocket(socket: Socket): Socket {
    openSockets.push(socket);
    return socket;
  }

  function connectSocket(options: ConnectOptions = {}): Socket {
    return trackSocket(
      io(`${baseUrl}/notifications`, {
        ...(options.authToken !== undefined
          ? { auth: { token: options.authToken } }
          : {}),
        ...(options.headerToken !== undefined
          ? { extraHeaders: { Authorization: `Bearer ${options.headerToken}` } }
          : {}),
        ...(options.transports ? { transports: options.transports } : {}),
        // Every client below is deliberately short-lived and scoped to a single test — automatic
        // reconnection would only add non-deterministic background activity (including repeated
        // connect attempts after a server-initiated `disconnect(true)`) that this suite has no
        // use for and that could keep handles alive past a test's own assertions.
        reconnection: false,
        forceNew: true,
        timeout: 5000,
      }),
    );
  }

  async function createTechnician(
    username: string,
  ): Promise<TechnicianResponseBody> {
    const res = await request(app.getHttpServer())
      .post('/api/technicians')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({
        username,
        email: `${username}@test.local`,
        password: TECH_PASSWORD,
      })
      .expect(201);
    return res.body as TechnicianResponseBody;
  }

  async function loginAs(
    identifier: string,
    password: string,
  ): Promise<AuthResponseBody> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier, password })
      .expect(200);
    return res.body as AuthResponseBody;
  }

  async function createOwnerTicket(title: string): Promise<TicketResponseBody> {
    const res = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
      .send({
        title,
        description: 'Ticket créé pour la suite e2e de la gateway.',
        categoryId,
      })
      .expect(201);
    return res.body as TicketResponseBody;
  }

  async function assignTicketTo(
    ticketId: string,
    technicianId: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ technicianId })
      .expect(200);
  }

  async function cleanupFixtures(ds: DataSource): Promise<void> {
    // Same dependency order as `notifications.e2e-spec.ts`'s own cleanup (documented there):
    // notifications -> ticket_comments/ticket_assignments/ticket_status_history ->
    // technician_skills -> technician_profiles -> tickets -> users.
    await ds.query(
      `DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      ['ntg_e2e_%'],
    );
    await ds.query(
      `DELETE FROM ticket_comments
       WHERE ticket_id IN (
         SELECT id FROM tickets
         WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
            OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
       )`,
      ['ntg_e2e_%'],
    );
    await ds.query(
      `DELETE FROM ticket_assignments
       WHERE ticket_id IN (
         SELECT id FROM tickets
         WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
            OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
       )`,
      ['ntg_e2e_%'],
    );
    await ds.query(
      `DELETE FROM ticket_status_history
       WHERE ticket_id IN (
         SELECT id FROM tickets
         WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
            OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)
       )`,
      ['ntg_e2e_%'],
    );
    await ds.query(
      `DELETE FROM technician_skills
       WHERE technician_profile_id IN (
         SELECT tp.id FROM technician_profiles tp
         JOIN users u ON u.id = tp.user_id
         WHERE u.username LIKE $1
       )`,
      ['ntg_e2e_%'],
    );
    await ds.query(
      `DELETE FROM technician_profiles
       WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      ['ntg_e2e_%'],
    );
    await ds.query(
      `DELETE FROM tickets
       WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)
          OR assignee_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      ['ntg_e2e_%'],
    );
    await ds.query('DELETE FROM users WHERE username LIKE $1', ['ntg_e2e_%']);
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

    // Unlike every other e2e suite here, this one needs a REAL bound TCP port: `socket.io-client`
    // opens an actual network connection, it cannot ride on supertest's per-request ephemeral
    // server the way plain HTTP assertions do. `NotificationsGateway` has no explicit `port` in
    // its `@WebSocketGateway()` options (confirmed by reading `@nestjs/websockets`' own
    // `web-sockets-controller.js`: it defaults to `0`), so Nest's `IoAdapter` attaches socket.io
    // directly to this SAME underlying `http.Server` — one port for REST and WS both, exactly
    // like the real deployment (`main.ts`, untouched by this suite).
    await app.listen(0);
    // `INestApplication.getHttpServer()` is typed `any` — cast to the real underlying Node
    // `http.Server` this app was actually built on (`createServer()`/`initHttpServer()` in
    // `@nestjs/core`), instead of leaving `.address()` as an unsafe `any` call.
    const httpServer = app.getHttpServer() as HttpServer;
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

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
          name: 'Notifications Gateway E2E Fallback Category',
          isActive: true,
        }),
      );
      categoryId = created.id;
      createdFallbackCategoryId = created.id;
    }

    ownerTokens = await (async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(OWNER)
        .expect(201);
      return res.body as AuthResponseBody;
    })();

    const usersService = app.get(UsersService);
    const adminHash = await argon2.hash(ADMIN.password);
    await usersService.create({
      username: ADMIN.username,
      email: ADMIN.email,
      passwordHash: adminHash,
      role: UserRole.ADMIN,
    });
    adminTokens = await loginAs(ADMIN.username, ADMIN.password);

    // `POST /auth/login` carries `@StrictLoginThrottle()` (P6 contract's own D13, 5 req/min —
    // `.env`'s `THROTTLE_LOGIN_LIMIT=5`) — a MUCH tighter budget than the 'default' throttler
    // every other e2e suite mostly exercises. The first run of this suite hit exactly this wall
    // (documented in the task report): six per-test `loginAs` calls tripped a `429` on the sixth.
    // techA/techB are therefore logged in ONCE here and reused by every test below that needs an
    // authenticated identity — 3 logins total for the whole file (admin + techA + techB), well
    // under the cap, and no `describe` needs its own technician anymore.
    techA = await createTechnician('ntg_e2e_tech_a');
    techATokens = await loginAs('ntg_e2e_tech_a', TECH_PASSWORD);
    techB = await createTechnician('ntg_e2e_tech_b');
    techBTokens = await loginAs('ntg_e2e_tech_b', TECH_PASSWORD);
  });

  afterEach(() => {
    mailQueueMock.enqueue.mockClear();
  });

  afterAll(async () => {
    for (const socket of openSockets) {
      socket.removeAllListeners();
      if (socket.connected) {
        socket.disconnect();
      }
      socket.close();
    }
    await cleanupFixtures(dataSource);
    if (createdFallbackCategoryId) {
      await dataSource.query('DELETE FROM categories WHERE id = $1', [
        createdFallbackCategoryId,
      ]);
    }
    await app.close();
  });

  describe('Authentication at handshake (P6 contract D21)', () => {
    it('disconnects a client that presents no token at all', async () => {
      const client = connectSocket();

      await waitForSocketEvent(client, 'disconnect');

      expect(client.connected).toBe(false);
      client.close();
    });

    it('disconnects a client presenting a well-formed but invalid token', async () => {
      const client = connectSocket({
        authToken: 'not-a-real-jwt-at-all',
      });

      await waitForSocketEvent(client, 'disconnect');

      expect(client.connected).toBe(false);
      client.close();
    });

    // The success path (a valid token accepted, then actually joined to the right room) is
    // proven below by the room-isolation test itself: both `techA` and `techB` connect with
    // `authToken` there and go on to receive/not-receive a real push. A third, standalone
    // "accepts a valid token" case would only re-assert the same fact with a fourth login call —
    // spending budget from the 5 req/min `login` throttle (see `beforeAll`'s own comment) for no
    // additional proof.
  });

  // THE test that matters (brief's own words): no unit-level mock can prove this, because a mock
  // of `Namespace.to(room)` cannot tell a correctly-scoped emit apart from a broadcast that
  // happens to still satisfy the mock's assertions on the SAME socket. Only two real,
  // independently-authenticated sockets can show that the second one genuinely never receives
  // what was pushed to the first.
  describe('Room isolation — the security invariant (P6 contract D21/D17)', () => {
    it('the recipient receives their own notification in real time, with the exact NotificationResponseDto shape as the REST API, and a second authenticated user does NOT receive it', async () => {
      const clientA = connectSocket({ authToken: techATokens.accessToken });
      const clientB = connectSocket({ authToken: techBTokens.accessToken });
      await Promise.all([
        waitForSocketEvent(clientA, 'connect'),
        waitForSocketEvent(clientB, 'connect'),
      ]);

      // Collected for the WHOLE test, not just a snapshot at the end — a late arrival during the
      // bounded wait below must be caught too, not just an arrival before the wait started.
      const receivedByB: NotificationEventBody[] = [];
      clientB.on(
        NOTIFICATION_CREATED_CLIENT_EVENT,
        (payload: NotificationEventBody) => receivedByB.push(payload),
      );

      const ticket = await createOwnerTicket(
        'Panne climatisation — isolation WS e2e',
      );
      const startedAt = Date.now();
      await assignTicketTo(ticket.id, techA.id);

      const notification = await waitForSocketEvent<NotificationEventBody>(
        clientA,
        NOTIFICATION_CREATED_CLIENT_EVENT,
        (n) => n.ticketId === ticket.id,
      );
      const elapsedForA = Date.now() - startedAt;

      expect(notification.type).toBe('TICKET_ASSIGNED');
      expect(notification.ticketId).toBe(ticket.id);
      expect(notification.ticketReference).toBe(ticket.reference);
      expect(notification.title).toBe(`Ticket ${ticket.reference} affecté`);
      expect(notification.body).toContain('vous a été affecté');
      expect(notification.readAt).toBeNull();

      // D21: "the exact same NotificationResponseDto the REST API returns" — not merely a
      // structurally similar object. Fetching techA's own list and matching by `id` proves it is
      // the SAME row, not just a payload that happens to look right.
      const restList = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${techATokens.accessToken}`)
        .expect(200);
      const restEntry = (
        restList.body as NotificationListResponseBody
      ).data.find((n) => n.id === notification.id);
      expect(restEntry).toEqual(notification);

      // Bound for B's non-reception window: a generous multiple of A's OWN measured delivery
      // time in THIS run, not an arbitrary guess. The dominant cost on this path is the real
      // Postgres INSERT inside `NotificationsService.persistAndEmit` (D4) — the WS push itself,
      // once `EventEmitter2.emit()` reaches `NotificationsGateway`, is a synchronous, in-process
      // `socket.io` send over a loopback socket, effectively instant next to that write.
      // `elapsedForA` was observed at low tens of milliseconds running this file alone, and up to
      // a few hundred ms under full-suite load (task report: some full-suite runs showed material
      // contention). A 10x multiple with a 500ms floor stays comfortably clear of either case (no
      // false negative if the room routing is broken); the 2000ms CEILING caps this test's own
      // contribution to worst-case suite duration without weakening the proof itself — even 500ms
      // is already one to two orders of magnitude past the slowest delivery actually observed.
      const nonReceptionWindowMs = Math.min(
        2000,
        Math.max(500, elapsedForA * 10),
      );
      await sleep(nonReceptionWindowMs);

      expect(receivedByB).toEqual([]);
      clientA.close();
      clientB.close();
    });
  });

  // The brief's explicit ask: verify — not assume — that `Authorization: Bearer <token>` (P6
  // contract D21's convenience fallback) actually authenticates a real `socket.io-client`
  // connection, over BOTH transports Engine.IO can pick, since headers are not guaranteed to
  // travel identically across them. `extraHeaders` is documented by `engine.io-client` as
  // applying "for each request to the server (via xhr-polling and via websockets)" — this
  // exercises that claim directly instead of trusting the doc comment.
  describe('Authorization header authentication, verified at transport level (P6 contract D21)', () => {
    it('authenticates via the Authorization header alone, forced onto the polling transport', async () => {
      // Reuses `techA`'s already-obtained token (`beforeAll`) instead of logging in a fresh
      // identity — see `beforeAll`'s own comment on the 5 req/min `login` throttle budget. This
      // test is about the AUTHENTICATION MECHANISM (header vs `auth.token`), not about a fresh
      // room; a second, later assignment to the same technician is exactly as valid a target.
      const client = connectSocket({
        headerToken: techATokens.accessToken,
        transports: ['polling'],
      });
      await waitForSocketEvent(client, 'connect');

      const ticket = await createOwnerTicket('Header auth — polling only');
      await assignTicketTo(ticket.id, techA.id);

      const notification = await waitForSocketEvent<NotificationEventBody>(
        client,
        NOTIFICATION_CREATED_CLIENT_EVENT,
        (n) => n.ticketId === ticket.id,
      );

      expect(notification.ticketId).toBe(ticket.id);
      expect(client.connected).toBe(true);
      client.close();
    });

    it('authenticates via the Authorization header alone, forced onto the websocket transport', async () => {
      const client = connectSocket({
        headerToken: techBTokens.accessToken,
        transports: ['websocket'],
      });
      await waitForSocketEvent(client, 'connect');

      const ticket = await createOwnerTicket('Header auth — websocket only');
      await assignTicketTo(ticket.id, techB.id);

      const notification = await waitForSocketEvent<NotificationEventBody>(
        client,
        NOTIFICATION_CREATED_CLIENT_EVENT,
        (n) => n.ticketId === ticket.id,
      );

      expect(notification.ticketId).toBe(ticket.id);
      expect(client.connected).toBe(true);
      client.close();
    });

    // The verdict this describe block exists to produce (see the task report for the summary):
    // BOTH tests above passing, repeatedly and non-flakily, is the empirical proof — over real
    // Node `xmlhttprequest-ssl`/`ws` transports, not a mock — that `extraHeaders` reaches
    // `NotificationsGateway.extractToken`'s `client.handshake.headers.authorization` read on
    // EITHER transport. If either one had proven unreliable, this comment (and the task report)
    // would say so instead, and the header path would need to be reconsidered.
    it('a header without the "Bearer " prefix is rejected exactly like an absent token', async () => {
      // `connectSocket`'s `headerToken` option always prefixes with "Bearer " (matching
      // production callers), so this one case is built directly to send a malformed scheme.
      const client = trackSocket(
        io(`${baseUrl}/notifications`, {
          extraHeaders: { Authorization: 'Basic something' },
          reconnection: false,
          forceNew: true,
          timeout: 5000,
        }),
      );

      await waitForSocketEvent(client, 'disconnect');

      expect(client.connected).toBe(false);
      client.close();
    });
  });
});
