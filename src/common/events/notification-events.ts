/**
 * Internal fan-out event, emitted by `NotificationsService` once a notification row is
 * persisted, and consumed by the WebSocket gateway (P6 contract D17).
 *
 * The indirection is the point: the gateway subscribes to this name instead of being injected
 * into `NotificationsService`. Persistence and real-time delivery stay independently
 * implementable, and removing the gateway leaves the notification module fully working.
 *
 * The payload type is declared alongside the DTO it carries, in the notifications module —
 * only the event name is shared here, since that is all an emitter and a subscriber need to
 * agree on.
 */
export const NOTIFICATION_CREATED = 'notification.created';
