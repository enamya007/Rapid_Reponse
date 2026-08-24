import { CommentVisibility } from '../../modules/tickets/enums/comment-visibility.enum';
import { TicketStatus } from '../../modules/tickets/enums/ticket-status.enum';

/**
 * Business events emitted by the ticket domain and consumed by the notification layer
 * (P6 contract, `docs/plan-P6-contracts.md` §4).
 *
 * These types live in `common/` rather than in either module on purpose: the emitters
 * (`TicketsModule`, `TicketCommentsModule`) and the consumer (`NotificationsModule`) both
 * import them, and neither has to import the other. Nothing here may be edited by a scoped
 * implementation task — this is the shared contract between them.
 *
 * Every payload is plain, serializable data resolved by the emitter. No entity instances and
 * no lazy relations: a listener must never have to re-read the emitter's in-memory state, and
 * a payload must stay meaningful even once the row it describes has moved on.
 */

export const TICKET_CREATED = 'ticket.created';
export const TICKET_ASSIGNED = 'ticket.assigned';
export const TICKET_STATUS_CHANGED = 'ticket.status-changed';
export const TICKET_COMMENTED = 'ticket.commented';

export interface TicketEventBase {
  ticketId: string;

  /** Human-readable reference, e.g. `TCK-000123`. */
  reference: string;

  title: string;

  /** The user whose action produced this event. Never one of its own recipients (D8). */
  actorId: string;

  /** Owner of the ticket (`tickets.created_by_id`). */
  createdById: string;

  /** Assignee as of the moment the event was emitted, i.e. after the write. */
  assigneeId: string | null;

  /** ISO-8601, stamped by the emitter at emission time. */
  occurredAt: string;
}

export type TicketCreatedEvent = TicketEventBase;

export interface TicketAssignedEvent extends TicketEventBase {
  /** `null` on a first assignment; set on a reassignment, which notifies both technicians. */
  previousAssigneeId: string | null;
}

export interface TicketStatusChangedEvent extends TicketEventBase {
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
}

export interface TicketCommentedEvent extends TicketEventBase {
  commentId: string;
  visibility: CommentVisibility;
  authorId: string;

  // There is deliberately no comment body here, and none in the notification built from it
  // (P6 contract D6). An INTERNAL comment then cannot leak to a CLIENT through a notification,
  // an email or a WebSocket frame, because the text never enters this path at all — the
  // guarantee does not depend on a recipient filter staying correct.
}
