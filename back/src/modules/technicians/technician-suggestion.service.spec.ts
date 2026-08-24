import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Category } from '../categories/entities/category.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { TechnicianSuggestionRawRow } from './dto/technician-suggestion.dto';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianSuggestionService } from './technician-suggestion.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.username = 'jtech';
  user.role = UserRole.TECHNICIAN;
  user.isActive = true;
  user.deletedAt = null;
  Object.assign(user, overrides);
  return user;
}

function buildProfile(
  overrides: Partial<TechnicianProfile> = {},
): TechnicianProfile {
  const profile = new TechnicianProfile();
  profile.id = 'profile-1';
  profile.userId = 'user-1';
  profile.isAvailable = true;
  profile.maxConcurrentTickets = 5;
  Object.assign(profile, overrides);
  return profile;
}

function buildCategory(overrides: Partial<Category> = {}): Category {
  const category = new Category();
  category.id = 'category-1';
  category.name = 'Panne électrique';
  category.requiredSkillId = null;
  Object.assign(category, overrides);
  return category;
}

function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  const ticket = new Ticket();
  ticket.id = 'ticket-1';
  ticket.assigneeId = null;
  ticket.category = buildCategory();
  Object.assign(ticket, overrides);
  return ticket;
}

interface MockSuggestionQueryBuilder {
  innerJoin: jest.Mock<
    MockSuggestionQueryBuilder,
    [unknown, string, string?, Record<string, unknown>?]
  >;
  where: jest.Mock<
    MockSuggestionQueryBuilder,
    [string, Record<string, unknown>?]
  >;
  andWhere: jest.Mock<
    MockSuggestionQueryBuilder,
    [string, Record<string, unknown>?]
  >;
  select: jest.Mock<MockSuggestionQueryBuilder, [string, string?]>;
  addSelect: jest.Mock<MockSuggestionQueryBuilder, [string, string?]>;
  orderBy: jest.Mock<MockSuggestionQueryBuilder, [string, string?, string?]>;
  addOrderBy: jest.Mock<MockSuggestionQueryBuilder, [string, string?, string?]>;
  limit: jest.Mock<MockSuggestionQueryBuilder, [number]>;
  getRawMany: jest.Mock<Promise<TechnicianSuggestionRawRow[]>, []>;
}

function buildMockSuggestionQueryBuilder(): MockSuggestionQueryBuilder {
  const qb: MockSuggestionQueryBuilder = {
    innerJoin: jest.fn<
      MockSuggestionQueryBuilder,
      [unknown, string, string?, Record<string, unknown>?]
    >(),
    where: jest.fn<
      MockSuggestionQueryBuilder,
      [string, Record<string, unknown>?]
    >(),
    andWhere: jest.fn<
      MockSuggestionQueryBuilder,
      [string, Record<string, unknown>?]
    >(),
    select: jest.fn<MockSuggestionQueryBuilder, [string, string?]>(),
    addSelect: jest.fn<MockSuggestionQueryBuilder, [string, string?]>(),
    orderBy: jest.fn<MockSuggestionQueryBuilder, [string, string?, string?]>(),
    addOrderBy: jest.fn<
      MockSuggestionQueryBuilder,
      [string, string?, string?]
    >(),
    limit: jest.fn<MockSuggestionQueryBuilder, [number]>(),
    getRawMany: jest.fn<Promise<TechnicianSuggestionRawRow[]>, []>(),
  };
  qb.innerJoin.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.select.mockReturnValue(qb);
  qb.addSelect.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  qb.addOrderBy.mockReturnValue(qb);
  qb.limit.mockReturnValue(qb);
  qb.getRawMany.mockResolvedValue([]);
  return qb;
}

