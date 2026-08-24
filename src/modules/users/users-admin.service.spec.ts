import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Brackets } from 'typeorm';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketStatus } from '../tickets/enums/ticket-status.enum';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { UsersAdminService } from './users-admin.service';
import { UsersService } from './users.service';

// argon2id is ~100 ms of real CPU per call and this suite never asserts on the hash itself,
// only on what surrounds it (ordering, conflict handling). Mocking keeps the suite fast without
// weakening a single assertion.
jest.mock('../../common/security/password.util', () => ({
  hashPassword: jest.fn().mockResolvedValue('argon2-hash'),
}));

interface MockQueryBuilder {
  andWhere: jest.Mock<
    MockQueryBuilder,
    [string | Brackets, Record<string, unknown>?]
  >;
  orderBy: jest.Mock<MockQueryBuilder, [string, string?]>;
  skip: jest.Mock<MockQueryBuilder, [number]>;
  take: jest.Mock<MockQueryBuilder, [number]>;
  getCount: jest.Mock<Promise<number>, []>;
  getMany: jest.Mock<Promise<User[]>, []>;
}

// Replays a `Brackets`' lazy factory against a recording fake, the same technique
// `users.service.spec.ts` uses, so the OR conditions nested inside can be asserted without a
// real query builder.
function extractBracketCalls(
  brackets: Brackets,
): { condition: string; params?: Record<string, unknown> }[] {
  const seen: { condition: string; params?: Record<string, unknown> }[] = [];
  const fakeQb = {
    orWhere: (condition: string, params?: Record<string, unknown>) => {
      seen.push({ condition, params });
      return fakeQb;
    },
  };
  brackets.whereFactory(fakeQb as never);
  return seen;
}

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.username = 'jdoe';
  user.email = 'jdoe@example.com';
  user.firstName = null;
  user.lastName = null;
  user.phone = null;
  user.role = UserRole.CLIENT;
  user.isActive = true;
  user.createdAt = new Date('2024-01-01T00:00:00.000Z');
  Object.assign(user, overrides);
  return user;
}

const ADMIN_CALLER = buildUser({ id: 'admin-1', role: UserRole.ADMIN });

