import { Test, TestingModule } from '@nestjs/testing';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.username = 'user1';
  user.email = 'user1@example.com';
  user.role = UserRole.CLIENT;
  user.isActive = true;
  Object.assign(user, overrides);
  return user;
}

// Thin wiring tests: RBAC/scoping itself is exercised in `test/notifications.e2e-spec.ts`
// against the real `@Auth()`/`RolesGuard` stack. What matters here is that D16 scoping
// (`recipientId = currentUser.id`) is threaded through from `@CurrentUser()` on every route, and
// that the route order/HTTP semantics (204 for the two `PATCH` routes) match the P6 contract §7.
describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: {
    list: jest.Mock;
    unreadCount: jest.Mock;
    markAllRead: jest.Mock;
    markRead: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      unreadCount: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();

    controller = module.get(NotificationsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('list() calls NotificationsService.list with the query AND the CALLER id (D16), never a query-supplied id', async () => {
    const user = buildUser({ id: 'caller-id' });
    const query: NotificationQueryDto = { page: 1, limit: 20 };
    const expected = new PaginatedResponseDto<NotificationResponseDto>();
    service.list.mockResolvedValue(expected);

    const result = await controller.list(query, user);

    expect(service.list).toHaveBeenCalledWith(query, 'caller-id');
    expect(result).toBe(expected);
  });

  it('unreadCount() calls NotificationsService.unreadCount with the caller id and returns its DTO', async () => {
    const user = buildUser({ id: 'caller-id' });
    const dto = new UnreadCountResponseDto();
    dto.count = 4;
    service.unreadCount.mockResolvedValue(dto);

    const result = await controller.unreadCount(user);

    expect(service.unreadCount).toHaveBeenCalledWith('caller-id');
    expect(result).toBe(dto);
  });

  it('readAll() calls NotificationsService.markAllRead with the caller id', async () => {
    const user = buildUser({ id: 'caller-id' });

    await controller.readAll(user);

    expect(service.markAllRead).toHaveBeenCalledWith('caller-id');
  });

  it('markRead() calls NotificationsService.markRead with the route id AND the caller id, never trusting a body-supplied recipient', async () => {
    const user = buildUser({ id: 'caller-id' });

    await controller.markRead('notif-id', user);

    expect(service.markRead).toHaveBeenCalledWith('notif-id', 'caller-id');
  });
});