describe('TechnicianSuggestionService', () => {
  let service: TechnicianSuggestionService;
  let queryBuilder: MockSuggestionQueryBuilder;
  let userRepository: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock<MockSuggestionQueryBuilder, [string]>;
  };
  let technicianProfileRepository: {
    findOneBy: jest.Mock;
  };
  let ticketRepository: {
    findOne: jest.Mock;
    count: jest.Mock;
  };

  beforeEach(async () => {
    queryBuilder = buildMockSuggestionQueryBuilder();

    userRepository = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn<MockSuggestionQueryBuilder, [string]>(
        () => queryBuilder,
      ),
    };
    technicianProfileRepository = {
      findOneBy: jest.fn(),
    };
    ticketRepository = {
      findOne: jest.fn(),
      count: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TechnicianSuggestionService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(TechnicianProfile),
          useValue: technicianProfileRepository,
        },
        { provide: getRepositoryToken(Ticket), useValue: ticketRepository },
      ],
    }).compile();

    service = module.get(TechnicianSuggestionService);
  });

  describe('evaluateEligibility — one test per branch, first failure wins', () => {
    it('NOT_FOUND when no user exists for the given id (looked up WITH deleted rows included)', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.evaluateEligibility('missing-user');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'missing-user' },
        withDeleted: true,
      });
      expect(result).toEqual({
        eligible: false,
        reason: 'NOT_FOUND',
        currentLoad: 0,
        maxConcurrentTickets: 0,
      });
    });

    it('NOT_A_TECHNICIAN when the user exists but is not a TECHNICIAN', async () => {
      userRepository.findOne.mockResolvedValue(
        buildUser({ role: UserRole.CLIENT }),
      );

      const result = await service.evaluateEligibility('user-1');

      expect(result).toEqual({
        eligible: false,
        reason: 'NOT_A_TECHNICIAN',
        currentLoad: 0,
        maxConcurrentTickets: 0,
      });
      expect(technicianProfileRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('INACTIVE when User.isActive is false', async () => {
      userRepository.findOne.mockResolvedValue(buildUser({ isActive: false }));

      const result = await service.evaluateEligibility('user-1');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('INACTIVE');
      expect(technicianProfileRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('INACTIVE when the user is soft-deleted, even though isActive is still true', async () => {
      userRepository.findOne.mockResolvedValue(
        buildUser({ isActive: true, deletedAt: new Date() }),
      );

      const result = await service.evaluateEligibility('user-1');

      expect(result.reason).toBe('INACTIVE');
    });

    it('NO_PROFILE when the user is an active TECHNICIAN with no TechnicianProfile row', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());
      technicianProfileRepository.findOneBy.mockResolvedValue(null);

      const result = await service.evaluateEligibility('user-1');

      expect(result).toEqual({
        eligible: false,
        reason: 'NO_PROFILE',
        currentLoad: 0,
        maxConcurrentTickets: 0,
      });
    });

    it('UNAVAILABLE when the profile exists but isAvailable is false', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());
      technicianProfileRepository.findOneBy.mockResolvedValue(
        buildProfile({ isAvailable: false, maxConcurrentTickets: 7 }),
      );

      const result = await service.evaluateEligibility('user-1');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('UNAVAILABLE');
      expect(result.maxConcurrentTickets).toBe(7);
      expect(ticketRepository.count).not.toHaveBeenCalled();
    });

    it('AT_CAPACITY when currentLoad >= maxConcurrentTickets', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());
      technicianProfileRepository.findOneBy.mockResolvedValue(
        buildProfile({ isAvailable: true, maxConcurrentTickets: 3 }),
      );
      ticketRepository.count.mockResolvedValue(3);

      const result = await service.evaluateEligibility('user-1');

      expect(result).toEqual({
        eligible: false,
        reason: 'AT_CAPACITY',
        currentLoad: 3,
        maxConcurrentTickets: 3,
      });
    });

    it('eligible: true when active, available, and under capacity', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());
      technicianProfileRepository.findOneBy.mockResolvedValue(
        buildProfile({ isAvailable: true, maxConcurrentTickets: 5 }),
      );
      ticketRepository.count.mockResolvedValue(2);

      const result = await service.evaluateEligibility('user-1');

      expect(result).toEqual({
        eligible: true,
        currentLoad: 2,
        maxConcurrentTickets: 5,
      });
      expect(result.reason).toBeUndefined();
    });
  });

  describe('evaluateEligibility — priority order', () => {
    it('reports INACTIVE, not UNAVAILABLE, for a technician who is BOTH inactive and unavailable (INACTIVE is checked first)', async () => {
      userRepository.findOne.mockResolvedValue(buildUser({ isActive: false }));
      technicianProfileRepository.findOneBy.mockResolvedValue(
        buildProfile({ isAvailable: false }),
      );

      const result = await service.evaluateEligibility('user-1');

      expect(result.reason).toBe('INACTIVE');
      // Proves the ordering is enforced by an early return, not by re-checking afterwards: the
      // profile is never even loaded once INACTIVE has already been decided.
      expect(technicianProfileRepository.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe('suggestForTicket', () => {
    it('rejects with 404 when the ticket does not exist, without ever building the candidate query', async () => {
      ticketRepository.findOne.mockResolvedValue(null);

      await expect(
        service.suggestForTicket('missing-ticket', 10),
      ).rejects.toThrow(NotFoundException);
      expect(userRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('scopes candidates to role=TECHNICIAN, isActive=true, isAvailable=true, and excludes AT_CAPACITY technicians', async () => {
      ticketRepository.findOne.mockResolvedValue(buildTicket());

      await service.suggestForTicket('ticket-1', 10);

      expect(userRepository.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(queryBuilder.where).toHaveBeenCalledWith('user.role = :role', {
        role: UserRole.TECHNICIAN,
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'user.isActive = :isActive',
        { isActive: true },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'profile.isAvailable = :isAvailable',
        { isAvailable: true },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('< profile.maxConcurrentTickets'),
      );
    });

    it('excludes the technician currently assigned to the ticket, when there is one', async () => {
      ticketRepository.findOne.mockResolvedValue(
        buildTicket({ assigneeId: 'assigned-tech' }),
      );

      await service.suggestForTicket('ticket-1', 10);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id != :excludedAssigneeId',
        { excludedAssigneeId: 'assigned-tech' },
      );
    });

    it('adds NO exclusion clause when the ticket has no current assignee', async () => {
      ticketRepository.findOne.mockResolvedValue(
        buildTicket({ assigneeId: null }),
      );

      await service.suggestForTicket('ticket-1', 10);

      const calls = queryBuilder.andWhere.mock.calls.map((call) => call[0]);
      expect(calls.some((sql) => sql.includes('excludedAssigneeId'))).toBe(
        false,
      );
    });

    it("joins technician_skills and selects the candidate's real level when the category has a requiredSkillId", async () => {
      ticketRepository.findOne.mockResolvedValue(
        buildTicket({
          category: buildCategory({ requiredSkillId: 'skill-required' }),
        }),
      );

      await service.suggestForTicket('ticket-1', 10);

      expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
        expect.anything(),
        'ts',
        expect.stringContaining('ts.skillId = :requiredSkillId'),
        { requiredSkillId: 'skill-required' },
      );
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'ts.level',
        'skillLevel',
      );
    });

    it('selects a NULL skillLevel (no skill join) when the category has no requiredSkillId', async () => {
      ticketRepository.findOne.mockResolvedValue(
        buildTicket({ category: buildCategory({ requiredSkillId: null }) }),
      );

      await service.suggestForTicket('ticket-1', 10);

      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'CAST(NULL AS smallint)',
        'skillLevel',
      );
      const skillJoinCalls = queryBuilder.innerJoin.mock.calls.filter(
        (call) => call[1] === 'ts',
      );
      expect(skillJoinCalls).toHaveLength(0);
    });

    it('orders by skillLevel DESC NULLS LAST, then currentLoad ASC, then username ASC (in exactly that order), and applies the limit', async () => {
      ticketRepository.findOne.mockResolvedValue(buildTicket());

      await service.suggestForTicket('ticket-1', 7);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        '"skillLevel"',
        'DESC',
        'NULLS LAST',
      );
      expect(queryBuilder.addOrderBy).toHaveBeenNthCalledWith(
        1,
        '"currentLoad"',
        'ASC',
      );
      expect(queryBuilder.addOrderBy).toHaveBeenNthCalledWith(
        2,
        'user.username',
        'ASC',
      );
      expect(queryBuilder.limit).toHaveBeenCalledWith(7);
    });

    // The tie-break itself is enforced by PostgreSQL (this is a unit test, the DB is mocked),
    // but the two assertions together prove the SERVICE genuinely asks for it, and genuinely
    // trusts the DB's own ordering instead of silently re-sorting (or worse, reversing) it in
    // JS: (1) `addOrderBy('user.username', 'ASC')` really is issued as the third criterion, and
    // (2) the row order returned by `getRawMany()` (here: already alphabetical, as a real DB
    // honoring that ORDER BY would produce for a tie on the first two criteria) survives
    // untouched into the final DTO array.
    it('preserves the SQL-provided row order for two technicians strictly tied on skillLevel AND currentLoad (username breaks the tie)', async () => {
      ticketRepository.findOne.mockResolvedValue(buildTicket());
      const tiedRows: TechnicianSuggestionRawRow[] = [
        {
          userId: 'user-a',
          username: 'alice',
          firstName: 'Alice',
          lastName: null,
          maxConcurrentTickets: 5,
          currentLoad: 2,
          skillLevel: 4,
        },
        {
          userId: 'user-b',
          username: 'bob',
          firstName: 'Bob',
          lastName: null,
          maxConcurrentTickets: 5,
          currentLoad: 2,
          skillLevel: 4,
        },
      ];
      queryBuilder.getRawMany.mockResolvedValue(tiedRows);

      const result = await service.suggestForTicket('ticket-1', 10);

      expect(result.map((dto) => dto.username)).toEqual(['alice', 'bob']);
    });

    it('maps raw rows to TechnicianSuggestionDto, normalizing numeric fields and preserving a null skillLevel', async () => {
      ticketRepository.findOne.mockResolvedValue(buildTicket());
      queryBuilder.getRawMany.mockResolvedValue([
        {
          userId: 'user-1',
          username: 'jtech',
          firstName: 'Jane',
          lastName: 'Tech',
          maxConcurrentTickets: '5',
          currentLoad: '2',
          skillLevel: null,
        },
      ]);

      const [dto] = await service.suggestForTicket('ticket-1', 10);

      expect(dto).toEqual({
        technicianId: 'user-1',
        username: 'jtech',
        firstName: 'Jane',
        lastName: 'Tech',
        skillLevel: null,
        currentLoad: 2,
        maxConcurrentTickets: 5,
      });
    });

    it('returns an empty array (never throws) when no candidate matches', async () => {
      ticketRepository.findOne.mockResolvedValue(buildTicket());
      queryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.suggestForTicket('ticket-1', 10);

      expect(result).toEqual([]);
    });
  });
});