describe('UsersAdminService', () => {
  let service: UsersAdminService;
  let queryBuilder: MockQueryBuilder;
  let userRepository: {
    createQueryBuilder: jest.Mock<MockQueryBuilder, [string]>;
    softDelete: jest.Mock<Promise<unknown>, [string]>;
  };
  let ticketRepository: {
    exists: jest.Mock<Promise<boolean>, [Record<string, unknown>]>;
  };
  let usersService: {
    findById: jest.Mock<Promise<User | null>, [string]>;
    existsByUsernameOrEmail: jest.Mock<Promise<boolean>, [string, string]>;
    create: jest.Mock<Promise<User>, [Record<string, unknown>]>;
    update: jest.Mock<Promise<User>, [string, Record<string, unknown>]>;
  };

  beforeEach(async () => {
    queryBuilder = {
      andWhere: jest.fn<
        MockQueryBuilder,
        [string | Brackets, Record<string, unknown>?]
      >(),
      orderBy: jest.fn<MockQueryBuilder, [string, string?]>(),
      skip: jest.fn<MockQueryBuilder, [number]>(),
      take: jest.fn<MockQueryBuilder, [number]>(),
      getCount: jest.fn<Promise<number>, []>(),
      getMany: jest.fn<Promise<User[]>, []>(),
    };
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.skip.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    queryBuilder.getCount.mockResolvedValue(0);
    queryBuilder.getMany.mockResolvedValue([]);

    userRepository = {
      createQueryBuilder: jest.fn<MockQueryBuilder, [string]>(
        () => queryBuilder,
      ),
      softDelete: jest.fn<Promise<unknown>, [string]>().mockResolvedValue({}),
    };
    ticketRepository = {
      exists: jest
        .fn<Promise<boolean>, [Record<string, unknown>]>()
        .mockResolvedValue(false),
    };
    usersService = {
      findById: jest.fn<Promise<User | null>, [string]>(),
      existsByUsernameOrEmail: jest
        .fn<Promise<boolean>, [string, string]>()
        .mockResolvedValue(false),
      create: jest.fn<Promise<User>, [Record<string, unknown>]>(),
      update: jest.fn<Promise<User>, [string, Record<string, unknown>]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersAdminService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Ticket), useValue: ticketRepository },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(UsersAdminService);
  });

  describe('create — D1', () => {
    it('refuses role TECHNICIAN with 400 and never writes a row', async () => {
      await expect(
        service.create({
          username: 'newtech',
          email: 'newtech@example.com',
          password: 'Str0ngP@ssw0rd',
          role: UserRole.TECHNICIAN,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('defaults the role to CLIENT when none is given', async () => {
      usersService.create.mockResolvedValue(buildUser());

      await service.create({
        username: 'newclient',
        email: 'newclient@example.com',
        password: 'Str0ngP@ssw0rd',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.CLIENT }),
      );
    });

    it('lets an ADMIN account through', async () => {
      usersService.create.mockResolvedValue(
        buildUser({ role: UserRole.ADMIN }),
      );

      const result = await service.create({
        username: 'newadmin',
        email: 'newadmin@example.com',
        password: 'Str0ngP@ssw0rd',
        role: UserRole.ADMIN,
      });

      expect(result.role).toBe(UserRole.ADMIN);
    });

    it('maps 409 from the pre-check without touching the repository', async () => {
      usersService.existsByUsernameOrEmail.mockResolvedValue(true);

      await expect(
        service.create({
          username: 'jdoe',
          email: 'jdoe@example.com',
          password: 'Str0ngP@ssw0rd',
        }),
      ).rejects.toThrow(ConflictException);

      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('translates a concurrent 23505 into a 409 rather than letting it surface as a 500', async () => {
      usersService.create.mockRejectedValue({ code: '23505' });

      await expect(
        service.create({
          username: 'jdoe',
          email: 'jdoe@example.com',
          password: 'Str0ngP@ssw0rd',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows an unrelated repository error untouched', async () => {
      const boom = new Error('connection lost');
      usersService.create.mockRejectedValue(boom);

      await expect(
        service.create({
          username: 'jdoe',
          email: 'jdoe@example.com',
          password: 'Str0ngP@ssw0rd',
        }),
      ).rejects.toThrow(boom);
    });

    it('never returns the password hash in the response DTO', async () => {
      const created = buildUser();
      created.password = 'argon2-hash';
      usersService.create.mockResolvedValue(created);

      const result = await service.create({
        username: 'newclient',
        email: 'newclient@example.com',
        password: 'Str0ngP@ssw0rd',
      });

      expect(Object.keys(result)).not.toContain('password');
    });
  });

  describe('update — D2 and D3', () => {
    it('rejects an empty patch with 400', async () => {
      await expect(service.update('user-1', {}, ADMIN_CALLER)).rejects.toThrow(
        BadRequestException,
      );
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('D3: refuses a caller changing their own role, before even loading the row', async () => {
      await expect(
        service.update(
          ADMIN_CALLER.id,
          { role: UserRole.CLIENT },
          ADMIN_CALLER,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(usersService.findById).not.toHaveBeenCalled();
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('D3: refuses a caller deactivating themselves', async () => {
      await expect(
        service.update(ADMIN_CALLER.id, { isActive: false }, ADMIN_CALLER),
      ).rejects.toThrow(BadRequestException);
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('D3: still lets a caller edit their own profile fields', async () => {
      usersService.findById.mockResolvedValue(ADMIN_CALLER);
      usersService.update.mockResolvedValue(
        buildUser({ id: ADMIN_CALLER.id, firstName: 'Jane' }),
      );

      const result = await service.update(
        ADMIN_CALLER.id,
        { firstName: 'Jane' },
        ADMIN_CALLER,
      );

      expect(result.firstName).toBe('Jane');
    });

    it('D2: refuses promoting a CLIENT to TECHNICIAN', async () => {
      usersService.findById.mockResolvedValue(buildUser());

      await expect(
        service.update('user-1', { role: UserRole.TECHNICIAN }, ADMIN_CALLER),
      ).rejects.toThrow(BadRequestException);
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('D2: refuses demoting a TECHNICIAN to CLIENT', async () => {
      usersService.findById.mockResolvedValue(
        buildUser({ role: UserRole.TECHNICIAN }),
      );

      await expect(
        service.update('user-1', { role: UserRole.CLIENT }, ADMIN_CALLER),
      ).rejects.toThrow(BadRequestException);
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('D2: allows CLIENT -> ADMIN', async () => {
      usersService.findById.mockResolvedValue(buildUser());
      usersService.update.mockResolvedValue(
        buildUser({ role: UserRole.ADMIN }),
      );

      const result = await service.update(
        'user-1',
        { role: UserRole.ADMIN },
        ADMIN_CALLER,
      );

      expect(result.role).toBe(UserRole.ADMIN);
    });

    it('D2: a no-op role in the patch is not a change, so a TECHNICIAN can still be edited', async () => {
      usersService.findById.mockResolvedValue(
        buildUser({ role: UserRole.TECHNICIAN }),
      );
      usersService.update.mockResolvedValue(
        buildUser({ role: UserRole.TECHNICIAN, phone: '+228 90 00 00 00' }),
      );

      const result = await service.update(
        'user-1',
        { role: UserRole.TECHNICIAN, phone: '+228 90 00 00 00' },
        ADMIN_CALLER,
      );

      expect(result.phone).toBe('+228 90 00 00 00');
    });

    it('404s on an unknown (or soft-deleted) target', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(
        service.update('missing', { firstName: 'X' }, ADMIN_CALLER),
      ).rejects.toThrow(NotFoundException);
    });

    it('translates a concurrent 23505 into a 409', async () => {
      usersService.findById.mockResolvedValue(buildUser());
      usersService.update.mockRejectedValue({ code: '23505' });

      await expect(
        service.update('user-1', { username: 'taken' }, ADMIN_CALLER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('softDelete — D4', () => {
    it('refuses self-deletion', async () => {
      await expect(
        service.softDelete(ADMIN_CALLER.id, ADMIN_CALLER),
      ).rejects.toThrow(BadRequestException);
      expect(userRepository.softDelete).not.toHaveBeenCalled();
    });

    it('404s on an unknown target', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(service.softDelete('missing', ADMIN_CALLER)).rejects.toThrow(
        NotFoundException,
      );
      expect(userRepository.softDelete).not.toHaveBeenCalled();
    });

    it('409s when the user is still the assignee of a live ticket, and writes nothing', async () => {
      usersService.findById.mockResolvedValue(buildUser());
      ticketRepository.exists.mockResolvedValue(true);

      await expect(service.softDelete('user-1', ADMIN_CALLER)).rejects.toThrow(
        ConflictException,
      );
      expect(userRepository.softDelete).not.toHaveBeenCalled();
    });

    it('scopes the live-work check to OPEN/ASSIGNED/IN_PROGRESS — a RESOLVED or CLOSED ticket must not block', async () => {
      usersService.findById.mockResolvedValue(buildUser());

      await service.softDelete('user-1', ADMIN_CALLER);

      const where = ticketRepository.exists.mock.calls[0][0] as {
        where: { assigneeId: string; status: { _value: TicketStatus[] } };
      };
      expect(where.where.assigneeId).toBe('user-1');
      // `In(...)` stores its operand under `_value`.
      expect(where.where.status._value).toEqual([
        TicketStatus.OPEN,
        TicketStatus.ASSIGNED,
        TicketStatus.IN_PROGRESS,
      ]);
    });

    it('soft-deletes rather than removing the row, so history stays traceable', async () => {
      usersService.findById.mockResolvedValue(buildUser());

      await service.softDelete('user-1', ADMIN_CALLER);

      expect(userRepository.softDelete).toHaveBeenCalledWith('user-1');
    });
  });

  describe('list — D10', () => {
    it('escapes the LIKE wildcards in `search`, so `%` cannot match every account', async () => {
      await service.list({ page: 1, limit: 20, search: '100%_done' });

      const bracketsArg = queryBuilder.andWhere.mock.calls.find(
        ([arg]) => arg instanceof Brackets,
      )?.[0] as Brackets;
      const calls = extractBracketCalls(bracketsArg);

      expect(calls.map((call) => call.condition)).toEqual([
        'user.username ILIKE :search',
        'user.email ILIKE :search',
        'user.firstName ILIKE :search',
        'user.lastName ILIKE :search',
      ]);
      expect(calls[0].params).toEqual({ search: '%100\\%\\_done%' });
    });

    it('wraps the search ORs in Brackets so they cannot widen the role/isActive filters', async () => {
      await service.list({
        page: 1,
        limit: 20,
        role: UserRole.CLIENT,
        search: 'jdoe',
      });

      const args = queryBuilder.andWhere.mock.calls.map(([arg]) => arg);
      expect(args[0]).toBe('user.role = :role');
      expect(args[1]).toBeInstanceOf(Brackets);
    });

    it('applies no filter condition at all when the query carries none', async () => {
      await service.list({ page: 1, limit: 20 });

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('filters on isActive=false rather than dropping a falsy value', async () => {
      await service.list({ page: 1, limit: 20, isActive: false });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'user.isActive = :isActive',
        { isActive: false },
      );
    });

    it('paginates and sorts by username ASC, and reports the unpaginated total', async () => {
      queryBuilder.getCount.mockResolvedValue(42);
      queryBuilder.getMany.mockResolvedValue([buildUser()]);

      const result = await service.list({ page: 3, limit: 10 });

      expect(queryBuilder.orderBy).toHaveBeenCalledWith('user.username', 'ASC');
      expect(queryBuilder.skip).toHaveBeenCalledWith(20);
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.meta.total).toBe(42);
      expect(result.meta.totalPages).toBe(5);
      expect(result.data).toHaveLength(1);
    });

    it('builds two independent query builders, so the page ORDER BY/LIMIT cannot leak into the count', async () => {
      await service.list({ page: 1, limit: 20 });

      expect(userRepository.createQueryBuilder).toHaveBeenCalledTimes(2);
    });
  });

  describe('getById', () => {
    it('404s on a soft-deleted account (findById already filters them out)', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(service.getById('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
