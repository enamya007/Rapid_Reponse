import { NotificationResponseDto } from '../dto/notification-response.dto';

/**
 * Payload carried by `NOTIFICATION_CREATED` (`src/common/events/notification-events.ts`),
 * emitted by `NotificationsService` right after a notification row is persisted (P6 contract
 * D17, `docs/plan-P6-contracts.md` §4/§3).
 *
 * The event NAME is shared (`common/events/notification-events.ts`), but this payload TYPE
 * lives here, next to the DTO it carries — only the WebSocket gateway (a later, disjoint task,
 * D17) needs to know its shape, and it will import it from this module rather than from
 * `common/`.
 */
export interface NotificationCreatedEvent {
  recipientId: string;
  notification: NotificationResponseDto;
}
