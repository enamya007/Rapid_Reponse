import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TICKET_ASSIGNED,
  TICKET_COMMENTED,
  TICKET_CREATED,
  TICKET_STATUS_CHANGED,
} from '../../common/events/ticket-events';
import type {
  TicketAssignedEvent,
  TicketCommentedEvent,
  TicketCreatedEvent,
  TicketStatusChangedEvent,
} from '../../common/events/ticket-events';
import { NotificationsService } from './notifications.service';

// D3 (`docs/plan-P6-contracts.md` §3): `EventEmitter2` calls every `@OnEvent` listener
// SYNCHRONOUSLY, on the emitter's own call stack. `TicketsService.create`/`assign`/
// `applyTransition` and `TicketCommentsService.create` have already committed and returned a
// successful HTTP response by the time they call `eventEmitter.emit(...)` -- a listener that
// throws here would turn that already-successful ticket/comment write into a failed HTTP
// request. Every handler below is therefore wrapped whole in a try/catch that only logs (via
// Nest's `Logger`, matching `MailProcessor`'s own pattern) and NEVER re-throws: a lost
// notification must never undo a successful business write.
//
// This class deliberately does nothing but catch and delegate -- all resolution/persistence
// logic lives in `NotificationsService`, which stays a plain, throwing, unit-testable service.
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(TICKET_CREATED)
  async handleTicketCreated(event: TicketCreatedEvent): Promise<void> {
    try {
      await this.notificationsService.handleTicketCreated(event);
    } catch (error) {
      this.logException(TICKET_CREATED, event.ticketId, error);
    }
  }

  @OnEvent(TICKET_ASSIGNED)
  async handleTicketAssigned(event: TicketAssignedEvent): Promise<void> {
    try {
      await this.notificationsService.handleTicketAssigned(event);
    } catch (error) {
      this.logException(TICKET_ASSIGNED, event.ticketId, error);
    }
  }

  @OnEvent(TICKET_STATUS_CHANGED)
  async handleTicketStatusChanged(
    event: TicketStatusChangedEvent,
  ): Promise<void> {
    try {
      await this.notificationsService.handleTicketStatusChanged(event);
    } catch (error) {
      this.logException(TICKET_STATUS_CHANGED, event.ticketId, error);
    }
  }

  @OnEvent(TICKET_COMMENTED)
  async handleTicketCommented(event: TicketCommentedEvent): Promise<void> {
    try {
      await this.notificationsService.handleTicketCommented(event);
    } catch (error) {
      this.logException(TICKET_COMMENTED, event.ticketId, error);
    }
  }

  private logException(
    eventName: string,
    ticketId: string,
    error: unknown,
  ): void {
    this.logger.error(
      `Failed to process "${eventName}" for ticket ${ticketId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
