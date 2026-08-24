import { Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { jwtConfig } from '../../config/jwt.config';
import type { JwtConfig } from '../../config/jwt.config';
import { NOTIFICATION_CREATED } from '../../common/events/notification-events';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import type { NotificationCreatedEvent } from './events/notification-created.event';

/**
 * Server -> client event name (P6 contract D21, `docs/plan-P6-contracts.md` §3), carrying the
 * exact same `NotificationResponseDto` the REST API returns — one shape, not two.
 *
 * Exported so `test/notifications-gateway.e2e-spec.ts` listens for the exact same string instead
 * of duplicating it as a second literal that could drift out of sync.
 */
export const NOTIFICATION_CREATED_CLIENT_EVENT = 'notification.created';

// Minimal STRUCTURAL types for the only pieces of the `socket.io` `Socket`/`Namespace` API this
// gateway touches.
//
// `socket.io` is only a TRANSITIVE dependency here (of `@nestjs/platform-socket.io` — P6 contract
// §2, `docs/plan-P6-contracts.md`), and under this project's default pnpm `node_modules` layout,
// transitive packages are not resolvable as import targets from application code: `import type {
// Socket, Namespace } from 'socket.io'` fails `tsc` with `TS2307: Cannot find module`, confirmed
// by actually attempting it. `@nestjs/platform-socket.io`'s OWN `.d.ts` (`adapters/io-adapter.d.ts`)
// has the identical `from 'socket.io'` import and does not error only because nothing in this
// project reached it before this file — `skipLibCheck` (`tsconfig.json`) skips checking
// `node_modules` `.d.ts` files, not application source, so the moment application code imports
// the type itself, resolution is attempted for real and fails. This is reported to the
// orchestrator (task report) as a P6 §2 dependency-declaration gap, structurally identical to the
// `ioredis`/`bullmq@6` one already documented there — resolved here WITHOUT adding `socket.io` as
// a direct dependency, since these two interfaces are all this file needs and the real objects
// `@nestjs/platform-socket.io`'s adapter passes in at runtime satisfy them structurally.
// Exported so `notifications.gateway.spec.ts` can build fakes against the exact same contract
// this class relies on, instead of casting through `any`/`never` at the call site.
export interface GatewaySocket {
  readonly handshake: {
    readonly auth: { readonly [key: string]: unknown };
    readonly headers: { readonly authorization?: string };
  };
  join(room: string): Promise<void> | void;
  disconnect(close?: boolean): void;
}

export interface GatewayNamespace {
  to(room: string): { emit(event: string, payload: unknown): boolean };
}

function roomFor(userId: string): string {
  return `user:${userId}`;
}

// P6 contract D21/D17 (`docs/plan-P6-contracts.md` §3). This gateway does two things ONLY:
//
// 1. Authenticate the socket at handshake time and join it to a per-user room.
// 2. Relay `NOTIFICATION_CREATED` (emitted by `NotificationsService` after persistence) to that
//    room.
//
// D17 is the reason this class never imports `NotificationsService`/`NotificationsListener` and
// is never imported by them: it only knows the event NAME (`common/events/notification-events.ts`)
// and the payload TYPE (`./events/notification-created.event.ts`), both already shared contracts.
// Removing this file leaves the REST API and the ticket->notification fan-out fully functional —
// the reverse is also true: this gateway does not care how a `NOTIFICATION_CREATED` event was
// produced.
//
// No `@SubscribeMessage` handler is declared anywhere in this class, on purpose: the contract is
// explicit that the gateway accepts no client -> server command of any kind.
@WebSocketGateway({ namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayConnection<GatewaySocket> {
  // `@WebSocketServer()` injects the NAMESPACE object here, not the root `Server` — Nest's
  // `IoAdapter.create()` calls `.of(namespace)` whenever `namespace` is set in the decorator
  // options (verified by reading `@nestjs/platform-socket.io`'s `io-adapter.js`), and a
  // namespace is what actually exposes `.to(room).emit(...)` scoped to `/notifications`.
  @WebSocketServer()
  private readonly server!: GatewayNamespace;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY) private readonly jwtConfigValue: JwtConfig,
  ) {}

  // P6 contract D21: token read from `handshake.auth.token` (primary path) or the `Authorization`
  // header (a convenience — see `extractToken`'s own comment on why it cannot be the primary
  // path). Verified with `jwtConfig.accessSecret`, exactly the secret `JwtStrategy` verifies HTTP
  // access tokens with (`src/modules/auth/strategies/jwt.strategy.ts`) — reused, not
  // reimplemented. No tolerance, no degraded "connected without a room" mode: any failure below
  // disconnects immediately.
  async handleConnection(client: GatewaySocket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.jwtConfigValue.accessSecret,
      });
      // The security invariant of this task: a socket only ever joins ITS OWN user's room,
      // keyed on `sub` — the same claim `JwtStrategy` resolves a `User` from for HTTP requests.
      // Nothing else in the payload (e.g. `username`) is an acceptable substitute: unlike `sub`,
      // it is not guaranteed immutable/unique for the account's lifetime.
      await client.join(roomFor(payload.sub));
    } catch {
      // Malformed, expired, wrong-secret, or any other `jsonwebtoken` verification failure all
      // collapse to the same outcome — the contract draws no distinction between them.
      client.disconnect(true);
    }
  }

  // Relays a persisted notification (P6 contract D17) to the recipient's room ONLY. Routing by
  // room, rather than a global `emit` filtered on the client, is the actual security boundary:
  // a global emit would hand every connected socket every other user's notifications over the
  // wire, and would depend entirely on a well-behaved client to ignore them.
  //
  // Wrapped defensively, matching the "a listener must never throw" discipline the ticket-event
  // listeners already follow (D3, `NotificationsListener`) for the same underlying reason:
  // `EventEmitter2` invokes this synchronously on `NotificationsService`'s own call stack, so an
  // uncaught error here could surface all the way back to the HTTP request that triggered the
  // notification.
  @OnEvent(NOTIFICATION_CREATED)
  handleNotificationCreated(event: NotificationCreatedEvent): void {
    try {
      this.server
        .to(roomFor(event.recipientId))
        .emit(NOTIFICATION_CREATED_CLIENT_EVENT, event.notification);
    } catch (error) {
      this.logger.error(
        `Failed to push a realtime notification to recipient ${event.recipientId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  // `handshake.auth.token` is the documented, primary path (works identically over polling and
  // websocket transports, since it travels in the Engine.IO handshake payload itself rather than
  // as an HTTP header). The `Authorization` header is read as a best-effort convenience on top of
  // it — see this task's own report for why it cannot be promoted to primary.
  private extractToken(client: GatewaySocket): string | undefined {
    const authToken: unknown = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }

    return undefined;
  }
}
