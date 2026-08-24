import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DeleteResult, EntityManager, EntityTarget } from 'typeorm';
import {
  TICKET_ASSIGNED,
  TICKET_CREATED,
  TICKET_STATUS_CHANGED,
  TicketAssignedEvent,
  TicketCreatedEvent,
  TicketStatusChangedEvent,
} from '../../common/events/ticket-events';
import { Category } from '../categories/entities/category.entity';
import { SlaPolicy } from '../sla/entities/sla-policy.entity';
import { TechnicianSuggestionDto } from '../technicians/dto/technician-suggestion.dto';
import { TechnicianSuggestionService } from '../technicians/technician-suggestion.service';
import { TechnicianEligibility } from '../technicians/types/technician-eligibility.type';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ReasonDto } from './dto/reason.dto';
import { ResolveTicketDto } from './dto/resolve-ticket.dto';
import { TicketListItemDto } from './dto/ticket-list-item.dto';
import { TICKET_SORT_FIELDS, TicketQueryDto } from './dto/ticket-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketAssignment } from './entities/ticket-assignment.entity';
import { TicketStatusHistory } from './entities/ticket-status-history.entity';
import { Ticket } from './entities/ticket.entity';
import { TicketPriority } from './enums/ticket-priority.enum';
import { TicketStatus } from './enums/ticket-status.enum';
import { TicketsService } from './tickets.service';

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

function buildCategory(overrides: Partial<Category> = {}): Category {
  const category = new Category();
  category.id = 'category-1';
  category.name = 'Panne électrique';
  category.isActive = true;
  Object.assign(category, overrides);
  return category;
}

function buildSlaPolicy(overrides: Partial<SlaPolicy> = {}): SlaPolicy {
  const policy = new SlaPolicy();
  policy.id = 'sla-1';
  policy.priority = TicketPriority.NORMAL;
  policy.resolutionTargetMinutes = 4320;
  Object.assign(policy, overrides);
  return policy;
}

function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  const ticket = new Ticket();
  ticket.id = 'ticket-1';
  ticket.reference = 'TCK-000001';
  ticket.title = 'title';
  ticket.description = 'description';
  ticket.status = TicketStatus.OPEN;
  ticket.priority = TicketPriority.NORMAL;
  Object.assign(ticket, overrides);
  return ticket;
}

function buildTicketAssignment(
  overrides: Partial<TicketAssignment> = {},
): TicketAssignment {
  const assignment = new TicketAssignment();
  assignment.id = 'assignment-1';
  assignment.ticketId = 'ticket-1';
  assignment.technicianId = 'tech-1';
  assignment.assignedById = 'admin-1';
  assignment.reason = null;
  assignment.isAutoSuggested = false;
  assignment.assignedAt = new Date('2026-01-01T00:00:00.000Z');
  assignment.unassignedAt = null;
  Object.assign(assignment, overrides);
  return assignment;
}

function buildEligibility(
  overrides: Partial<TechnicianEligibility> = {},
): TechnicianEligibility {
  return {
    eligible: true,
    currentLoad: 0,
    maxConcurrentTickets: 5,
    ...overrides,
  };
}

// One mock builder serves both query-builder paths of the service: `list()`
// (`andWhere`/`orderBy`/`skip`/`take`/`getManyAndCount`) and `getById()`
// (`leftJoinAndSelect`/`where`/`getOne`). `getById` moved off `findOne({ relations })` in P6.5
// (D12) precisely because `find`-style relations drop a soft-deleted author, so the ticket
// repository's `findOne` is no longer called anywhere in this service.
interface MockTicketQueryBuilder {
  leftJoinAndSelect: jest.Mock<MockTicketQueryBuilder, [string, string]>;
  withDeleted: jest.Mock<MockTicketQueryBuilder, []>;
  where: jest.Mock<MockTicketQueryBuilder, [string, Record<string, unknown>?]>;
  andWhere: jest.Mock<
    MockTicketQueryBuilder,
    [string, Record<string, unknown>?]
  >;
  orderBy: jest.Mock<MockTicketQueryBuilder, [string, 'ASC' | 'DESC']>;
  skip: jest.Mock<MockTicketQueryBuilder, [number]>;
  take: jest.Mock<MockTicketQueryBuilder, [number]>;
  getOne: jest.Mock<Promise<Ticket | null>, []>;
  getManyAndCount: jest.Mock<Promise<[Ticket[], number]>, []>;
}

// `list()` applies the soft-delete exclusion as an explicit clause since P6.5 D12 (it can no
// longer rely on TypeORM's implicit one, `withDeleted()` having lifted it so a soft-deleted
// assignee still resolves through the join). Counting raw `andWhere` calls would conflate that
// permanent guard with the role scope and the user-supplied filters these tests are actually
// about, so they count only the latter.
const SOFT_DELETE_GUARD = 'ticket.deletedAt IS NULL';

function filterClauseCount(qb: MockTicketQueryBuilder): number {
  return qb.andWhere.mock.calls.filter(
    ([condition]) => condition !== SOFT_DELETE_GUARD,
  ).length;
}

function buildTicketQuery(
  overrides: Partial<TicketQueryDto> = {},
): TicketQueryDto {
  const query = new TicketQueryDto();
  Object.assign(query, overrides);
  return query;
}

// Entity classes `TicketsService` ever passes to `em.create`/`em.findOne` inside a
// `manager.transaction(...)` callback: `TicketStatusHistory` (every transition, T4.4) and
// `TicketAssignment` (T5.3's `assign()` only).
type MockTransactionEntity = TicketStatusHistory | TicketAssignment;

// Mock stand-in for the `EntityManager` handed to the callback of
// `ticketRepository.manager.transaction(...)`. `save`/`create` are exercised by every
// transition (T4.4) for the ticket row and the `TicketStatusHistory` row it inserts alongside
// it; `assign()` (T5.3) additionally uses `create`/`save` for `TicketAssignment` rows and
// `findOne` to locate the currently open one (`unassignedAt IS NULL`) to close. `create` mimics
// TypeORM's real behaviour closely enough for assertions — merging the given plain object onto
// a fresh instance of the given entity class — without pulling in a real `EntityManager`.
interface MockTransactionEntityManager {
  save: jest.Mock<Promise<unknown>, [unknown]>;
  create: jest.Mock<
    MockTransactionEntity,
    [EntityTarget<MockTransactionEntity>, Record<string, unknown>]
  >;
  findOne: jest.Mock<
    Promise<TicketAssignment | null>,
    [EntityTarget<TicketAssignment>, Record<string, unknown>]
  >;
}

