import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  TICKET_COMMENTED,
  TicketCommentedEvent,
} from '../../common/events/ticket-events';
import { TicketComment } from '../tickets/entities/ticket-comment.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { CommentVisibility } from '../tickets/enums/comment-visibility.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TicketCommentsService } from './ticket-comments.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.username = 'jdoe';
  user.email = 'jdoe@example.com';
  user.role = UserRole.CLIENT;
  user.isActive = true;
  Object.assign(user, overrides);
  return user;
}

// Minimal `Ticket` stand-in carrying only the fields `TicketCommentedEvent`'s base
// (`TicketEventBase`) needs: `reference`, `title`, `createdById`, `assigneeId`. Mirrors the
// `buildTicket` helper in `tickets.service.spec.ts`, kept local since that file is a disjoint
// module's spec.
function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  const ticket = new Ticket();
  ticket.id = 'ticket-1';
  ticket.reference = 'TCK-000001';
  ticket.title = 'title';
  ticket.createdById = 'client-1';
  ticket.assigneeId = null;
  Object.assign(ticket, overrides);
  return ticket;
}

function buildComment(overrides: Partial<TicketComment> = {}): TicketComment {
  const comment = new TicketComment();
  comment.id = 'comment-1';
  comment.ticketId = 'ticket-1';
  comment.authorId = 'user-1';
  comment.body = 'body';
  comment.visibility = CommentVisibility.PUBLIC;
  comment.createdAt = new Date('2026-08-05T10:00:00.000Z');
  comment.updatedAt = new Date('2026-08-05T10:00:00.000Z');
  comment.deletedAt = null;
  // Every path that reaches `TicketCommentsService.create`'s post-save reload now also loads
  // the `ticket` relation (P6 contract §4): defaulted here so the many `create()` tests below
  // that don't care about the event payload don't each need to set it by hand.
  comment.ticket = buildTicket();
  Object.assign(comment, overrides);
  return comment;
}

function buildQuery(
  overrides: Partial<PaginationQueryDto> = {},
): PaginationQueryDto {
  const query = new PaginationQueryDto();
  Object.assign(query, overrides);
  return query;
}

interface MockCommentQueryBuilder {
  leftJoinAndSelect: jest.Mock<MockCommentQueryBuilder, [string, string]>;
  where: jest.Mock<MockCommentQueryBuilder, [string, Record<string, unknown>?]>;
  andWhere: jest.Mock<
    MockCommentQueryBuilder,
    [string, Record<string, unknown>?]
  >;
  orderBy: jest.Mock<MockCommentQueryBuilder, [string, 'ASC' | 'DESC']>;
  skip: jest.Mock<MockCommentQueryBuilder, [number]>;
  take: jest.Mock<MockCommentQueryBuilder, [number]>;
  getManyAndCount: jest.Mock<Promise<[TicketComment[], number]>, []>;
}

