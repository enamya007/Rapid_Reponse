import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { JwtConfig } from '../../config/jwt.config';
import { jwtConfig } from '../../config/jwt.config';
import { NotificationsGateway } from './notifications.gateway';
import type { GatewayNamespace, GatewaySocket } from './notifications.gateway';
import { NotificationCreatedEvent } from './events/notification-created.event';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { NotificationType } from './enums/notification-type.enum';

const MOCK_JWT_CONFIG: JwtConfig = {
  accessSecret: 'unit-test-access-secret',
  accessExpiresIn: '15m',
  refreshSecret: 'unit-test-refresh-secret',
  refreshExpiresIn: '7d',
};

// Minimal fake socket, matching exactly the (structural, `socket.io`-free — see
// `notifications.gateway.ts`'s own top-of-file comment) `GatewaySocket` contract
// `NotificationsGateway` relies on.
type FakeSocket = GatewaySocket & { join: jest.Mock; disconnect: jest.Mock };

function buildSocket(options: {
  authToken?: unknown;
  authorizationHeader?: string;
}): FakeSocket {
  return {
    handshake: {
      auth: options.authToken === undefined ? {} : { token: options.authToken },
      headers: { authorization: options.authorizationHeader },
    },
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  };
}

function buildNotification(): NotificationResponseDto {
  const dto = new NotificationResponseDto();
  dto.id = 'notification-1';
  dto.type = NotificationType.TICKET_ASSIGNED;
  dto.title = 'Ticket TCK-000123 affecté';
  dto.body = 'Le ticket « Panne » vous a été affecté.';
  dto.payload = { ticketId: 'ticket-1' };
  dto.ticketId = 'ticket-1';
  dto.ticketReference = 'TCK-000123';
  dto.readAt = null;
  dto.createdAt = '2026-01-01T00:00:00.000Z';
  return dto;
}

// P6 contract D21/D17 (`docs/plan-P6-contracts.md` §3). `server` is injected by Nest's platform
// adapter at runtime (never resolved through DI in tests) so it is assigned directly on the
// instance below, exactly like `@WebSocketServer()`-decorated properties are commonly exercised
// in isolation.
describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let toEmitMock: jest.Mock;
  let toMock: jest.Mock;
  let serverMock: GatewayNamespace;

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    toEmitMock = jest.fn();
    toMock = jest.fn().mockReturnValue({ emit: toEmitMock });
    serverMock = { to: toMock };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: jwtConfig.KEY, useValue: MOCK_JWT_CONFIG },
      ],
    }).compile();

    gateway = module.get(NotificationsGateway);
    // Same rationale as `notifications.gateway.ts`'s own comment on `@WebSocketServer()`: this
    // property is populated by the platform adapter outside of Nest's DI container, so tests
    // populate it directly instead of going through `TestingModule`.
    (gateway as unknown as { server: GatewayNamespace }).server = serverMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnection — authentication (P6 contract D21)', () => {
    it('joins the room "user:<sub>" for a token read from handshake.auth.token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        username: 'alice',
        role: 'CLIENT',
      });
      const client = buildSocket({ authToken: 'a-valid-token' });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('accepts a token read from the Authorization header as a fallback', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-2',
        username: 'bob',
        role: 'CLIENT',
      });
      const client = buildSocket({
        authorizationHeader: 'Bearer a-header-token',
      });

      await gateway.handleConnection(client);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(
        'a-header-token',
        expect.objectContaining({ secret: MOCK_JWT_CONFIG.accessSecret }),
      );
      expect(client.join).toHaveBeenCalledWith('user:user-2');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('prefers handshake.auth.token over the Authorization header when both are present', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-from-auth',
        username: 'x',
        role: 'CLIENT',
      });
      const client = buildSocket({
        authToken: 'auth-token',
        authorizationHeader: 'Bearer header-token',
      });

      await gateway.handleConnection(client);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(
        'auth-token',
        expect.anything(),
      );
    });

    it('verifies against jwtConfig.accessSecret — a token signed with the wrong secret is rejected by JwtService and disconnects', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      const client = buildSocket({ authToken: 'wrong-secret-token' });

      await gateway.handleConnection(client);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(
        'wrong-secret-token',
        { secret: MOCK_JWT_CONFIG.accessSecret },
      );
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects on an expired token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      const client = buildSocket({ authToken: 'expired-token' });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects on a malformed token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt malformed'));
      const client = buildSocket({ authToken: 'not-a-jwt' });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects immediately when no token is present at all, WITHOUT calling JwtService', async () => {
      const client = buildSocket({});

      await gateway.handleConnection(client);

      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('ignores an Authorization header without the "Bearer " prefix and disconnects', async () => {
      const client = buildSocket({ authorizationHeader: 'Basic something' });

      await gateway.handleConnection(client);

      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('ignores a non-string handshake.auth.token and disconnects', async () => {
      const client = buildSocket({ authToken: 12345 });

      await gateway.handleConnection(client);

      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleNotificationCreated — routing (P6 contract D17, security invariant)', () => {
    it('emits "notification.created" with the exact NotificationResponseDto, scoped to the recipient room ONLY', () => {
      const notification = buildNotification();
      const event: NotificationCreatedEvent = {
        recipientId: 'recipient-1',
        notification,
      };

      gateway.handleNotificationCreated(event);

      expect(toMock).toHaveBeenCalledWith('user:recipient-1');
      expect(toEmitMock).toHaveBeenCalledWith(
        'notification.created',
        notification,
      );
    });

    it('never targets a room derived from anything other than recipientId', () => {
      const event: NotificationCreatedEvent = {
        recipientId: 'recipient-2',
        notification: buildNotification(),
      };

      gateway.handleNotificationCreated(event);

      expect(toMock).toHaveBeenCalledTimes(1);
      expect(toMock).toHaveBeenCalledWith('user:recipient-2');
    });

    // Rule 4 of the brief, same reasoning as D3 for `NotificationsListener`: `EventEmitter2`
    // calls this synchronously on `NotificationsService`'s own call stack, so a throw here must
    // never escape.
    it('does not throw when the underlying emit fails', () => {
      toMock.mockImplementation(() => {
        throw new Error('namespace not ready');
      });
      const event: NotificationCreatedEvent = {
        recipientId: 'recipient-3',
        notification: buildNotification(),
      };

      expect(() => gateway.handleNotificationCreated(event)).not.toThrow();
    });
  });
});
