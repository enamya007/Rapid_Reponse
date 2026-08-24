import { ApiProperty } from '@nestjs/swagger';
import { Notification } from '../entities/notification.entity';
import { NotificationType } from '../enums/notification-type.enum';

// P6 contract §7 (`docs/plan-P6-contracts.md`) — figée shape. Manual DTO + `static fromEntity`,
// following the P4/P5 convention (no `ClassSerializerInterceptor`, no `@Exclude`) that every
// other response DTO in this codebase already uses (see e.g.
// `technicians/dto/technician-response.dto.ts`).
export class NotificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType' })
  type: NotificationType;

  @ApiProperty()
  title: string;

  // Never the comment body (D6) — only the fixed, type-specific sentences built by
  // `NotificationsService`.
  @ApiProperty()
  body: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Front-end deep-link ids (ticketId, reference, and — depending on type — fromStatus/toStatus/assigneeId). Never the comment body.',
  })
  payload: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true })
  ticketId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The ticket's human-readable reference, resolved via the entity's `ticket` relation, for the front-end deep-link.",
  })
  ticketReference: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  readAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  // `entity.ticket` must be loaded (e.g. `relations: { ticket: true }`) for `ticketReference` to
  // resolve — `NotificationsService.list` always loads it; the listener path attaches it
  // directly from the triggering event instead of an extra query (see that file's own comment).
  static fromEntity(entity: Notification): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    dto.id = entity.id;
    dto.type = entity.type;
    dto.title = entity.title;
    dto.body = entity.body;
    dto.payload = entity.payload;
    dto.ticketId = entity.ticketId;
    dto.ticketReference = entity.ticket?.reference ?? null;
    dto.readAt = entity.readAt ? entity.readAt.toISOString() : null;
    dto.createdAt = entity.createdAt.toISOString();
    return dto;
  }
}
