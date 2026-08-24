import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { appConfig } from '../../config/app.config';
import { NOTIFICATION_CREATED } from '../../common/events/notification-events';
import {
  TicketAssignedEvent,
  TicketCommentedEvent,
  TicketCreatedEvent,
  TicketStatusChangedEvent,
} from '../../common/events/ticket-events';
import { CommentVisibility } from '../tickets/enums/comment-visibility.enum';
import { TicketStatus } from '../tickets/enums/ticket-status.enum';
import { MailQueueService } from '../mail/mail-queue.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationsService } from './notifications.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.username = 'user1';
  user.email = 'user1@example.com';
  user.role = UserRole.CLIENT;
  user.isActive = true;
  user.deletedAt = null;
  Object.assign(user, overrides);
  return user;
}

function buildTicketCreatedEvent(
  overrides: Partial<TicketCreatedEvent> = {},
): TicketCreatedEvent {
  return {
    ticketId: 'ticket-1',
    reference: 'TCK-000123',
    title: 'Panne de climatisation',
    actorId: 'client-1',
    createdById: 'client-1',
    assigneeId: null,
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTicketAssignedEvent(
  overrides: Partial<TicketAssignedEvent> = {},
): TicketAssignedEvent {
  return {
    ticketId: 'ticket-1',
    reference: 'TCK-000123',
    title: 'Panne de climatisation',
    actorId: 'admin-1',
    createdById: 'client-1',
    assigneeId: 'tech-1',
    previousAssigneeId: null,
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTicketStatusChangedEvent(
  overrides: Partial<TicketStatusChangedEvent> = {},
): TicketStatusChangedEvent {
  return {
    ticketId: 'ticket-1',
    reference: 'TCK-000123',
    title: 'Panne de climatisation',
    actorId: 'tech-1',
    createdById: 'client-1',
    assigneeId: 'tech-1',
    fromStatus: TicketStatus.ASSIGNED,
    toStatus: TicketStatus.IN_PROGRESS,
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTicketCommentedEvent(
  overrides: Partial<TicketCommentedEvent> = {},
): TicketCommentedEvent {
  return {
    ticketId: 'ticket-1',
    reference: 'TCK-000123',
    title: 'Panne de climatisation',
    actorId: 'tech-1',
    createdById: 'client-1',
    assigneeId: 'tech-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
    commentId: 'comment-1',
    visibility: CommentVisibility.PUBLIC,
    authorId: 'tech-1',
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  let userRepo: { find: jest.Mock; findOne: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let mailQueueService: { enqueue: jest.Mock };
  let notificationIdCounter: number;
  let usersDb: User[];

  beforeEach(async () => {
    notificationIdCounter = 0;
    usersDb = [];

    notificationRepo = {
      create: jest.fn((data: Partial<Notification>) => ({
        ...data,
      })) as jest.Mock,
      save: jest.fn((entity: Partial<Notification>) => {
        notificationIdCounter += 1;
        return Promise.resolve({
          ...entity,
          id: `notif-${notificationIdCounter}`,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          readAt: null,
        } as Notification);
      }),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    };

    // A minimal in-memory "table": `find` inspects the shape of `where` rather than the
    // internal representation of TypeORM's `In()`/`FindOperator`, so it stays correct even if
    // the service's own query shape changes slightly (e.g. adding another `where` field).
    userRepo = {
      find: jest.fn((options: { where: Record<string, unknown> }) => {
        const { where } = options;
        if (where.role !== undefined) {
          return Promise.resolve(
            usersDb.filter((user) => user.role === where.role),
          );
        }
        if (where.id !== undefined) {
          const operator = where.id as { value: string[] };
          const ids = new Set(operator.value);
          return Promise.resolve(usersDb.filter((user) => ids.has(user.id)));
        }
        return Promise.resolve([]);
      }),
      findOne: jest.fn(),
    };

    eventEmitter = { emit: jest.fn() };
    mailQueueService = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(Notification),
          useValue: notificationRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: MailQueueService, useValue: mailQueueService },
        {
          provide: appConfig.KEY,
          useValue: { frontendUrl: 'https://app.example.test' },
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ticket.created (P6 contract §5)', () => {
    it('notifies every active ADMIN, and enqueues no email', async () => {
      usersDb = [
        buildUser({ id: 'admin-1', role: UserRole.ADMIN }),
        buildUser({ id: 'admin-2', role: UserRole.ADMIN }),
        buildUser({ id: 'client-1', role: UserRole.CLIENT }),
      ];

      await service.handleTicketCreated(
        buildTicketCreatedEvent({ actorId: 'client-1' }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds.sort()).toEqual(['admin-1', 'admin-2']);
      expect(mailQueueService.enqueue).not.toHaveBeenCalled();
      for (const call of notificationRepo.create.mock.calls as Array<
        [Partial<Notification>]
      >) {
        expect(call[0].type).toBe(NotificationType.TICKET_CREATED);
      }
    });

    it('excludes the actor (D8) even when the actor is itself an ADMIN', async () => {
      usersDb = [
        buildUser({ id: 'admin-1', role: UserRole.ADMIN }),
        buildUser({ id: 'admin-2', role: UserRole.ADMIN }),
      ];

      await service.handleTicketCreated(
        buildTicketCreatedEvent({ actorId: 'admin-1' }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds).toEqual(['admin-2']);
    });

    it('excludes an inactive ADMIN account', async () => {
      usersDb = [
        buildUser({ id: 'admin-1', role: UserRole.ADMIN, isActive: true }),
        buildUser({ id: 'admin-2', role: UserRole.ADMIN, isActive: false }),
      ];

      await service.handleTicketCreated(buildTicketCreatedEvent());

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds).toEqual(['admin-1']);
    });

    it("defensively truncates a notification body/title over 150 chars (column limit on `title`; the body copies the ticket's own title for this type)", async () => {
      usersDb = [buildUser({ id: 'admin-1', role: UserRole.ADMIN })];
      const longTitle = 'x'.repeat(200);
      const longReference = 'TCK-' + '0'.repeat(200);

      await service.handleTicketCreated(
        buildTicketCreatedEvent({ title: longTitle, reference: longReference }),
      );

      const [call] = notificationRepo.create.mock.calls as Array<
        [Partial<Notification>]
      >;
      expect(call[0].title?.length).toBeLessThanOrEqual(150);
      expect(call[0].body?.length).toBeLessThanOrEqual(150);
    });
  });

  describe('ticket.assigned (P6 contract §5)', () => {
    it('notifies only the new assignee on a first assignment, and enqueues an email to them', async () => {
      usersDb = [buildUser({ id: 'tech-1', role: UserRole.TECHNICIAN })];

      await service.handleTicketAssigned(
        buildTicketAssignedEvent({
          assigneeId: 'tech-1',
          previousAssigneeId: null,
        }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds).toEqual(['tech-1']);
      expect(mailQueueService.enqueue).toHaveBeenCalledTimes(1);
      expect(mailQueueService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user1@example.com' }),
      );
    });

    it('on a reassignment, notifies BOTH technicians in-app, but emails ONLY the new assignee', async () => {
      usersDb = [
        buildUser({
          id: 'tech-new',
          role: UserRole.TECHNICIAN,
          email: 'new@example.com',
        }),
        buildUser({
          id: 'tech-old',
          role: UserRole.TECHNICIAN,
          email: 'old@example.com',
        }),
      ];

      await service.handleTicketAssigned(
        buildTicketAssignedEvent({
          assigneeId: 'tech-new',
          previousAssigneeId: 'tech-old',
        }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds.sort()).toEqual(['tech-new', 'tech-old']);
      expect(mailQueueService.enqueue).toHaveBeenCalledTimes(1);
      expect(mailQueueService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'new@example.com' }),
      );
    });

    it('excludes the actor (D8) — an ADMIN reassigning is never notified of their own action', async () => {
      usersDb = [buildUser({ id: 'admin-1', role: UserRole.ADMIN })];

      await service.handleTicketAssigned(
        buildTicketAssignedEvent({
          actorId: 'admin-1',
          assigneeId: 'admin-1',
          previousAssigneeId: null,
        }),
      );

      expect(notificationRepo.create).not.toHaveBeenCalled();
      expect(mailQueueService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('ticket.status-changed (P6 contract §5)', () => {
    it('notifies and emails BOTH the owning client and the assignee', async () => {
      usersDb = [
        buildUser({
          id: 'client-1',
          role: UserRole.CLIENT,
          email: 'client@example.com',
        }),
        buildUser({
          id: 'tech-1',
          role: UserRole.TECHNICIAN,
          email: 'tech@example.com',
        }),
      ];

      await service.handleTicketStatusChanged(
        buildTicketStatusChangedEvent({
          actorId: 'admin-1',
          createdById: 'client-1',
          assigneeId: 'tech-1',
        }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds.sort()).toEqual(['client-1', 'tech-1']);
      expect(mailQueueService.enqueue).toHaveBeenCalledTimes(2);
    });

    it('de-duplicates by userId when the owning client and the assignee are the same user', async () => {
      usersDb = [buildUser({ id: 'same-user', role: UserRole.CLIENT })];

      await service.handleTicketStatusChanged(
        buildTicketStatusChangedEvent({
          actorId: 'admin-1',
          createdById: 'same-user',
          assigneeId: 'same-user',
        }),
      );

      expect(notificationRepo.create).toHaveBeenCalledTimes(1);
      expect(mailQueueService.enqueue).toHaveBeenCalledTimes(1);
    });

    it('excludes the actor (D8) — the technician who started their own ticket is not notified of it', async () => {
      usersDb = [
        buildUser({ id: 'client-1', role: UserRole.CLIENT }),
        buildUser({ id: 'tech-1', role: UserRole.TECHNICIAN }),
      ];

      await service.handleTicketStatusChanged(
        buildTicketStatusChangedEvent({
          actorId: 'tech-1',
          createdById: 'client-1',
          assigneeId: 'tech-1',
        }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds).toEqual(['client-1']);
    });
  });

  describe('ticket.commented — PUBLIC (P6 contract §5)', () => {
    it('notifies and emails BOTH the owning client and the assignee', async () => {
      usersDb = [
        buildUser({ id: 'client-1', role: UserRole.CLIENT }),
        buildUser({ id: 'tech-1', role: UserRole.TECHNICIAN }),
      ];

      await service.handleTicketCommented(
        buildTicketCommentedEvent({
          visibility: CommentVisibility.PUBLIC,
          actorId: 'tech-1',
          createdById: 'client-1',
          assigneeId: 'tech-1',
        }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      // The actor (the assignee who wrote the comment) is excluded (D8).
      expect(recipientIds).toEqual(['client-1']);
      expect(mailQueueService.enqueue).toHaveBeenCalledTimes(1);
    });

    it('never carries the comment body (D6) — the notification body is the fixed sentence', async () => {
      usersDb = [buildUser({ id: 'client-1', role: UserRole.CLIENT })];

      await service.handleTicketCommented(
        buildTicketCommentedEvent({
          visibility: CommentVisibility.PUBLIC,
          actorId: 'tech-1',
          createdById: 'client-1',
          assigneeId: 'tech-1',
        }),
      );

      const [call] = notificationRepo.create.mock.calls as Array<
        [Partial<Notification>]
      >;
      expect(call[0].body).toBe(
        'Un commentaire a été ajouté au ticket « Panne de climatisation ».',
      );
    });
  });

  describe('ticket.commented — INTERNAL (P6 contract §5, D6, D7)', () => {
    it('notifies the assignee and every active ADMIN, and enqueues no email', async () => {
      usersDb = [
        buildUser({ id: 'tech-1', role: UserRole.TECHNICIAN }),
        buildUser({ id: 'admin-1', role: UserRole.ADMIN }),
        buildUser({ id: 'admin-2', role: UserRole.ADMIN }),
      ];

      await service.handleTicketCommented(
        buildTicketCommentedEvent({
          visibility: CommentVisibility.INTERNAL,
          actorId: 'admin-1',
          createdById: 'client-1',
          assigneeId: 'tech-1',
        }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds.sort()).toEqual(['admin-2', 'tech-1']);
      expect(mailQueueService.enqueue).not.toHaveBeenCalled();
    });

    // D7 — the invariant of this task, and the mandatory mutation target (§9). This is the
    // "leak" scenario: a CLIENT-role id somehow present among the resolved candidates (however
    // that happened) must NEVER receive an INTERNAL comment notification. Proven at the unit
    // level directly against a CLIENT-role user, since NO legitimate `assigneeId`/admin lookup
    // can itself produce one under the current business rules — this is exactly what makes D7 a
    // defense-in-depth invariant rather than an emergent property of the base list.
    //
    // MUTATION PROOF (documented in the task report): commenting out the
    // `!filterClientRole || user.role !== UserRole.CLIENT` clause in
    // `NotificationsService.resolveRecipients` (i.e. always keeping the recipient regardless of
    // role) turns THIS test red — `recipientIds` then includes `'leaked-client'`.
    it('D7 — strips a CLIENT-role recipient from the resolved list even if it were present as a candidate', async () => {
      usersDb = [
        buildUser({ id: 'leaked-client', role: UserRole.CLIENT }),
        buildUser({ id: 'admin-1', role: UserRole.ADMIN }),
      ];

      // `assigneeId` here stands in for however a CLIENT-role id could end up as a candidate —
      // the filter must not trust the caller's assumption that it can only ever be a technician.
      await service.handleTicketCommented(
        buildTicketCommentedEvent({
          visibility: CommentVisibility.INTERNAL,
          actorId: 'admin-1',
          createdById: 'someone-else',
          assigneeId: 'leaked-client',
        }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds).not.toContain('leaked-client');
    });

    it('the owning CLIENT never appears among INTERNAL recipients through the normal base list (leak sanity check)', async () => {
      usersDb = [
        buildUser({ id: 'client-1', role: UserRole.CLIENT }),
        buildUser({ id: 'tech-1', role: UserRole.TECHNICIAN }),
      ];

      await service.handleTicketCommented(
        buildTicketCommentedEvent({
          visibility: CommentVisibility.INTERNAL,
          actorId: 'tech-1',
          createdById: 'client-1',
          assigneeId: 'tech-1',
        }),
      );

      const recipientIds = notificationRepo.create.mock.calls.map(
        (call: [Partial<Notification>]) => call[0].recipientId,
      );
      expect(recipientIds).not.toContain('client-1');
    });
  });

  describe('NOTIFICATION_CREATED (D17)', () => {
    it('is emitted once per persisted notification, AFTER the row is saved, carrying recipientId and the rendered DTO', async () => {
      usersDb = [buildUser({ id: 'admin-1', role: UserRole.ADMIN })];
      const saveOrder: string[] = [];
      const emitOrder: string[] = [];
      notificationRepo.save.mockImplementation(
        (entity: Partial<Notification>) => {
          notificationIdCounter += 1;
          saveOrder.push('save');
          return Promise.resolve({
            ...entity,
            id: `notif-${notificationIdCounter}`,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            readAt: null,
          } as Notification);
        },
      );
      eventEmitter.emit.mockImplementation(() => {
        emitOrder.push('emit');
        return true;
      });

      await service.handleTicketCreated(buildTicketCreatedEvent());

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      const [eventName, payload] = eventEmitter.emit.mock.calls[0] as [
        string,
        { recipientId: string; notification: { id: string; type: string } },
      ];
      expect(eventName).toBe(NOTIFICATION_CREATED);
      expect(payload.recipientId).toBe('admin-1');
      expect(payload.notification.id).toBe('notif-1');
      expect(payload.notification.type).toBe(NotificationType.TICKET_CREATED);
      // `save` for that recipient happened strictly before the corresponding `emit` (D17: "after
      // persistence").
      expect(saveOrder).toEqual(['save']);
      expect(emitOrder).toEqual(['emit']);
      expect(notificationRepo.save.mock.invocationCallOrder[0]).toBeLessThan(
        eventEmitter.emit.mock.invocationCallOrder[0],
      );
    });
  });
});
