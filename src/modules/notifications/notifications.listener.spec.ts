import { Test, TestingModule } from '@nestjs/testing';
import {
  TicketAssignedEvent,
  TicketCommentedEvent,
  TicketCreatedEvent,
  TicketStatusChangedEvent,
} from '../../common/events/ticket-events';
import { CommentVisibility } from '../tickets/enums/comment-visibility.enum';
import { TicketStatus } from '../tickets/enums/ticket-status.enum';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

function buildTicketCreatedEvent(): TicketCreatedEvent {
  return {
    ticketId: 'ticket-1',
    reference: 'TCK-000123',
    title: 'Panne de climatisation',
    actorId: 'client-1',
    createdById: 'client-1',
    assigneeId: null,
    occurredAt: '2026-01-01T00:00:00.000Z',
  };
}

function buildTicketAssignedEvent(): TicketAssignedEvent {
  return {
    ...buildTicketCreatedEvent(),
    assigneeId: 'tech-1',
    previousAssigneeId: null,
  };
}

function buildTicketStatusChangedEvent(): TicketStatusChangedEvent {
  return {
    ...buildTicketCreatedEvent(),
    assigneeId: 'tech-1',
    fromStatus: TicketStatus.ASSIGNED,
    toStatus: TicketStatus.IN_PROGRESS,
  };
}

function buildTicketCommentedEvent(): TicketCommentedEvent {
  return {
    ...buildTicketCreatedEvent(),
    assigneeId: 'tech-1',
    commentId: 'comment-1',
    visibility: CommentVisibility.PUBLIC,
    authorId: 'tech-1',
  };
}

// D3 (`docs/plan-P6-contracts.md` §3): the whole point of this listener is that a throwing
// `NotificationsService` must never surface past it — `EventEmitter2` runs listeners
// synchronously on the emitter's own call stack, so an uncaught rejection here would fail the
// HTTP request that already succeeded (ticket created/assigned/commented). Every test below
// makes `NotificationsService` throw/reject and asserts the listener's promise still resolves.
describe('NotificationsListener (D3 — never propagates)', () => {
  let listener: NotificationsListener;
  let notificationsService: {
    handleTicketCreated: jest.Mock;
    handleTicketAssigned: jest.Mock;
    handleTicketStatusChanged: jest.Mock;
    handleTicketCommented: jest.Mock;
  };

  beforeEach(async () => {
    notificationsService = {
      handleTicketCreated: jest.fn(),
      handleTicketAssigned: jest.fn(),
      handleTicketStatusChanged: jest.fn(),
      handleTicketCommented: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsListener,
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    listener = module.get(NotificationsListener);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('handleTicketCreated: a rejected service call does not propagate', async () => {
    notificationsService.handleTicketCreated.mockRejectedValue(
      new Error('DB is down'),
    );

    await expect(
      listener.handleTicketCreated(buildTicketCreatedEvent()),
    ).resolves.toBeUndefined();
  });

  it('handleTicketAssigned: a rejected service call does not propagate', async () => {
    notificationsService.handleTicketAssigned.mockRejectedValue(
      new Error('DB is down'),
    );

    await expect(
      listener.handleTicketAssigned(buildTicketAssignedEvent()),
    ).resolves.toBeUndefined();
  });

  it('handleTicketStatusChanged: a rejected service call does not propagate', async () => {
    notificationsService.handleTicketStatusChanged.mockRejectedValue(
      new Error('DB is down'),
    );

    await expect(
      listener.handleTicketStatusChanged(buildTicketStatusChangedEvent()),
    ).resolves.toBeUndefined();
  });

  it('handleTicketCommented: a rejected service call does not propagate', async () => {
    notificationsService.handleTicketCommented.mockRejectedValue(
      new Error('DB is down'),
    );

    await expect(
      listener.handleTicketCommented(buildTicketCommentedEvent()),
    ).resolves.toBeUndefined();
  });

  it('handleTicketCreated: a SYNCHRONOUSLY thrown error (not just a rejected promise) still does not propagate', async () => {
    notificationsService.handleTicketCreated.mockImplementation(() => {
      throw new Error('synchronous boom');
    });

    await expect(
      listener.handleTicketCreated(buildTicketCreatedEvent()),
    ).resolves.toBeUndefined();
  });

  it('delegates to the service with the exact event payload when it succeeds', async () => {
    notificationsService.handleTicketCreated.mockResolvedValue(undefined);
    const event = buildTicketCreatedEvent();

    await listener.handleTicketCreated(event);

    expect(notificationsService.handleTicketCreated).toHaveBeenCalledWith(
      event,
    );
  });
});
