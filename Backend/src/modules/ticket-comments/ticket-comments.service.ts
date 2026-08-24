import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  buildPaginatedResponse,
  toTypeOrmSkipTake,
} from '../../common/utils/pagination.util';
import {
  TICKET_COMMENTED,
  TicketCommentedEvent,
} from '../../common/events/ticket-events';
import { TicketComment } from '../tickets/entities/ticket-comment.entity';
import { CommentVisibility } from '../tickets/enums/comment-visibility.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';

// P4 contract §4 ("Décisions complémentaires figées pour T4.5") + `docs/data-model.md` §2.10.
// `OwnershipGuard` (applied at the controller) has already confirmed the caller may see the
// ticket (404 if it doesn't exist, 403 otherwise) before either method here ever runs — this
// service receives a trusted `ticketId` and never re-checks ticket existence/visibility itself.
@Injectable()
export class TicketCommentsService {
  constructor(
    @InjectRepository(TicketComment)
    private readonly commentRepository: Repository<TicketComment>,
    // P6 contract §4: `ticket.commented` is emitted from this service directly --
    // `EventEmitterModule.forRoot()` is wired globally in `AppModule`, so `EventEmitter2` is
    // injectable here without `TicketCommentsModule` importing anything new.
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Write-side rule: `visibility = INTERNAL` is reserved to ADMIN/TECHNICIAN. A CLIENT
  // requesting INTERNAL is rejected outright with 403 — the decision table is explicit that
  // this must NOT silently degrade to PUBLIC, so this check runs, and throws, strictly before
  // any `create`/`save` call.
  async create(
    ticketId: string,
    dto: CreateCommentDto,
    currentUser: User,
  ): Promise<TicketComment> {
    const visibility = dto.visibility ?? CommentVisibility.PUBLIC;
    if (
      visibility === CommentVisibility.INTERNAL &&
      currentUser.role === UserRole.CLIENT
    ) {
      throw new ForbiddenException(
        'Only ADMIN or TECHNICIAN may post an INTERNAL comment',
      );
    }

    const comment = this.commentRepository.create({
      ticketId,
      authorId: currentUser.id,
      body: dto.body,
      visibility,
    });
    const saved = await this.commentRepository.save(comment);

    // Reloaded with the `author` AND `ticket` relations rather than returning `saved` as-is:
    // `saved` only carries scalar columns/FK ids, not the hydrated `author` object
    // `CommentResponseDto.fromEntity` needs (same reasoning as `TicketsService.create`), nor
    // the `ticket` fields (`reference`, `title`, `createdById`, `assigneeId`) the
    // `ticket.commented` event below needs.
    const hydrated = await this.getById(saved.id);

    // P6 contract §4/D1: emitted after the save and the reload, outside of any transaction
    // (this method never opens one). D6: deliberately carries NO comment body/content — see
    // `TicketCommentedEvent`'s own doc comment in `common/events/ticket-events.ts`. That is
    // what keeps an INTERNAL comment from ever being able to leak through the notification
    // path, independent of any recipient filter downstream.
    this.eventEmitter.emit(TICKET_COMMENTED, {
      ticketId: hydrated.ticket.id,
      reference: hydrated.ticket.reference,
      title: hydrated.ticket.title,
      actorId: currentUser.id,
      createdById: hydrated.ticket.createdById,
      assigneeId: hydrated.ticket.assigneeId,
      occurredAt: new Date().toISOString(),
      commentId: hydrated.id,
      visibility: hydrated.visibility,
      authorId: currentUser.id,
    } satisfies TicketCommentedEvent);

    return hydrated;
  }

  private async getById(id: string): Promise<TicketComment> {
    const comment = await this.commentRepository.findOne({
      where: { id },
      // `ticket` is loaded alongside `author` so `create()` can build the `ticket.commented`
      // event payload (P6 contract §4) from this SAME reload, rather than a second query.
      relations: { author: true, ticket: true },
    });
    if (!comment) {
      // Unreachable in practice immediately after `save` above; kept explicit (rather than a
      // non-null assertion) so the method's return type stays honest.
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }

  // Read-side rule: a CLIENT never sees INTERNAL comments. This is a `WHERE` clause on the
  // query builder, NOT a `.filter()` applied to `getManyAndCount()`'s results afterwards —
  // filtering post-pagination would both leak the existence of INTERNAL rows into `meta.total`
  // and could return fewer than `limit` items on a page that should have been full. ADMIN and
  // TECHNICIAN receive every comment, INTERNAL included. Tri chronologique (`createdAt ASC`,
  // P4 contract §4) — deliberately the opposite of `TicketsService.list`'s default `DESC`.
  async list(
    ticketId: string,
    query: PaginationQueryDto,
    currentUser: User,
  ): Promise<PaginatedResponseDto<CommentResponseDto>> {
    const qb = this.commentRepository
      .createQueryBuilder('comment')
      .leftJoinAndSelect('comment.author', 'author')
      .where('comment.ticketId = :ticketId', { ticketId });

    if (currentUser.role === UserRole.CLIENT) {
      qb.andWhere('comment.visibility = :publicVisibility', {
        publicVisibility: CommentVisibility.PUBLIC,
      });
    }

    qb.orderBy('comment.createdAt', 'ASC');

    const { skip, take } = toTypeOrmSkipTake(query);
    qb.skip(skip).take(take);

    const [items, total] = await qb.getManyAndCount();

    return buildPaginatedResponse(
      items.map((item) => CommentResponseDto.fromEntity(item)),
      total,
      query,
    );
  }
}