describe('TicketCommentsService', () => {
  let service: TicketCommentsService;
  let queryBuilder: MockCommentQueryBuilder;
  let commentRepository: {
    create: jest.Mock<TicketComment, [Record<string, unknown>]>;
    save: jest.Mock<Promise<TicketComment>, [TicketComment]>;
    findOne: jest.Mock<
      Promise<TicketComment | null>,
      [Record<string, unknown>]
    >;
    createQueryBuilder: jest.Mock<MockCommentQueryBuilder, [string]>;
  };
  let eventEmitter: { emit: jest.Mock<boolean, [string, unknown]> };

  beforeEach(async () => {
    queryBuilder = {
      leftJoinAndSelect: jest.fn<MockCommentQueryBuilder, [string, string]>(),
      where: jest.fn<
        MockCommentQueryBuilder,
        [string, Record<string, unknown>?]
      >(),
      andWhere: jest.fn<
        MockCommentQueryBuilder,
        [string, Record<string, unknown>?]
      >(),
      orderBy: jest.fn<MockCommentQueryBuilder, [string, 'ASC' | 'DESC']>(),
      skip: jest.fn<MockCommentQueryBuilder, [number]>(),
      take: jest.fn<MockCommentQueryBuilder, [number]>(),
      getManyAndCount: jest.fn<Promise<[TicketComment[], number]>, []>(),
    };
    // Every chainable method returns the same builder instance, mimicking TypeORM's fluent API
    // (same pattern as `tickets.service.spec.ts`'s own `MockTicketQueryBuilder`).
    queryBuilder.leftJoinAndSelect.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.skip.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

    commentRepository = {
      create: jest.fn<TicketComment, [Record<string, unknown>]>(),
      save: jest.fn<Promise<TicketComment>, [TicketComment]>(),
      findOne: jest.fn<
        Promise<TicketComment | null>,
        [Record<string, unknown>]
      >(),
      createQueryBuilder: jest.fn<MockCommentQueryBuilder, [string]>(
        () => queryBuilder,
      ),
    };
    eventEmitter = { emit: jest.fn<boolean, [string, unknown]>(() => true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketCommentsService,
        {
          provide: getRepositoryToken(TicketComment),
          useValue: commentRepository,
        },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(TicketCommentsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('CLIENT posting without visibility: defaults to PUBLIC, stamps ticketId/authorId, and returns the reloaded (author-hydrated) comment', async () => {
      const client = buildUser({ id: 'client-1', role: UserRole.CLIENT });
      const dto: CreateCommentDto = { body: 'Merci pour votre intervention.' };
      const createdEntity = buildComment({ id: 'comment-1' });
      commentRepository.create.mockReturnValue(createdEntity);
      commentRepository.save.mockResolvedValue(createdEntity);
      const hydrated = buildComment({ id: 'comment-1', author: client });
      commentRepository.findOne.mockResolvedValue(hydrated);

      const result = await service.create('ticket-1', dto, client);

      expect(commentRepository.create).toHaveBeenCalledWith({
        ticketId: 'ticket-1',
        authorId: 'client-1',
        body: dto.body,
        visibility: CommentVisibility.PUBLIC,
      });
      expect(commentRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(commentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        relations: { author: true, ticket: true },
      });
      expect(result).toBe(hydrated);
    });

    it('CLIENT explicitly posting visibility: PUBLIC: allowed', async () => {
      const client = buildUser({ id: 'client-1', role: UserRole.CLIENT });
      const dto: CreateCommentDto = {
        body: 'Ticket toujours en attente.',
        visibility: CommentVisibility.PUBLIC,
      };
      const createdEntity = buildComment();
      commentRepository.create.mockReturnValue(createdEntity);
      commentRepository.save.mockResolvedValue(createdEntity);
      commentRepository.findOne.mockResolvedValue(createdEntity);

      await service.create('ticket-1', dto, client);

      expect(commentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: CommentVisibility.PUBLIC }),
      );
    });

    it('ADMIN posting visibility: INTERNAL: allowed', async () => {
      const admin = buildUser({ id: 'admin-1', role: UserRole.ADMIN });
      const dto: CreateCommentDto = {
        body: 'Note interne pour le suivi.',
        visibility: CommentVisibility.INTERNAL,
      };
      const createdEntity = buildComment({
        visibility: CommentVisibility.INTERNAL,
      });
      commentRepository.create.mockReturnValue(createdEntity);
      commentRepository.save.mockResolvedValue(createdEntity);
      commentRepository.findOne.mockResolvedValue(createdEntity);

      const result = await service.create('ticket-1', dto, admin);

      expect(commentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: CommentVisibility.INTERNAL }),
      );
      expect(commentRepository.save).toHaveBeenCalled();
      expect(result.visibility).toBe(CommentVisibility.INTERNAL);
    });

    it('TECHNICIAN posting visibility: INTERNAL: allowed', async () => {
      const technician = buildUser({
        id: 'tech-1',
        role: UserRole.TECHNICIAN,
      });
      const dto: CreateCommentDto = {
        body: 'Diagnostic effectué, pièce à commander.',
        visibility: CommentVisibility.INTERNAL,
      };
      const createdEntity = buildComment({
        visibility: CommentVisibility.INTERNAL,
      });
      commentRepository.create.mockReturnValue(createdEntity);
      commentRepository.save.mockResolvedValue(createdEntity);
      commentRepository.findOne.mockResolvedValue(createdEntity);

      await service.create('ticket-1', dto, technician);

      expect(commentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: CommentVisibility.INTERNAL }),
      );
    });

    it('CLIENT posting visibility: INTERNAL: rejected with ForbiddenException (403), never creates/saves — no silent downgrade to PUBLIC', async () => {
      const client = buildUser({ id: 'client-1', role: UserRole.CLIENT });
      const dto: CreateCommentDto = {
        body: 'Je tente de poster en interne.',
        visibility: CommentVisibility.INTERNAL,
      };

      await expect(service.create('ticket-1', dto, client)).rejects.toThrow(
        ForbiddenException,
      );

      expect(commentRepository.create).not.toHaveBeenCalled();
      expect(commentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // P6 contract §4/D1/D6: `ticket.commented` is emitted after the save and the reload (this
  // method never opens a transaction, so D1's "after commit" concern doesn't apply the way it
  // does to `TicketsService.assign`/`applyTransition` — there is nothing to be "after" besides
  // the reload itself).
  describe('emits ticket.commented (P6 contract §4)', () => {
    it('emits exactly once, with the exact TicketCommentedEvent payload built from the reloaded ticket/comment — and carrying NO comment body/content (D6)', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-07T09:30:00.000Z') });
      const author = buildUser({ id: 'tech-1', role: UserRole.TECHNICIAN });
      const dto: CreateCommentDto = {
        body: 'Diagnostic effectué, pièce à commander.',
        visibility: CommentVisibility.INTERNAL,
      };
      const createdEntity = buildComment({ id: 'comment-1' });
      commentRepository.create.mockReturnValue(createdEntity);
      commentRepository.save.mockResolvedValue(createdEntity);
      const ticket = buildTicket({
        id: 'ticket-1',
        reference: 'TCK-000042',
        title: 'Climatisation en panne',
        createdById: 'client-9',
        assigneeId: 'tech-1',
      });
      const hydrated = buildComment({
        id: 'comment-1',
        authorId: 'tech-1',
        visibility: CommentVisibility.INTERNAL,
        author,
        ticket,
      });
      commentRepository.findOne.mockResolvedValue(hydrated);

      await service.create('ticket-1', dto, author);

      const expectedPayload: TicketCommentedEvent = {
        ticketId: 'ticket-1',
        reference: 'TCK-000042',
        title: 'Climatisation en panne',
        actorId: 'tech-1',
        createdById: 'client-9',
        assigneeId: 'tech-1',
        occurredAt: '2026-08-07T09:30:00.000Z',
        commentId: 'comment-1',
        visibility: CommentVisibility.INTERNAL,
        authorId: 'tech-1',
      };
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        TICKET_COMMENTED,
        expectedPayload,
      );
      // D6, defense in depth beyond the exact-match assertion above: the emitted payload never
      // carries the comment's own content under any key name.
      const [, emittedPayload] = eventEmitter.emit.mock.calls[0];
      expect(emittedPayload).not.toHaveProperty('body');
      expect(Object.keys(emittedPayload as object).sort()).toEqual(
        Object.keys(expectedPayload).sort(),
      );
    });
  });

  describe('list', () => {
    const CLIENT_USER = buildUser({ id: 'client-1', role: UserRole.CLIENT });
    const TECHNICIAN_USER = buildUser({
      id: 'tech-1',
      role: UserRole.TECHNICIAN,
    });
    const ADMIN_USER = buildUser({ id: 'admin-1', role: UserRole.ADMIN });

    it('always scopes to the given ticketId', async () => {
      await service.list('ticket-1', buildQuery(), ADMIN_USER);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'comment.ticketId = :ticketId',
        { ticketId: 'ticket-1' },
      );
    });

    it('CLIENT: filters out INTERNAL comments in SQL (andWhere on visibility), not by post-filtering results', async () => {
      await service.list('ticket-1', buildQuery(), CLIENT_USER);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'comment.visibility = :publicVisibility',
        { publicVisibility: CommentVisibility.PUBLIC },
      );
    });

    it('the SQL-level filter makes meta.total reflect only the visible subset (not the raw unfiltered count)', async () => {
      const publicOnly = [
        buildComment({ id: 'c-1', visibility: CommentVisibility.PUBLIC }),
      ];
      // Simulates what the real query builder would return once the CLIENT `andWhere` clause
      // is applied: only 1 PUBLIC row/count, even though 2 rows exist in total (1 PUBLIC + 1
      // INTERNAL) — proving `meta.total` tracks the filtered count, not the unfiltered one.
      queryBuilder.getManyAndCount.mockResolvedValue([publicOnly, 1]);

      const result = await service.list('ticket-1', buildQuery(), CLIENT_USER);

      expect(result.meta.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('TECHNICIAN: does NOT add the visibility filter (sees INTERNAL comments)', async () => {
      await service.list('ticket-1', buildQuery(), TECHNICIAN_USER);

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('ADMIN: does NOT add the visibility filter (sees INTERNAL comments)', async () => {
      await service.list('ticket-1', buildQuery(), ADMIN_USER);

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('orders by createdAt ASC (chronological thread order)', async () => {
      await service.list('ticket-1', buildQuery(), ADMIN_USER);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'comment.createdAt',
        'ASC',
      );
    });

    it('derives skip/take from page/limit via the shared pagination util', async () => {
      await service.list(
        'ticket-1',
        buildQuery({ page: 3, limit: 10 }),
        ADMIN_USER,
      );

      expect(queryBuilder.skip).toHaveBeenCalledWith(20);
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('maps rows to CommentResponseDto via getManyAndCount, via the shared pagination util', async () => {
      const author = buildUser({ id: 'author-1', username: 'techie' });
      const comment = buildComment({
        id: 'comment-1',
        body: 'Sur place, diagnostic en cours.',
        author,
      });
      queryBuilder.getManyAndCount.mockResolvedValue([[comment], 1]);

      const result = await service.list(
        'ticket-1',
        buildQuery({ page: 1, limit: 20 }),
        ADMIN_USER,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toBeInstanceOf(CommentResponseDto);
      expect(result.data[0].id).toBe('comment-1');
      expect(result.data[0].author).toEqual({
        id: 'author-1',
        username: 'techie',
      });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('returns a null author in the DTO when the comment has none (authorId was NULLed by ON DELETE SET NULL)', async () => {
      const comment = buildComment({ id: 'comment-1', author: null });
      queryBuilder.getManyAndCount.mockResolvedValue([[comment], 1]);

      const result = await service.list('ticket-1', buildQuery(), ADMIN_USER);

      expect(result.data[0].author).toBeNull();
    });
  });

  describe('CommentResponseDto shape (via list mapping)', () => {
    it('exposes exactly id, body, visibility, author, createdAt — nothing else (no deletedAt/updatedAt/ticketId leak)', async () => {
      const author = buildUser({ id: 'author-1', username: 'techie' });
      const comment = buildComment({
        id: 'comment-1',
        ticketId: 'ticket-1',
        authorId: 'author-1',
        author,
        visibility: CommentVisibility.INTERNAL,
      });
      queryBuilder.getManyAndCount.mockResolvedValue([[comment], 1]);

      const result = await service.list(
        'ticket-1',
        buildQuery(),
        buildUser({ id: 'admin-1', role: UserRole.ADMIN }),
      );

      expect(Object.keys(result.data[0]).sort()).toEqual(
        ['author', 'body', 'createdAt', 'id', 'visibility'].sort(),
      );
    });
  });
});
