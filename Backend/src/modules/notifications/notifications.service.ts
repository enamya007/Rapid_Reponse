import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { appConfig } from '../../config/app.config';
import type { AppConfig } from '../../config/app.config';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  buildPaginatedResponse,
  toTypeOrmSkipTake,
} from '../../common/utils/pagination.util';
import { NOTIFICATION_CREATED } from '../../common/events/notification-events';
import {
  TicketAssignedEvent,
  TicketCommentedEvent,
  TicketCreatedEvent,
  TicketStatusChangedEvent,
} from '../../common/events/ticket-events';
import { CommentVisibility } from '../tickets/enums/comment-visibility.enum';
import type { Ticket } from '../tickets/entities/ticket.entity';
import { MailQueueService } from '../mail/mail-queue.service';
import { ticketAssignedMail } from '../mail/templates/ticket-assigned.template';
import { ticketCommentedMail } from '../mail/templates/ticket-commented.template';
import { ticketStatusChangedMail } from '../mail/templates/ticket-status-changed.template';
import type { RenderedMail } from '../mail/templates/rendered-mail.type';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationCreatedEvent } from './events/notification-created.event';

// `Notification.title` is `varchar(150)` (see the entity) -- every title built below is a
// short, fixed-shape French sentence around a reference/enum value, so this can never actually
// trigger today, but the brief explicitly asks for a defensive cap plus a truncation test, so
// this guards the INSERT from ever failing on a future, longer title/reference format instead
// of trusting that invariant to hold forever.
const NOTIFICATION_TITLE_MAX_LENGTH = 150;