describe('TicketsService', () => {
  let service: TicketsService;
  let queryBuilder: MockTicketQueryBuilder;
  let transactionEntityManager: MockTransactionEntityManager;
  let transactionMock: jest.Mock<
    Promise<void>,
    [(em: EntityManager) => Promise<void>]
  >;
  let ticketRepository: {
    create: jest.Mock<Ticket, [Record<string, unknown>]>;
    save: jest.Mock<Promise<Ticket>, [Ticket]>;
    findOne: jest.Mock<Promise<Ticket | null>, [Record<string, unknown>]>;
    findOneBy: jest.Mock<Promise<Ticket | null>, [Record<string, unknown>]>;
    softDelete: jest.Mock<Promise<DeleteResult>, [string]>;
    createQueryBuilder: jest.Mock<MockTicketQueryBuilder, [string]>;
    manager: { transaction: typeof transactionMock };
  };
  let categoryRepository: {
    findOneBy: jest.Mock<Promise<Category | null>, [Record<string, unknown>]>;
  };
  let slaPolicyRepository: {
    findOneBy: jest.Mock<Promise<SlaPolicy | null>, [Record<string, unknown>]>;
  };
  let ticketAssignmentRepository: {
    find: jest.Mock<Promise<TicketAssignment[]>, [Record<string, unknown>]>;
  };
  let technicianSuggestionService: {
    evaluateEligibility: jest.Mock<Promise<TechnicianEligibility>, [string]>;
    suggestForTicket: jest.Mock<
      Promise<TechnicianSuggestionDto[]>,
      [string, number]
    >;
  };
  let eventEmitter: { emit: jest.Mock<boolean, [string, unknown]> };

  beforeEach(async () => {
    queryBuilder = {
      leftJoinAndSelect: jest.fn<MockTicketQueryBuilder, [string, string]>(),
      withDeleted: jest.fn<MockTicketQueryBuilder, []>(),
      where: jest.fn<
        MockTicketQueryBuilder,
        [string, Record<string, unknown>?]
      >(),
      andWhere: jest.fn<
        MockTicketQueryBuilder,
        [string, Record<string, unknown>?]
      >(),
      orderBy: jest.fn<MockTicketQueryBuilder, [string, 'ASC' | 'DESC']>(),
      skip: jest.fn<MockTicketQueryBuilder, [number]>(),
      take: jest.fn<MockTicketQueryBuilder, [number]>(),
      getOne: jest.fn<Promise<Ticket | null>, []>(),
      getManyAndCount: jest.fn<Promise<[Ticket[], number]>, []>(),
    };
    // Every chainable method returns the same builder instance, mimicking TypeORM's fluent API.
    queryBuilder.leftJoinAndSelect.mockReturnValue(queryBuilder);
    queryBuilder.withDeleted.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.skip.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

    transactionEntityManager = {
      save: jest.fn<Promise<unknown>, [unknown]>((entity: unknown) =>
        Promise.resolve(entity),
      ),
      // Branches on the entity class rather than blindly calling `new entityClass()` against a
      // union type: keeps this fully type-safe while still building the RIGHT class for each of
      // the two entities `TicketsService` ever creates inside a transaction.
      create: jest.fn<
        MockTransactionEntity,
        [EntityTarget<MockTransactionEntity>, Record<string, unknown>]
      >((entityClass, plain) => {
        const instance: MockTransactionEntity =
          entityClass === TicketAssignment
            ? new TicketAssignment()
            : new TicketStatusHistory();
        return Object.assign(instance, plain);
      }),
      // Defaults to "no currently open assignment" (first assignment from OPEN); reassignment
      // tests override this per-case with `.mockResolvedValueOnce(...)`.
      findOne: jest.fn<
        Promise<TicketAssignment | null>,
        [EntityTarget<TicketAssignment>, Record<string, unknown>]
      >(() => Promise.resolve(null)),
    };
    // Runs the given callback with the mock `EntityManager` above, exactly like TypeORM's real
    // `EntityManager.transaction` does — so every write a transition (or `assign()`) makes lands
    // inside this SAME mocked transaction, letting tests assert they happen together.
    transactionMock = jest.fn<
      Promise<void>,
      [(em: EntityManager) => Promise<void>]
    >((callback) =>
      callback(transactionEntityManager as unknown as EntityManager),
    );

    ticketRepository = {
      create: jest.fn<Ticket, [Record<string, unknown>]>(),
      save: jest.fn<Promise<Ticket>, [Ticket]>(),
      findOne: jest.fn<Promise<Ticket | null>, [Record<string, unknown>]>(),
      findOneBy: jest.fn<Promise<Ticket | null>, [Record<string, unknown>]>(),
      softDelete: jest.fn<Promise<DeleteResult>, [string]>(),
      createQueryBuilder: jest.fn<MockTicketQueryBuilder, [string]>(
        () => queryBuilder,
      ),
      manager: { transaction: transactionMock },
    };
    categoryRepository = {
      findOneBy: jest.fn<Promise<Category | null>, [Record<string, unknown>]>(),
    };
    slaPolicyRepository = {
      findOneBy: jest.fn<
        Promise<SlaPolicy | null>,
        [Record<string, unknown>]
      >(),
    };
    ticketAssignmentRepository = {
      find: jest.fn<Promise<TicketAssignment[]>, [Record<string, unknown>]>(),
    };
    technicianSuggestionService = {
      evaluateEligibility: jest.fn<Promise<TechnicianEligibility>, [string]>(),
      suggestForTicket: jest.fn<
        Promise<TechnicianSuggestionDto[]>,
        [string, number]
      >(),
    };
    eventEmitter = { emit: jest.fn<boolean, [string, unknown]>(() => true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getRepositoryToken(Ticket), useValue: ticketRepository },
        {
          provide: getRepositoryToken(Category),
          useValue: categoryRepository,
        },
        {
          provide: getRepositoryToken(SlaPolicy),
          useValue: slaPolicyRepository,
        },
        {
          provide: getRepositoryToken(TicketAssignment),
          useValue: ticketAssignmentRepository,
        },
        {
          provide: TechnicianSuggestionService,
          useValue: technicianSuggestionService,
        },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(TicketsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    const dto: CreateTicketDto = {
      title: 'Climatisation en panne',
      description: 'La clim ne démarre plus.',
      categoryId: 'category-1',
      priority: TicketPriority.HIGH,
    };
    const currentUser = buildUser({ id: 'client-1' });

    it('resolves the category (active only), computes slaDueAt from the matching SLA policy, defaults status to OPEN, stamps createdById, and never assigns reference', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-05T10:00:00.000Z') });
      const category = buildCategory({ id: 'category-1' });
      const policy = buildSlaPolicy({
        priority: TicketPriority.HIGH,
        resolutionTargetMinutes: 1440,
      });
      categoryRepository.findOneBy.mockResolvedValue(category);
      slaPolicyRepository.findOneBy.mockResolvedValue(policy);
      const createdEntity = buildTicket({ id: 'ticket-1' });
      ticketRepository.create.mockReturnValue(createdEntity);
      ticketRepository.save.mockResolvedValue(createdEntity);
      const hydratedTicket = buildTicket({
        id: 'ticket-1',
        category,
        createdBy: currentUser,
        assignee: null,
      });
      queryBuilder.getOne.mockResolvedValue(hydratedTicket);

      const result = await service.create(dto, currentUser);

      expect(categoryRepository.findOneBy).toHaveBeenCalledWith({
        id: 'category-1',
        isActive: true,
      });
      expect(slaPolicyRepository.findOneBy).toHaveBeenCalledWith({
        priority: TicketPriority.HIGH,
      });
      const expectedSlaDueAt = new Date('2026-08-05T10:00:00.000Z');
      expectedSlaDueAt.setMinutes(expectedSlaDueAt.getMinutes() + 1440);
      // Exact-match assertion (not `objectContaining`): also proves no stray `reference`
      // (or any other unexpected key, e.g. `id`) is ever passed to `create`.
      expect(ticketRepository.create).toHaveBeenCalledWith({
        title: dto.title,
        description: dto.description,
        status: TicketStatus.OPEN,
        priority: TicketPriority.HIGH,
        categoryId: 'category-1',
        createdById: 'client-1',
        siteLabel: null,
        siteAddress: null,
        slaDueAt: expectedSlaDueAt,
      });
      expect(ticketRepository.save).toHaveBeenCalledWith(createdEntity);
      // Reloaded with relations for the response, rather than returning the bare saved row.
      expect(queryBuilder.where).toHaveBeenCalledWith('ticket.id = :id', {
        id: 'ticket-1',
      });
      expect(queryBuilder.getOne).toHaveBeenCalledTimes(1);
      expect(result).toBe(hydratedTicket);
    });

    it('throws NotFoundException and never creates/saves when the category does not exist (or is inactive)', async () => {
      categoryRepository.findOneBy.mockResolvedValue(null);

      await expect(service.create(dto, currentUser)).rejects.toThrow(
        NotFoundException,
      );

      expect(ticketRepository.create).not.toHaveBeenCalled();
      expect(ticketRepository.save).not.toHaveBeenCalled();
      expect(slaPolicyRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('sets slaDueAt to null (without throwing) when no SLA policy matches the priority', async () => {
      const category = buildCategory();
      categoryRepository.findOneBy.mockResolvedValue(category);
      slaPolicyRepository.findOneBy.mockResolvedValue(null);
      const createdEntity = buildTicket();
      ticketRepository.create.mockReturnValue(createdEntity);
      ticketRepository.save.mockResolvedValue(createdEntity);
      queryBuilder.getOne.mockResolvedValue(
        buildTicket({ category, createdBy: currentUser }),
      );

      await service.create(dto, currentUser);

      expect(ticketRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ slaDueAt: null }),
      );
    });

    it('defaults priority to NORMAL when omitted from the DTO', async () => {
      const category = buildCategory();
      categoryRepository.findOneBy.mockResolvedValue(category);
      slaPolicyRepository.findOneBy.mockResolvedValue(null);
      const createdEntity = buildTicket();
      ticketRepository.create.mockReturnValue(createdEntity);
      ticketRepository.save.mockResolvedValue(createdEntity);
      queryBuilder.getOne.mockResolvedValue(
        buildTicket({ category, createdBy: currentUser }),
      );

      const dtoWithoutPriority: CreateTicketDto = {
        ...dto,
        priority: undefined,
      };
      await service.create(dtoWithoutPriority, currentUser);

      expect(slaPolicyRepository.findOneBy).toHaveBeenCalledWith({
        priority: TicketPriority.NORMAL,
      });
      expect(ticketRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ priority: TicketPriority.NORMAL }),
      );
    });

    // P6 contract §4: `ticket.created` is emitted here, after the reload, before the return.
    it('emits ticket.created exactly once, after the reload, with the exact TicketCreatedEvent payload (actor = creator, assigneeId null on a brand-new ticket)', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-07T09:00:00.000Z') });
      const category = buildCategory({ id: 'category-1' });
      categoryRepository.findOneBy.mockResolvedValue(category);
      slaPolicyRepository.findOneBy.mockResolvedValue(null);
      const createdEntity = buildTicket({ id: 'ticket-1' });
      ticketRepository.create.mockReturnValue(createdEntity);
      ticketRepository.save.mockResolvedValue(createdEntity);
      const hydratedTicket = buildTicket({
        id: 'ticket-1',
        reference: 'TCK-000099',
        title: dto.title,
        createdById: 'client-1',
        assigneeId: null,
        category,
        createdBy: currentUser,
        assignee: null,
      });
      queryBuilder.getOne.mockResolvedValue(hydratedTicket);

      await service.create(dto, currentUser);

      const expectedPayload: TicketCreatedEvent = {
        ticketId: 'ticket-1',
        reference: 'TCK-000099',
        title: dto.title,
        actorId: 'client-1',
        createdById: 'client-1',
        assigneeId: null,
        occurredAt: '2026-08-07T09:00:00.000Z',
      };
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        TICKET_CREATED,
        expectedPayload,
      );
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when the ticket does not exist', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      await expect(service.getById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('loads the ticket with category/createdBy/assignee relations when it exists', async () => {
      const ticket = buildTicket();
      queryBuilder.getOne.mockResolvedValue(ticket);

      const result = await service.getById('ticket-1');

      expect(queryBuilder.where).toHaveBeenCalledWith('ticket.id = :id', {
        id: 'ticket-1',
      });
      expect(result).toBe(ticket);
    });

    // P6.5 D12 — the reason this method uses a query builder rather than
    // `findOne({ relations })`. `find`-style relations inherit the `deletedAt IS NULL` guard, so
    // a ticket whose author had been soft-deleted came back with `createdBy: null` and
    // `TicketResponseDto.fromEntity` — whose `createdBy` is non-nullable — threw: a 500 on every
    // ticket ever opened by a since-deleted account. A `leftJoinAndSelect` is not filtered.
    it('joins createdBy and assignee explicitly, so a soft-deleted author still resolves', async () => {
      queryBuilder.getOne.mockResolvedValue(buildTicket());

      await service.getById('ticket-1');

      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'ticket.createdBy',
        'createdBy',
      );
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'ticket.assignee',
        'assignee',
      );
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'ticket.category',
        'category',
      );
      // Never re-introduced as `find` relations, which is the exact regression D12 closes.
      expect(ticketRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    const CLIENT_USER = buildUser({ id: 'client-1', role: UserRole.CLIENT });
    const TECHNICIAN_USER = buildUser({
      id: 'tech-1',
      role: UserRole.TECHNICIAN,
    });
    const ADMIN_USER = buildUser({ id: 'admin-1', role: UserRole.ADMIN });

    describe('role-based scoping', () => {
      it('CLIENT: forces createdById = currentUser.id and ignores assigneeId/createdById supplied in the query', async () => {
        const query = buildTicketQuery({
          assigneeId: 'someone-else-tech',
          createdById: 'someone-else-client',
        });

        await service.list(query, CLIENT_USER);

        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'ticket.createdById = :scopeOwnerId',
          { scopeOwnerId: 'client-1' },
        );
        expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
          'ticket.assigneeId = :assigneeId',
          { assigneeId: 'someone-else-tech' },
        );
        expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
          'ticket.createdById = :createdById',
          { createdById: 'someone-else-client' },
        );
        // No other filter was supplied: the scope clause must be the ONLY filter applied.
        expect(filterClauseCount(queryBuilder)).toBe(1);
      });

      it('TECHNICIAN: forces assigneeId = currentUser.id and ignores assigneeId/createdById supplied in the query', async () => {
        const query = buildTicketQuery({
          assigneeId: 'someone-else-tech',
          createdById: 'someone-else-client',
        });

        await service.list(query, TECHNICIAN_USER);

        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'ticket.assigneeId = :scopeAssigneeId',
          { scopeAssigneeId: 'tech-1' },
        );
        expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
          'ticket.assigneeId = :assigneeId',
          { assigneeId: 'someone-else-tech' },
        );
        expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
          'ticket.createdById = :createdById',
          { createdById: 'someone-else-client' },
        );
        expect(filterClauseCount(queryBuilder)).toBe(1);
      });

      it('ADMIN without assigneeId/createdById in the query: no scope is forced at all', async () => {
        const query = buildTicketQuery();

        await service.list(query, ADMIN_USER);

        expect(filterClauseCount(queryBuilder)).toBe(0);
      });

      it('ADMIN with assigneeId/createdById in the query: both are honored as regular filters', async () => {
        const query = buildTicketQuery({
          assigneeId: 'tech-2',
          createdById: 'client-2',
        });

        await service.list(query, ADMIN_USER);

        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'ticket.assigneeId = :assigneeId',
          { assigneeId: 'tech-2' },
        );
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'ticket.createdById = :createdById',
          { createdById: 'client-2' },
        );
        expect(filterClauseCount(queryBuilder)).toBe(2);
      });

      // P6.5 D12 — the guard is no longer TypeORM's to apply, so it is asserted, not assumed.
      // Without it, `withDeleted()` would make every soft-deleted ticket visible to every role.
      it('always excludes soft-deleted tickets explicitly, whatever the role and filters', async () => {
        for (const user of [CLIENT_USER, TECHNICIAN_USER, ADMIN_USER]) {
          queryBuilder.andWhere.mockClear();

          await service.list(buildTicketQuery(), user);

          expect(queryBuilder.withDeleted).toHaveBeenCalled();
          expect(queryBuilder.andWhere).toHaveBeenCalledWith(SOFT_DELETE_GUARD);
        }
      });
    });

    describe('filters', () => {
      it('applies status, priority and categoryId filters, in addition to the scope, when provided', async () => {
        const query = buildTicketQuery({
          status: TicketStatus.OPEN,
          priority: TicketPriority.HIGH,
          categoryId: 'category-9',
        });

        await service.list(query, ADMIN_USER);

        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'ticket.status = :status',
          { status: TicketStatus.OPEN },
        );
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'ticket.priority = :priority',
          { priority: TicketPriority.HIGH },
        );
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'ticket.categoryId = :categoryId',
          { categoryId: 'category-9' },
        );
      });

      it('applies an ILIKE clause matching title OR reference, with an explicit ESCAPE clause, when q is provided', async () => {
        const query = buildTicketQuery({ q: 'panne' });

        await service.list(query, ADMIN_USER);

        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          "(ticket.title ILIKE :q ESCAPE '\\' OR ticket.reference ILIKE :q ESCAPE '\\')",
          { q: '%panne%' },
        );
      });

      // Regression coverage for the ILIKE metacharacter bug: `%`/`_` typed by the user must be
      // escaped (in that order, backslash first) before being wrapped in `%...%`, or Postgres
      // would interpret them as wildcards instead of literal characters. This only proves the
      // STRING sent to the query builder is correctly escaped and carries the ESCAPE clause —
      // the e2e suite (`test/tickets.e2e-spec.ts`) is what proves Postgres actually honors it.
      it("escapes %, _ and \\ in q (backslash first) before wrapping it in %...%, and always includes ESCAPE '\\'", async () => {
        const query = buildTicketQuery({ q: '100%_a\\b' });

        await service.list(query, ADMIN_USER);

        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          "(ticket.title ILIKE :q ESCAPE '\\' OR ticket.reference ILIKE :q ESCAPE '\\')",
          { q: '%100\\%\\_a\\\\b%' },
        );
      });

      it('adds no filter clause at all when status/priority/categoryId/q are all omitted', async () => {
        const query = buildTicketQuery();

        await service.list(query, ADMIN_USER);

        expect(filterClauseCount(queryBuilder)).toBe(0);
      });
    });

    describe('sorting and pagination', () => {
      it('defaults to ORDER BY createdAt DESC when sort/order are omitted', async () => {
        const query = buildTicketQuery();

        await service.list(query, ADMIN_USER);

        expect(queryBuilder.orderBy).toHaveBeenCalledWith(
          'ticket.createdAt',
          'DESC',
        );
      });

      it('maps a whitelisted sort field to its real column and honors the requested order', async () => {
        const query = buildTicketQuery({ sort: 'priority', order: 'ASC' });

        await service.list(query, ADMIN_USER);

        expect(queryBuilder.orderBy).toHaveBeenCalledWith(
          'ticket.priority',
          'ASC',
        );
      });

      // Deliberately iterates the REAL `TICKET_SORT_FIELDS` constant imported from the DTO,
      // not a tableau recopié à la main here: a hardcoded list would keep passing even if
      // `TICKET_SORT_FIELDS` and `SORT_COLUMNS` silently drifted apart (e.g. a new sort field
      // added to the DTO without a matching `SORT_COLUMNS` entry — see `tickets.service.ts`'s
      // own compile-time guard against exactly that). Every whitelisted field here happens to
      // map to `ticket.<field>`, so that's the expected column for each.
      it('maps every whitelisted sort field (TICKET_SORT_FIELDS) to its own real ticket.<field> column', async () => {
        for (const sort of TICKET_SORT_FIELDS) {
          queryBuilder.orderBy.mockClear();
          await service.list(buildTicketQuery({ sort }), ADMIN_USER);
          expect(queryBuilder.orderBy).toHaveBeenCalledWith(
            `ticket.${sort}`,
            'DESC',
          );
        }
      });

      it('derives skip/take from page/limit via the shared pagination util (toTypeOrmSkipTake)', async () => {
        const query = buildTicketQuery({ page: 3, limit: 10 });

        await service.list(query, ADMIN_USER);

        expect(queryBuilder.skip).toHaveBeenCalledWith(20);
        expect(queryBuilder.take).toHaveBeenCalledWith(10);
      });

      it('returns a PaginatedResponseDto<TicketListItemDto> built from getManyAndCount, via the shared pagination util', async () => {
        const category = buildCategory({
          id: 'category-1',
          name: 'Panne électrique',
        });
        const assignee = buildUser({
          id: 'tech-1',
          username: 'tech1',
          role: UserRole.TECHNICIAN,
        });
        const ticket = buildTicket({
          id: 'ticket-1',
          category,
          assignee,
        });
        queryBuilder.getManyAndCount.mockResolvedValue([[ticket], 1]);
        const query = buildTicketQuery({ page: 1, limit: 20 });

        const result = await service.list(query, ADMIN_USER);

        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toBeInstanceOf(TicketListItemDto);
        expect(result.data[0].id).toBe('ticket-1');
        expect(result.data[0].category).toEqual({
          id: 'category-1',
          name: 'Panne électrique',
        });
        expect(result.data[0].assignee).toEqual({
          id: 'tech-1',
          username: 'tech1',
        });
        // The list DTO is deliberately lightweight: no `description`, no `password`.
        expect(result.data[0]).not.toHaveProperty('description');
        expect(result.data[0]).not.toHaveProperty('password');
        expect(result.meta).toEqual({
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        });
      });

      it('returns a null assignee in the DTO when the ticket has none', async () => {
        const category = buildCategory();
        const ticket = buildTicket({ category, assignee: null });
        queryBuilder.getManyAndCount.mockResolvedValue([[ticket], 1]);

        const result = await service.list(buildTicketQuery(), ADMIN_USER);

        expect(result.data[0].assignee).toBeNull();
      });
    });
  });

  describe('update', () => {
    const ADMIN_USER = buildUser({ id: 'admin-1', role: UserRole.ADMIN });
    const OWNER_CLIENT = buildUser({ id: 'client-1', role: UserRole.CLIENT });
    const OTHER_CLIENT = buildUser({ id: 'client-2', role: UserRole.CLIENT });
    const TECHNICIAN_USER = buildUser({
      id: 'tech-1',
      role: UserRole.TECHNICIAN,
    });

    it('ADMIN: applies the given fields regardless of status, and returns the reloaded ticket', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        createdById: 'client-1',
        status: TicketStatus.IN_PROGRESS,
        title: 'old title',
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      ticketRepository.save.mockResolvedValue(existingTicket);
      const hydratedTicket = buildTicket({
        id: 'ticket-1',
        title: 'new title',
      });
      queryBuilder.getOne.mockResolvedValue(hydratedTicket);

      const dto: UpdateTicketDto = { title: 'new title' };
      const result = await service.update('ticket-1', dto, ADMIN_USER);

      expect(ticketRepository.findOneBy).toHaveBeenCalledWith({
        id: 'ticket-1',
      });
      expect(ticketRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ticket-1', title: 'new title' }),
      );
      expect(result).toBe(hydratedTicket);
    });

    it('CLIENT owner with an OPEN ticket: allowed, applies the given fields', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        createdById: 'client-1',
        status: TicketStatus.OPEN,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      ticketRepository.save.mockResolvedValue(existingTicket);
      const hydratedTicket = buildTicket({ id: 'ticket-1' });
      queryBuilder.getOne.mockResolvedValue(hydratedTicket);

      const result = await service.update(
        'ticket-1',
        { title: 'Updated title' },
        OWNER_CLIENT,
      );

      expect(ticketRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated title' }),
      );
      expect(result).toBe(hydratedTicket);
    });

    it('CLIENT owner with a non-OPEN ticket (e.g. ASSIGNED): forbidden, never saves', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        createdById: 'client-1',
        status: TicketStatus.ASSIGNED,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);

      await expect(
        service.update('ticket-1', { title: 'Updated title' }, OWNER_CLIENT),
      ).rejects.toThrow(ForbiddenException);

      expect(ticketRepository.save).not.toHaveBeenCalled();
    });

    it('CLIENT who is not the owner: forbidden, never saves', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        createdById: 'client-1',
        status: TicketStatus.OPEN,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);

      await expect(
        service.update('ticket-1', { title: 'Updated title' }, OTHER_CLIENT),
      ).rejects.toThrow(ForbiddenException);

      expect(ticketRepository.save).not.toHaveBeenCalled();
    });

    it('TECHNICIAN, even when assigned to the ticket: forbidden, never saves', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        createdById: 'client-1',
        assigneeId: 'tech-1',
        status: TicketStatus.OPEN,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);

      await expect(
        service.update('ticket-1', { title: 'Updated title' }, TECHNICIAN_USER),
      ).rejects.toThrow(ForbiddenException);

      expect(ticketRepository.save).not.toHaveBeenCalled();
    });

    it('an empty DTO (no field at all): rejected with BadRequestException, never saves', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.OPEN,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);

      await expect(service.update('ticket-1', {}, ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );

      expect(ticketRepository.save).not.toHaveBeenCalled();
    });

    it('an unknown or inactive categoryId: rejected with NotFoundException, never saves', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.OPEN,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      categoryRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update(
          'ticket-1',
          { categoryId: 'category-missing' },
          ADMIN_USER,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(categoryRepository.findOneBy).toHaveBeenCalledWith({
        id: 'category-missing',
        isActive: true,
      });
      expect(ticketRepository.save).not.toHaveBeenCalled();
    });

    it('recomputes slaDueAt to an exact date when priority actually changes', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-05T10:00:00.000Z') });
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.OPEN,
        priority: TicketPriority.NORMAL,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      const policy = buildSlaPolicy({
        priority: TicketPriority.CRITICAL,
        resolutionTargetMinutes: 240,
      });
      slaPolicyRepository.findOneBy.mockResolvedValue(policy);
      ticketRepository.save.mockResolvedValue(existingTicket);
      const hydratedTicket = buildTicket({ id: 'ticket-1' });
      queryBuilder.getOne.mockResolvedValue(hydratedTicket);

      await service.update(
        'ticket-1',
        { priority: TicketPriority.CRITICAL },
        ADMIN_USER,
      );

      expect(slaPolicyRepository.findOneBy).toHaveBeenCalledWith({
        priority: TicketPriority.CRITICAL,
      });
      const expectedSlaDueAt = new Date('2026-08-05T10:00:00.000Z');
      expectedSlaDueAt.setMinutes(expectedSlaDueAt.getMinutes() + 240);
      expect(ticketRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: TicketPriority.CRITICAL,
          slaDueAt: expectedSlaDueAt,
        }),
      );
    });

    it('does NOT recompute slaDueAt when priority is provided but unchanged', async () => {
      const unchangedSlaDueAt = new Date('2026-01-01T00:00:00.000Z');
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.OPEN,
        priority: TicketPriority.NORMAL,
        slaDueAt: unchangedSlaDueAt,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      ticketRepository.save.mockResolvedValue(existingTicket);
      const hydratedTicket = buildTicket({ id: 'ticket-1' });
      queryBuilder.getOne.mockResolvedValue(hydratedTicket);

      await service.update(
        'ticket-1',
        { priority: TicketPriority.NORMAL },
        ADMIN_USER,
      );

      expect(slaPolicyRepository.findOneBy).not.toHaveBeenCalled();
      expect(ticketRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ slaDueAt: unchangedSlaDueAt }),
      );
    });

    it('throws NotFoundException, and never saves, when the ticket does not exist', async () => {
      ticketRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { title: 'x' }, ADMIN_USER),
      ).rejects.toThrow(NotFoundException);

      expect(ticketRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('soft deletes the ticket by id via the TypeORM repository (never a hard delete)', async () => {
      const existingTicket = buildTicket({ id: 'ticket-1' });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      ticketRepository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await service.softDelete('ticket-1');

      expect(ticketRepository.findOneBy).toHaveBeenCalledWith({
        id: 'ticket-1',
      });
      expect(ticketRepository.softDelete).toHaveBeenCalledWith('ticket-1');
    });

    it('throws NotFoundException, and never calls softDelete, when the ticket does not exist', async () => {
      ticketRepository.findOneBy.mockResolvedValue(null);

      await expect(service.softDelete('missing-id')).rejects.toThrow(
        NotFoundException,
      );

      expect(ticketRepository.softDelete).not.toHaveBeenCalled();
    });
  });

  // T4.4 — status transitions (start/resolve/reopen/close/cancel). Deliberately exercises the
  // REAL `evaluateTicketTransition` (P3), never a mock of it: these tests build tickets/actors
  // in the exact states the machine cares about and assert on the resulting DB writes, so a
  // change to the machine's rules that silently breaks the service would fail here too.
  describe('status transitions (start/resolve/reopen/close/cancel)', () => {
    const ADMIN_USER = buildUser({ id: 'admin-1', role: UserRole.ADMIN });
    const OWNER_CLIENT = buildUser({ id: 'client-1', role: UserRole.CLIENT });
    const ASSIGNED_TECHNICIAN = buildUser({
      id: 'tech-1',
      role: UserRole.TECHNICIAN,
    });
    const OTHER_TECHNICIAN = buildUser({
      id: 'tech-2',
      role: UserRole.TECHNICIAN,
    });

    describe('start (START)', () => {
      it('the technician assigned to an ASSIGNED ticket: moves to IN_PROGRESS, stamps startedAt, and writes a matching ticket_status_history row', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.ASSIGNED,
          assigneeId: ASSIGNED_TECHNICIAN.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        const hydrated = buildTicket({ id: 'ticket-1' });
        queryBuilder.getOne.mockResolvedValue(hydrated);

        const result = await service.start('ticket-1', ASSIGNED_TECHNICIAN);

        expect(ticketRepository.findOneBy).toHaveBeenCalledWith({
          id: 'ticket-1',
        });
        // Mutated in place, then handed to `em.save` — same reference throughout.
        expect(existingTicket.status).toBe(TicketStatus.IN_PROGRESS);
        expect(existingTicket.startedAt).toBeInstanceOf(Date);
        expect(transactionEntityManager.save).toHaveBeenNthCalledWith(
          1,
          existingTicket,
        );
        expect(transactionEntityManager.create).toHaveBeenCalledWith(
          TicketStatusHistory,
          {
            ticketId: 'ticket-1',
            fromStatus: TicketStatus.ASSIGNED,
            toStatus: TicketStatus.IN_PROGRESS,
            changedById: ASSIGNED_TECHNICIAN.id,
            note: null,
          },
        );
        expect(transactionEntityManager.save).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            ticketId: 'ticket-1',
            fromStatus: TicketStatus.ASSIGNED,
            toStatus: TicketStatus.IN_PROGRESS,
            changedById: ASSIGNED_TECHNICIAN.id,
            note: null,
          }),
        );
        expect(result).toBe(hydrated);
      });

      it('an ADMIN (not the assignee): also allowed', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.ASSIGNED,
          assigneeId: ASSIGNED_TECHNICIAN.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));

        await service.start('ticket-1', ADMIN_USER);

        expect(existingTicket.status).toBe(TicketStatus.IN_PROGRESS);
        expect(existingTicket.startedAt).toBeInstanceOf(Date);
      });

      it('a TECHNICIAN who is NOT the assignee: forbidden (GUARD_FAILED), never writes', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.ASSIGNED,
          assigneeId: ASSIGNED_TECHNICIAN.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);

        await expect(
          service.start('ticket-1', OTHER_TECHNICIAN),
        ).rejects.toThrow(ForbiddenException);

        expect(existingTicket.status).toBe(TicketStatus.ASSIGNED);
        expect(transactionMock).not.toHaveBeenCalled();
      });

      it('START on an OPEN ticket: conflict (INVALID_TRANSITION — not a defined event from OPEN)', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.OPEN,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);

        await expect(service.start('ticket-1', ADMIN_USER)).rejects.toThrow(
          ConflictException,
        );

        expect(transactionMock).not.toHaveBeenCalled();
      });
    });

    describe('resolve (RESOLVE)', () => {
      const resolveDto: ResolveTicketDto = {
        resolutionNote: 'Climatiseur remis en service.',
      };

      it('the assigned technician, with a resolutionNote, on IN_PROGRESS: moves to RESOLVED, stamps resolvedAt/resolutionNote, and writes history', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.IN_PROGRESS,
          assigneeId: ASSIGNED_TECHNICIAN.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));

        await service.resolve('ticket-1', resolveDto, ASSIGNED_TECHNICIAN);

        expect(existingTicket.status).toBe(TicketStatus.RESOLVED);
        expect(existingTicket.resolvedAt).toBeInstanceOf(Date);
        expect(existingTicket.resolutionNote).toBe(resolveDto.resolutionNote);
        expect(transactionEntityManager.create).toHaveBeenCalledWith(
          TicketStatusHistory,
          {
            ticketId: 'ticket-1',
            fromStatus: TicketStatus.IN_PROGRESS,
            toStatus: TicketStatus.RESOLVED,
            changedById: ASSIGNED_TECHNICIAN.id,
            note: resolveDto.resolutionNote,
          },
        );
      });

      it('an ADMIN (not the assigned technician): forbidden (GUARD_FAILED — RESOLVE requires the assignee), never writes', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.IN_PROGRESS,
          assigneeId: ASSIGNED_TECHNICIAN.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);

        await expect(
          service.resolve('ticket-1', resolveDto, ADMIN_USER),
        ).rejects.toThrow(ForbiddenException);

        expect(existingTicket.status).toBe(TicketStatus.IN_PROGRESS);
        expect(transactionMock).not.toHaveBeenCalled();
      });
    });

    describe('reopen (REOPEN)', () => {
      it('the owner CLIENT, with a reason, on RESOLVED: moves to IN_PROGRESS, clears resolvedAt/resolutionNote, and traces the reason in history', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.RESOLVED,
          createdById: OWNER_CLIENT.id,
          resolvedAt: new Date('2026-01-01T00:00:00.000Z'),
          resolutionNote: 'Ancienne note de résolution',
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));
        const dto: ReasonDto = { reason: 'Le problème persiste' };

        await service.reopen('ticket-1', dto, OWNER_CLIENT);

        expect(existingTicket.status).toBe(TicketStatus.IN_PROGRESS);
        expect(existingTicket.resolvedAt).toBeNull();
        expect(existingTicket.resolutionNote).toBeNull();
        expect(transactionEntityManager.create).toHaveBeenCalledWith(
          TicketStatusHistory,
          {
            ticketId: 'ticket-1',
            fromStatus: TicketStatus.RESOLVED,
            toStatus: TicketStatus.IN_PROGRESS,
            changedById: OWNER_CLIENT.id,
            note: dto.reason,
          },
        );
      });

      it('the owner CLIENT WITHOUT a reason: forbidden (GUARD_FAILED — REOPEN requires a reason), never writes', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.RESOLVED,
          createdById: OWNER_CLIENT.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);

        await expect(
          service.reopen('ticket-1', {}, OWNER_CLIENT),
        ).rejects.toThrow(ForbiddenException);

        expect(existingTicket.status).toBe(TicketStatus.RESOLVED);
        expect(transactionMock).not.toHaveBeenCalled();
      });

      it('an ADMIN, with a reason, even when not the owner: allowed', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.RESOLVED,
          createdById: 'someone-else',
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));

        await service.reopen(
          'ticket-1',
          { reason: 'Réouverture décidée par un admin' },
          ADMIN_USER,
        );

        expect(existingTicket.status).toBe(TicketStatus.IN_PROGRESS);
      });
    });

    describe('close (CLOSE)', () => {
      it('an ADMIN, on RESOLVED: moves to CLOSED, stamps closedAt, writes history', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.RESOLVED,
          createdById: 'someone-else',
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));

        await service.close('ticket-1', ADMIN_USER);

        expect(existingTicket.status).toBe(TicketStatus.CLOSED);
        expect(existingTicket.closedAt).toBeInstanceOf(Date);
        expect(transactionEntityManager.create).toHaveBeenCalledWith(
          TicketStatusHistory,
          {
            ticketId: 'ticket-1',
            fromStatus: TicketStatus.RESOLVED,
            toStatus: TicketStatus.CLOSED,
            changedById: ADMIN_USER.id,
            note: null,
          },
        );
      });

      it('the owner CLIENT, on RESOLVED: also allowed, moves to CLOSED', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.RESOLVED,
          createdById: OWNER_CLIENT.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));

        await service.close('ticket-1', OWNER_CLIENT);

        expect(existingTicket.status).toBe(TicketStatus.CLOSED);
        expect(existingTicket.closedAt).toBeInstanceOf(Date);
      });
    });

    describe('cancel (CANCEL)', () => {
      it('the owner CLIENT, on OPEN: moves to CANCELLED, stamps cancelledAt, writes history', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.OPEN,
          createdById: OWNER_CLIENT.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));

        await service.cancel('ticket-1', {}, OWNER_CLIENT);

        expect(existingTicket.status).toBe(TicketStatus.CANCELLED);
        expect(existingTicket.cancelledAt).toBeInstanceOf(Date);
        expect(transactionEntityManager.create).toHaveBeenCalledWith(
          TicketStatusHistory,
          {
            ticketId: 'ticket-1',
            fromStatus: TicketStatus.OPEN,
            toStatus: TicketStatus.CANCELLED,
            changedById: OWNER_CLIENT.id,
            note: null,
          },
        );
      });

      it('the owner CLIENT, on ASSIGNED: forbidden (GUARD_FAILED — a CLIENT may only cancel from OPEN), never writes', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.ASSIGNED,
          createdById: OWNER_CLIENT.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);

        await expect(
          service.cancel('ticket-1', {}, OWNER_CLIENT),
        ).rejects.toThrow(ForbiddenException);

        expect(existingTicket.status).toBe(TicketStatus.ASSIGNED);
        expect(transactionMock).not.toHaveBeenCalled();
      });

      it('CANCEL on a RESOLVED ticket: conflict (INVALID_TRANSITION — CANCEL is not defined from RESOLVED)', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.RESOLVED,
          createdById: OWNER_CLIENT.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);

        await expect(
          service.cancel('ticket-1', {}, OWNER_CLIENT),
        ).rejects.toThrow(ConflictException);

        expect(transactionMock).not.toHaveBeenCalled();
      });
    });

    describe('atomicity — status update and history insert share one transaction', () => {
      it('both writes happen inside a single manager.transaction call, in order (ticket first, then the history row)', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.OPEN,
          createdById: OWNER_CLIENT.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));

        await service.cancel('ticket-1', {}, OWNER_CLIENT);

        expect(transactionMock).toHaveBeenCalledTimes(1);
        expect(transactionEntityManager.save).toHaveBeenCalledTimes(2);
        expect(transactionEntityManager.save).toHaveBeenNthCalledWith(
          1,
          existingTicket,
        );
        expect(transactionEntityManager.save.mock.calls[1][0]).toBeInstanceOf(
          TicketStatusHistory,
        );
      });

      it('propagates a failure from the ticket_status_history insert; both writes were attempted inside the SAME manager.transaction call, which is what makes a real DB transaction roll the ticket update back too', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.OPEN,
          createdById: OWNER_CLIENT.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        transactionEntityManager.save
          .mockImplementationOnce((entity: unknown) => Promise.resolve(entity))
          .mockImplementationOnce(() =>
            Promise.reject(new Error('history insert failed')),
          );

        await expect(
          service.cancel('ticket-1', {}, OWNER_CLIENT),
        ).rejects.toThrow('history insert failed');

        expect(transactionMock).toHaveBeenCalledTimes(1);
        expect(transactionEntityManager.save).toHaveBeenCalledTimes(2);
        // The post-transaction reload (`getById`) is never reached once the transaction
        // itself rejects.
        expect(queryBuilder.getOne).not.toHaveBeenCalled();
      });
    });

    // P6 contract §4: `ticket.status-changed` is emitted by `applyTransition` (the private
    // method behind every one of `start`/`resolve`/`reopen`/`close`/`cancel`), strictly AFTER
    // `manager.transaction(...)` has returned and after the reload.
    describe('emits ticket.status-changed (P6 contract §4)', () => {
      it('emits exactly once, after commit+reload, with the exact TicketStatusChangedEvent payload -- fromStatus/toStatus captured around the write', async () => {
        jest.useFakeTimers({ now: new Date('2026-08-07T08:00:00.000Z') });
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.OPEN,
          createdById: OWNER_CLIENT.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        const hydratedTicket = buildTicket({
          id: 'ticket-1',
          reference: 'TCK-000010',
          title: 'Climatisation en panne',
          createdById: OWNER_CLIENT.id,
          assigneeId: null,
          status: TicketStatus.CANCELLED,
        });
        queryBuilder.getOne.mockResolvedValue(hydratedTicket);

        await service.cancel('ticket-1', {}, OWNER_CLIENT);

        const expectedPayload: TicketStatusChangedEvent = {
          ticketId: 'ticket-1',
          reference: 'TCK-000010',
          title: 'Climatisation en panne',
          actorId: OWNER_CLIENT.id,
          createdById: OWNER_CLIENT.id,
          assigneeId: null,
          occurredAt: '2026-08-07T08:00:00.000Z',
          fromStatus: TicketStatus.OPEN,
          toStatus: TicketStatus.CANCELLED,
        };
        expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          TICKET_STATUS_CHANGED,
          expectedPayload,
        );
      });

      // D1, the core requirement of this task, exercised here through `applyTransition` (via
      // `start`) exactly like the dedicated `assign()` ordering test above: both mocks record
      // their own completion into the SAME array, in real invocation order.
      it('D1: emits ticket.status-changed strictly AFTER manager.transaction(...) has resolved, never before', async () => {
        const callOrder: string[] = [];
        transactionMock.mockImplementation(async (callback) => {
          await callback(transactionEntityManager as unknown as EntityManager);
          callOrder.push('transaction-committed');
        });
        eventEmitter.emit.mockImplementation((event: string) => {
          callOrder.push(`emit:${event}`);
          return true;
        });
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.ASSIGNED,
          assigneeId: ASSIGNED_TECHNICIAN.id,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));

        await service.start('ticket-1', ASSIGNED_TECHNICIAN);

        expect(callOrder).toEqual([
          'transaction-committed',
          `emit:${TICKET_STATUS_CHANGED}`,
        ]);
      });
    });
  });

  // T5.3 — `GET /tickets/:id/assignment-suggestions`. Pure delegation: no eligibility/ranking
  // rule is exercised or asserted here, that belongs to `TechnicianSuggestionService`'s own
  // spec (T5.1b).
  describe('getAssignmentSuggestions', () => {
    it('delegates directly to TechnicianSuggestionService.suggestForTicket with the given ticketId/limit, and returns its result as-is', async () => {
      const suggestion = Object.assign(new TechnicianSuggestionDto(), {
        technicianId: 'tech-1',
        username: 'tech1',
        firstName: null,
        lastName: null,
        skillLevel: 3,
        currentLoad: 0,
        maxConcurrentTickets: 5,
      });
      technicianSuggestionService.suggestForTicket.mockResolvedValue([
        suggestion,
      ]);

      const result = await service.getAssignmentSuggestions('ticket-1', 10);

      expect(technicianSuggestionService.suggestForTicket).toHaveBeenCalledWith(
        'ticket-1',
        10,
      );
      expect(result).toEqual([suggestion]);
    });
  });

  // T5.3 — `POST /tickets/:id/assign` (P5 contract §4.2). Deliberately exercises the REAL
  // `evaluateTicketTransition` (P3, never mocked) the same way the T4.4 suite above does: only
  // `TechnicianSuggestionService.evaluateEligibility` (D1, T5.1b's own concern) is mocked.
  describe('assign', () => {
    const ADMIN_USER = buildUser({ id: 'admin-1', role: UserRole.ADMIN });
    const dto: AssignTicketDto = { technicianId: 'tech-1' };

    it('throws NotFoundException, and never checks eligibility, when the ticket does not exist', async () => {
      ticketRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.assign('missing-id', dto, ADMIN_USER),
      ).rejects.toThrow(NotFoundException);

      expect(
        technicianSuggestionService.evaluateEligibility,
      ).not.toHaveBeenCalled();
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("D5: throws BadRequestException, and never checks eligibility nor writes anything, when technicianId already equals the ticket's current assignee", async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.ASSIGNED,
        assigneeId: 'tech-1',
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);

      await expect(
        service.assign('ticket-1', { technicianId: 'tech-1' }, ADMIN_USER),
      ).rejects.toThrow(BadRequestException);

      expect(
        technicianSuggestionService.evaluateEligibility,
      ).not.toHaveBeenCalled();
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('D1: throws ForbiddenException, carrying the eligibility reason, and never writes, when the target technician is not eligible (first assignment)', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.OPEN,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      technicianSuggestionService.evaluateEligibility.mockResolvedValue(
        buildEligibility({ eligible: false, reason: 'AT_CAPACITY' }),
      );

      await expect(service.assign('ticket-1', dto, ADMIN_USER)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.assign('ticket-1', dto, ADMIN_USER)).rejects.toThrow(
        'AT_CAPACITY',
      );

      expect(transactionMock).not.toHaveBeenCalled();
    });

    // The most important case (brief §"Critères d'acceptation"): D2 exists precisely because
    // the P3 guard `canReassignFromAssigned` alone (ADMIN + hasReason) would NOT catch this —
    // only the eligibility pre-check does.
    it('D1/D2: throws ForbiddenException, and never writes, when REASSIGNING (WITH a reason) to a technician who is not eligible', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.ASSIGNED,
        assigneeId: 'tech-2',
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      technicianSuggestionService.evaluateEligibility.mockResolvedValue(
        buildEligibility({ eligible: false, reason: 'UNAVAILABLE' }),
      );

      await expect(
        service.assign(
          'ticket-1',
          { technicianId: 'tech-1', reason: 'Motif de réaffectation' },
          ADMIN_USER,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('409 (INVALID_TRANSITION) on a CLOSED ticket, even though the target technician IS eligible: the eligibility pre-check never bypasses the P3 evaluator', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.CLOSED,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      technicianSuggestionService.evaluateEligibility.mockResolvedValue(
        buildEligibility(),
      );

      await expect(service.assign('ticket-1', dto, ADMIN_USER)).rejects.toThrow(
        ConflictException,
      );

      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('reassigning an ASSIGNED ticket WITHOUT a reason: forbidden (GUARD_FAILED — canReassignFromAssigned requires one), never writes, even though the target technician IS eligible', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.ASSIGNED,
        assigneeId: 'tech-2',
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      technicianSuggestionService.evaluateEligibility.mockResolvedValue(
        buildEligibility(),
      );

      await expect(
        service.assign('ticket-1', { technicianId: 'tech-1' }, ADMIN_USER),
      ).rejects.toThrow(ForbiddenException);

      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('first assignment from OPEN: moves the ticket to ASSIGNED, stamps assigneeId/assignedAt, leaves slaDueAt untouched (D7), and creates a ticket_assignments row with NO previous one to close', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-06T10:00:00.000Z') });
      const originalSlaDueAt = new Date('2026-01-01T00:00:00.000Z');
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.OPEN,
        slaDueAt: originalSlaDueAt,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      const hydratedTicket = buildTicket({ id: 'ticket-1' });
      queryBuilder.getOne.mockResolvedValue(hydratedTicket);
      technicianSuggestionService.evaluateEligibility.mockResolvedValue(
        buildEligibility(),
      );

      const result = await service.assign(
        'ticket-1',
        { technicianId: 'tech-1', isAutoSuggested: true },
        ADMIN_USER,
      );

      expect(
        technicianSuggestionService.evaluateEligibility,
      ).toHaveBeenCalledWith('tech-1');
      const [findOneEntity, findOneOptions] =
        transactionEntityManager.findOne.mock.calls[0];
      expect(findOneEntity).toBe(TicketAssignment);
      expect(findOneOptions.where).toEqual(
        expect.objectContaining({ ticketId: 'ticket-1' }),
      );
      // No previous assignment to close: exactly 3 saves (new assignment, ticket, history).
      expect(transactionEntityManager.save).toHaveBeenCalledTimes(3);
      expect(transactionEntityManager.save.mock.calls[0][0]).toMatchObject({
        ticketId: 'ticket-1',
        technicianId: 'tech-1',
        assignedById: 'admin-1',
        isAutoSuggested: true,
        unassignedAt: null,
      });
      expect(transactionEntityManager.save.mock.calls[1][0]).toBe(
        existingTicket,
      );
      expect(existingTicket.assigneeId).toBe('tech-1');
      expect(existingTicket.status).toBe(TicketStatus.ASSIGNED);
      expect(existingTicket.assignedAt).toEqual(
        new Date('2026-08-06T10:00:00.000Z'),
      );
      // D7: slaDueAt is NEVER recomputed at assignment.
      expect(existingTicket.slaDueAt).toBe(originalSlaDueAt);
      expect(transactionEntityManager.save.mock.calls[2][0]).toBeInstanceOf(
        TicketStatusHistory,
      );
      expect(transactionEntityManager.create).toHaveBeenCalledWith(
        TicketStatusHistory,
        {
          ticketId: 'ticket-1',
          fromStatus: TicketStatus.OPEN,
          toStatus: TicketStatus.ASSIGNED,
          changedById: 'admin-1',
          note: null,
        },
      );
      expect(result).toBe(hydratedTicket);
    });

    // P6 contract §4: `ticket.assigned` is emitted strictly AFTER `manager.transaction(...)`
    // has returned and after the reload -- see the dedicated ordering test below (D1). This
    // test asserts the payload itself, exactly, for a FIRST assignment (previousAssigneeId is
    // `null`, per `TicketAssignedEvent`'s own contract).
    it('emits ticket.assigned exactly once, after commit+reload, with the exact TicketAssignedEvent payload -- previousAssigneeId=null on a first assignment', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-06T10:00:00.000Z') });
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.OPEN,
        assigneeId: null,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      const hydratedTicket = buildTicket({
        id: 'ticket-1',
        reference: 'TCK-000007',
        title: 'Climatisation en panne',
        createdById: 'client-9',
        assigneeId: 'tech-1',
      });
      queryBuilder.getOne.mockResolvedValue(hydratedTicket);
      technicianSuggestionService.evaluateEligibility.mockResolvedValue(
        buildEligibility(),
      );

      await service.assign('ticket-1', { technicianId: 'tech-1' }, ADMIN_USER);

      const expectedPayload: TicketAssignedEvent = {
        ticketId: 'ticket-1',
        reference: 'TCK-000007',
        title: 'Climatisation en panne',
        actorId: 'admin-1',
        createdById: 'client-9',
        assigneeId: 'tech-1',
        occurredAt: '2026-08-06T10:00:00.000Z',
        previousAssigneeId: null,
      };
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        TICKET_ASSIGNED,
        expectedPayload,
      );
    });

    // D1, the core requirement of this task: proves the emission happens strictly AFTER
    // `manager.transaction(...)` has resolved (i.e. committed), never from inside its callback.
    // Both mocks record their own completion into the SAME array, in real invocation order --
    // a naive "was emit called" assertion could never catch an emission moved inside the
    // transaction, only this ordering check can.
    it('D1: emits ticket.assigned strictly AFTER manager.transaction(...) has resolved, never before', async () => {
      const callOrder: string[] = [];
      transactionMock.mockImplementation(async (callback) => {
        await callback(transactionEntityManager as unknown as EntityManager);
        callOrder.push('transaction-committed');
      });
      eventEmitter.emit.mockImplementation((event: string) => {
        callOrder.push(`emit:${event}`);
        return true;
      });
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.OPEN,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));
      technicianSuggestionService.evaluateEligibility.mockResolvedValue(
        buildEligibility(),
      );

      await service.assign('ticket-1', { technicianId: 'tech-1' }, ADMIN_USER);

      expect(callOrder).toEqual([
        'transaction-committed',
        `emit:${TICKET_ASSIGNED}`,
      ]);
    });

    // Contract §4: "Une affectation produit ticket.assigned uniquement" -- `assign()` also
    // writes a `ticket_status_history` row (asserted elsewhere in this file), but that write
    // must never additionally raise `ticket.status-changed`, or a single assignment would
    // notify twice.
    it('emits ONLY ticket.assigned -- never also ticket.status-changed', async () => {
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.OPEN,
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));
      technicianSuggestionService.evaluateEligibility.mockResolvedValue(
        buildEligibility(),
      );

      await service.assign('ticket-1', dto, ADMIN_USER);

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        TICKET_ASSIGNED,
        expect.anything(),
      );
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        TICKET_STATUS_CHANGED,
        expect.anything(),
      );
    });

    it('reassignment from ASSIGNED, WITH a reason: closes the previous ticket_assignments row (unassignedAt set), creates the new one, updates the ticket, and writes history — all inside the same transaction', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-06T12:00:00.000Z') });
      const existingTicket = buildTicket({
        id: 'ticket-1',
        status: TicketStatus.ASSIGNED,
        assigneeId: 'tech-2',
      });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      queryBuilder.getOne.mockResolvedValue(
        // `assigneeId`/`createdById` set explicitly (rather than the bare `buildTicket({ id })`
        // used elsewhere): this test also asserts the exact `ticket.assigned` event payload
        // below, which needs both to be non-undefined.
        buildTicket({
          id: 'ticket-1',
          assigneeId: 'tech-1',
          createdById: 'client-1',
        }),
      );
      technicianSuggestionService.evaluateEligibility.mockResolvedValue(
        buildEligibility(),
      );
      const previousAssignment = buildTicketAssignment({
        id: 'assignment-old',
        ticketId: 'ticket-1',
        technicianId: 'tech-2',
        unassignedAt: null,
      });
      transactionEntityManager.findOne.mockResolvedValue(previousAssignment);

      const reason = 'Le technicien précédent est indisponible.';
      await service.assign(
        'ticket-1',
        { technicianId: 'tech-1', reason },
        ADMIN_USER,
      );

      expect(previousAssignment.unassignedAt).toEqual(
        new Date('2026-08-06T12:00:00.000Z'),
      );
      expect(transactionEntityManager.save).toHaveBeenCalledTimes(4);
      expect(transactionEntityManager.save.mock.calls[0][0]).toBe(
        previousAssignment,
      );
      expect(transactionEntityManager.save.mock.calls[1][0]).toMatchObject({
        ticketId: 'ticket-1',
        technicianId: 'tech-1',
        reason,
        unassignedAt: null,
      });
      expect(transactionEntityManager.save.mock.calls[2][0]).toBe(
        existingTicket,
      );
      expect(existingTicket.assigneeId).toBe('tech-1');
      expect(existingTicket.status).toBe(TicketStatus.ASSIGNED);
      expect(transactionEntityManager.create).toHaveBeenCalledWith(
        TicketStatusHistory,
        {
          ticketId: 'ticket-1',
          fromStatus: TicketStatus.ASSIGNED,
          toStatus: TicketStatus.ASSIGNED,
          changedById: 'admin-1',
          note: reason,
        },
      );
      // `previousAssigneeId` on the emitted event is the PRIOR technician ('tech-2'), not
      // `null` -- a mutation that hardcoded `null` here would leave this assertion red.
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        TICKET_ASSIGNED,
        expect.objectContaining({
          previousAssigneeId: 'tech-2',
          assigneeId: 'tech-1',
        }),
      );
    });

    describe('atomicity — assignment/ticket/history writes share one transaction', () => {
      it('every write happens inside a single manager.transaction call', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.OPEN,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        queryBuilder.getOne.mockResolvedValue(buildTicket({ id: 'ticket-1' }));
        technicianSuggestionService.evaluateEligibility.mockResolvedValue(
          buildEligibility(),
        );

        await service.assign('ticket-1', dto, ADMIN_USER);

        expect(transactionMock).toHaveBeenCalledTimes(1);
      });

      it('propagates a failure from the ticket_status_history insert; nothing is left partially committed, since every write was attempted inside the SAME manager.transaction call', async () => {
        const existingTicket = buildTicket({
          id: 'ticket-1',
          status: TicketStatus.OPEN,
        });
        ticketRepository.findOneBy.mockResolvedValue(existingTicket);
        technicianSuggestionService.evaluateEligibility.mockResolvedValue(
          buildEligibility(),
        );
        transactionEntityManager.save
          .mockImplementationOnce((entity: unknown) => Promise.resolve(entity)) // new assignment
          .mockImplementationOnce((entity: unknown) => Promise.resolve(entity)) // ticket
          .mockImplementationOnce(() =>
            Promise.reject(new Error('history insert failed')),
          );

        await expect(
          service.assign('ticket-1', dto, ADMIN_USER),
        ).rejects.toThrow('history insert failed');

        expect(transactionMock).toHaveBeenCalledTimes(1);
        expect(transactionEntityManager.save).toHaveBeenCalledTimes(3);
        // The post-transaction reload (`getById`) is never reached once the transaction itself
        // rejects.
        expect(queryBuilder.getOne).not.toHaveBeenCalled();
      });
    });
  });

  // T5.3 — `GET /tickets/:id/assignments` (P5 contract §4.4).
  describe('getAssignmentHistory', () => {
    it('throws NotFoundException, and never queries ticket_assignments, when the ticket does not exist', async () => {
      ticketRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getAssignmentHistory('missing-id')).rejects.toThrow(
        NotFoundException,
      );

      expect(ticketAssignmentRepository.find).not.toHaveBeenCalled();
    });

    it('returns every ticket_assignments row for the ticket, sorted assignedAt DESC, with technician/assignedBy relations requested', async () => {
      const existingTicket = buildTicket({ id: 'ticket-1' });
      ticketRepository.findOneBy.mockResolvedValue(existingTicket);
      const assignments = [buildTicketAssignment()];
      ticketAssignmentRepository.find.mockResolvedValue(assignments);

      const result = await service.getAssignmentHistory('ticket-1');

      expect(ticketAssignmentRepository.find).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1' },
        relations: { technician: true, assignedBy: true },
        order: { assignedAt: 'DESC' },
      });
      expect(result).toBe(assignments);
    });
  });
});