function truncate(
  value: string,
  maxLength = NOTIFICATION_TITLE_MAX_LENGTH,
): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// P6 contract §4/§5 (`docs/plan-P6-contracts.md`) — figées. Consumes `ticket.*` events emitted
// by `TicketsService`/`TicketCommentsService` (out of scope here, read-only) and produces
// persisted `notifications` rows plus queued emails. Never imports `UsersModule`/`TicketsModule`
// themselves -- only their shared entities/enums (`User`, `Ticket` as a type, `CommentVisibility`)
// -- and never writes to either.
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly eventEmitter: EventEmitter2,
    private readonly mailQueueService: MailQueueService,
    @Inject(appConfig.KEY)
    private readonly appConfigValue: AppConfig,
  ) {}

  // `ticket.created` (P6 contract §5): all active ADMIN, minus the actor (D8) -- no email
  // (an admin receiving one per created ticket would be noise).
  async handleTicketCreated(event: TicketCreatedEvent): Promise<void> {
    const adminIds = await this.getAdminIds();
    const recipients = await this.resolveRecipients(
      adminIds,
      event.actorId,
      false,
    );

    const title = `Nouveau ticket ${event.reference}`;
    const body = truncate(event.title);
    const payload = { ticketId: event.ticketId, reference: event.reference };

    for (const recipient of recipients) {
      await this.persistAndEmit({
        recipient,
        type: NotificationType.TICKET_CREATED,
        ticketId: event.ticketId,
        reference: event.reference,
        title,
        body,
        payload,
        renderedMail: null,
      });
    }
  }

  // `ticket.assigned` (P6 contract §5): the new assignee, plus the previous one on a
  // reassignment, minus the actor (D8) -- email only to the NEW assignee.
  async handleTicketAssigned(event: TicketAssignedEvent): Promise<void> {
    const recipients = await this.resolveRecipients(
      [event.assigneeId, event.previousAssigneeId],
      event.actorId,
      false,
    );

    const title = `Ticket ${event.reference} affecté`;
    const body = `Le ticket « ${event.title} » vous a été affecté.`;
    const payload = {
      ticketId: event.ticketId,
      reference: event.reference,
      assigneeId: event.assigneeId,
    };
    const appUrl = this.buildTicketUrl(event.ticketId);

    for (const recipient of recipients) {
      const isNewAssignee = recipient.id === event.assigneeId;
      await this.persistAndEmit({
        recipient,
        type: NotificationType.TICKET_ASSIGNED,
        ticketId: event.ticketId,
        reference: event.reference,
        title,
        body,
        payload,
        renderedMail: isNewAssignee
          ? ticketAssignedMail({
              reference: event.reference,
              title: event.title,
              appUrl,
            })
          : null,
      });
    }
  }

  // `ticket.status-changed` (P6 contract §5): the owning client and the assignee, minus the
  // actor (D8) -- email to both.
  async handleTicketStatusChanged(
    event: TicketStatusChangedEvent,
  ): Promise<void> {
    const recipients = await this.resolveRecipients(
      [event.createdById, event.assigneeId],
      event.actorId,
      false,
    );

    const title = `Ticket ${event.reference} : ${event.toStatus}`;
    const body = `Statut passé de ${event.fromStatus} à ${event.toStatus}.`;
    const payload = {
      ticketId: event.ticketId,
      reference: event.reference,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
    };
    const appUrl = this.buildTicketUrl(event.ticketId);

    for (const recipient of recipients) {
      await this.persistAndEmit({
        recipient,
        type: NotificationType.TICKET_STATUS_CHANGED,
        ticketId: event.ticketId,
        reference: event.reference,
        title,
        body,
        payload,
        renderedMail: ticketStatusChangedMail({
          reference: event.reference,
          title: event.title,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          appUrl,
        }),
      });
    }
  }

  // `ticket.commented` (P6 contract §5):
  // - PUBLIC: owning client + assignee, minus the actor (D8) -- email to both.
  // - INTERNAL: assignee + all active ADMIN, minus the actor (D8), THEN the D7 hard CLIENT
  //   filter (applied via `filterClientRole`, AFTER the base list and the actor removal, exactly
  //   as the contract orders it) -- no email at all (reduces the leak surface).
  // D6 is enforced upstream, structurally: `TicketCommentedEvent` never carries the comment
  // body, so there is nothing here that could leak it even if every filter below were wrong.
  async handleTicketCommented(event: TicketCommentedEvent): Promise<void> {
    const isInternal = event.visibility === CommentVisibility.INTERNAL;

    const candidateIds = isInternal
      ? [event.assigneeId, ...(await this.getAdminIds())]
      : [event.createdById, event.assigneeId];

    const recipients = await this.resolveRecipients(
      candidateIds,
      event.actorId,
      isInternal,
    );

    const title = `Nouveau commentaire sur ${event.reference}`;
    const body = `Un commentaire a été ajouté au ticket « ${event.title} ».`;
    const payload = { ticketId: event.ticketId, reference: event.reference };
    const appUrl = this.buildTicketUrl(event.ticketId);

    for (const recipient of recipients) {
      await this.persistAndEmit({
        recipient,
        type: NotificationType.TICKET_COMMENTED,
        ticketId: event.ticketId,
        reference: event.reference,
        title,
        body,
        payload,
        renderedMail: isInternal
          ? null
          : ticketCommentedMail({
              reference: event.reference,
              title: event.title,
              appUrl,
            }),
      });
    }
  }

  // `GET /notifications` (P6 contract §7) -- D16: hard-scoped to `recipientId`, no ADMIN
  // override. `relations: { ticket: true }` is what lets `NotificationResponseDto.fromEntity`
  // resolve `ticketReference` -- this only reaches `Ticket`'s metadata through the `Notification`
  // entity's own relation (exactly like `TechniciansModule`'s own documented reasoning for
  // reaching `Category` through `Ticket` without registering it locally); this module still
  // never registers a `Ticket` repository.
  async list(
    query: NotificationQueryDto,
    recipientId: string,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    const where: FindOptionsWhere<Notification> = { recipientId };
    // D18: `query.unreadOnly` is already a real `boolean | undefined` by the time it reaches
    // here (`NotificationQueryDto`'s `parseBooleanQuery` transform) -- `=== true` below is only
    // an extra guard against `undefined`, not a second boolean-parsing attempt.
    if (query.unreadOnly === true) {
      where.readAt = IsNull();
    }

    const { skip, take } = toTypeOrmSkipTake(query);
    const [items, total] = await this.notificationRepository.findAndCount({
      where,
      relations: { ticket: true },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });

    return buildPaginatedResponse(
      items.map((item) => NotificationResponseDto.fromEntity(item)),
      total,
      query,
    );
  }

  // `GET /notifications/unread-count` (P6 contract §7) -- D16 scoped.
  async unreadCount(recipientId: string): Promise<UnreadCountResponseDto> {
    const count = await this.notificationRepository.count({
      where: { recipientId, readAt: IsNull() },
    });
    const dto = new UnreadCountResponseDto();
    dto.count = count;
    return dto;
  }

  // `PATCH /notifications/read-all` (P6 contract §7) -- D16 scoped. A no-op `UPDATE` (matching
  // zero rows) is not an error: there is nothing to distinguish "no unread notifications" from
  // "already all read" here, and the route is `204` either way.
  async markAllRead(recipientId: string): Promise<void> {
    await this.notificationRepository.update(
      { recipientId, readAt: IsNull() },
      { readAt: new Date() },
    );
  }

  // `PATCH /notifications/:id/read` (P6 contract §7). D16: scoped by `{ id, recipientId }` in
  // the SAME query, not "find by id then compare owner" -- a notification belonging to someone
  // else therefore surfaces as a plain 404 here, never a 403 that would reveal its existence.
  // Idempotent: an already-read notification returns without writing `readAt` again.
  async markRead(id: string, recipientId: string): Promise<void> {
    const notification = await this.notificationRepository.findOne({
      where: { id, recipientId },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.readAt) {
      return;
    }
    await this.notificationRepository.update(notification.id, {
      readAt: new Date(),
    });
  }

  // Order of operations mirrors P6 contract §5 EXACTLY: (1) base candidate list (caller-built),
  // (2) drop the actor (D8), (3) drop CLIENT-role recipients when `filterClientRole` (D7 --
  // applied AFTER the actor removal), (4) de-duplicate by userId, (5) drop inactive accounts.
  // Steps 2-5 are all "remove an element matching a per-element predicate" -- mathematically
  // commutative with each other -- so applying the actor/dedupe filter up front and the
  // role/active filter after loading the rows is equivalent to running them in the literal
  // textual order, while only requiring ONE extra query (`User.find(In(ids))`) regardless of
  // event type.
  private async resolveRecipients(
    candidateIds: Array<string | null | undefined>,
    actorId: string,
    filterClientRole: boolean,
  ): Promise<User[]> {
    const ids = [
      ...new Set(
        candidateIds.filter(
          (id): id is string => typeof id === 'string' && id !== actorId,
        ),
      ),
    ];
    if (ids.length === 0) {
      return [];
    }

    const users = await this.userRepository.find({ where: { id: In(ids) } });
    return users.filter(
      (user) =>
        user.isActive && (!filterClientRole || user.role !== UserRole.CLIENT),
    );
  }

  private async getAdminIds(): Promise<string[]> {
    const admins = await this.userRepository.find({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });
    return admins.map((admin) => admin.id);
  }

  private buildTicketUrl(ticketId: string): string {
    return `${this.appConfigValue.frontendUrl}/tickets/${ticketId}`;
  }

  // D4/D5: writes the `notifications` row, then (D17) emits `NOTIFICATION_CREATED`, then (D4)
  // enqueues the already-rendered email via `MailQueueService.enqueue` when `renderedMail` is
  // supplied by the caller -- no SMTP, no template rendering happens on this call path beyond
  // the pure-function template calls already made by the `handleTicket*` methods above.
  private async persistAndEmit(outcome: {
    recipient: User;
    type: NotificationType;
    ticketId: string;
    reference: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
    renderedMail: RenderedMail | null;
  }): Promise<void> {
    const entity = this.notificationRepository.create({
      recipientId: outcome.recipient.id,
      type: outcome.type,
      ticketId: outcome.ticketId,
      title: truncate(outcome.title),
      body: outcome.body,
      payload: outcome.payload,
    });
    const saved = await this.notificationRepository.save(entity);

    // `save()` never hydrates the `ticket` relation object (only `ticketId` was written), and
    // this module holds no `Ticket` repository (P6 contract §5) to reload it from. The
    // reference is already known from the triggering event, so it is attached directly instead
    // of paying for an extra round trip per recipient.
    saved.ticket = { reference: outcome.reference } as Ticket;

    const dto = NotificationResponseDto.fromEntity(saved);
    this.eventEmitter.emit(NOTIFICATION_CREATED, {
      recipientId: outcome.recipient.id,
      notification: dto,
    } satisfies NotificationCreatedEvent);

    if (outcome.renderedMail) {
      await this.mailQueueService.enqueue({
        to: outcome.recipient.email,
        subject: outcome.renderedMail.subject,
        text: outcome.renderedMail.text,
        html: outcome.renderedMail.html,
      });
    }
  }
}
