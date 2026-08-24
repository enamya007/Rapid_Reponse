import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, EntityTarget, In } from 'typeorm';
import { Skill } from '../skills/entities/skill.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { UsersService } from '../users/users.service';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { SetTechnicianSkillsDto } from './dto/set-technician-skills.dto';
import { TechnicianQueryDto } from './dto/technician-query.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateTechnicianDto } from './dto/update-technician.dto';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianSkill } from './entities/technician-skill.entity';
import { TechniciansService } from './technicians.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.username = 'jtech';
  user.email = 'jtech@example.com';
  user.firstName = 'Jane';
  user.lastName = 'Tech';
  user.phone = null;
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

function buildProfileWithUser(
  profileOverrides: Partial<TechnicianProfile> = {},
  userOverrides: Partial<User> = {},
): TechnicianProfile {
  const profile = buildProfile(profileOverrides);
  profile.user = buildUser({ id: profile.userId, ...userOverrides });
  return profile;
}

function buildTechnicianSkillRow(
  overrides: Partial<TechnicianSkill> = {},
): TechnicianSkill {
  const row = new TechnicianSkill();
  row.technicianProfileId = 'profile-1';
  row.skillId = 'skill-1';
  row.level = 3;
  row.skill = { id: 'skill-1', name: 'Plomberie' } as Skill;
  Object.assign(row, overrides);
  return row;
}

interface MockTxRepo {
  exists: jest.Mock;
  countBy: jest.Mock;
  create: jest.Mock<Record<string, unknown>, [Record<string, unknown>]>;
  save: jest.Mock;
  delete: jest.Mock;
}

function buildMockTxRepo(): MockTxRepo {
  return {
    exists: jest.fn(),
    countBy: jest.fn(),
    create: jest.fn<Record<string, unknown>, [Record<string, unknown>]>(
      (data) => ({ ...data }),
    ),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    delete: jest.fn(),
  };
}

interface MockProfileQueryBuilder {
  innerJoinAndSelect: jest.Mock<MockProfileQueryBuilder, [string, string]>;
  andWhere: jest.Mock<
    MockProfileQueryBuilder,
    [string, Record<string, unknown>?]
  >;
  addSelect: jest.Mock<MockProfileQueryBuilder, [string, string]>;
  orderBy: jest.Mock<MockProfileQueryBuilder, [string, 'ASC' | 'DESC']>;
  skip: jest.Mock<MockProfileQueryBuilder, [number]>;
  take: jest.Mock<MockProfileQueryBuilder, [number]>;
  getCount: jest.Mock<Promise<number>, []>;
  getRawAndEntities: jest.Mock<
    Promise<{
      entities: TechnicianProfile[];
      raw: Array<{ currentLoad: string | number }>;
    }>,
    []
  >;
}

function buildTechnicianQuery(
  overrides: Partial<TechnicianQueryDto> = {},
): TechnicianQueryDto {
  const query = new TechnicianQueryDto();
  query.page = 1;
  query.limit = 20;
  Object.assign(query, overrides);
  return query;
}

describe('TechniciansService', () => {
  let service: TechniciansService;

  let userTxRepo: MockTxRepo;
  let profileTxRepo: MockTxRepo;
  let skillTxRepo: MockTxRepo;
  let technicianSkillTxRepo: MockTxRepo;
  let transactionEntityManager: { getRepository: jest.Mock };
  let transactionMock: jest.Mock<
    Promise<unknown>,
    [(em: EntityManager) => Promise<unknown>]
  >;
  let profileQueryBuilder: MockProfileQueryBuilder;

  let userRepository: {
    manager: { transaction: typeof transactionMock };
  };
  let technicianProfileRepository: {
    findOneBy: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock<MockProfileQueryBuilder, [string]>;
    manager: { transaction: typeof transactionMock };
  };
  let technicianSkillRepository: {
    find: jest.Mock;
  };
  let skillRepository: {
    countBy: jest.Mock;
  };
  let ticketRepository: {
    count: jest.Mock;
  };
  let usersService: {
    update: jest.Mock;
  };

  beforeEach(async () => {
    userTxRepo = buildMockTxRepo();
    profileTxRepo = buildMockTxRepo();
    skillTxRepo = buildMockTxRepo();
    technicianSkillTxRepo = buildMockTxRepo();

    transactionEntityManager = {
      getRepository: jest.fn((entity: EntityTarget<unknown>) => {
        if (entity === User) return userTxRepo;
        if (entity === TechnicianProfile) return profileTxRepo;
        if (entity === Skill) return skillTxRepo;
        if (entity === TechnicianSkill) return technicianSkillTxRepo;
        throw new Error(
          'Unexpected entity requested from the transaction manager',
        );
      }),
    };
    transactionMock = jest.fn(
      async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb(transactionEntityManager as unknown as EntityManager),
    );

    profileQueryBuilder = {
      innerJoinAndSelect: jest.fn<MockProfileQueryBuilder, [string, string]>(),
      andWhere: jest.fn<
        MockProfileQueryBuilder,
        [string, Record<string, unknown>?]
      >(),
      addSelect: jest.fn<MockProfileQueryBuilder, [string, string]>(),
      orderBy: jest.fn<MockProfileQueryBuilder, [string, 'ASC' | 'DESC']>(),
      skip: jest.fn<MockProfileQueryBuilder, [number]>(),
      take: jest.fn<MockProfileQueryBuilder, [number]>(),
      getCount: jest.fn<Promise<number>, []>(),
      getRawAndEntities: jest.fn<
        Promise<{
          entities: TechnicianProfile[];
          raw: Array<{ currentLoad: string | number }>;
        }>,
        []
      >(),
    };
    profileQueryBuilder.innerJoinAndSelect.mockReturnValue(profileQueryBuilder);
    profileQueryBuilder.andWhere.mockReturnValue(profileQueryBuilder);
    profileQueryBuilder.addSelect.mockReturnValue(profileQueryBuilder);
    profileQueryBuilder.orderBy.mockReturnValue(profileQueryBuilder);
    profileQueryBuilder.skip.mockReturnValue(profileQueryBuilder);
    profileQueryBuilder.take.mockReturnValue(profileQueryBuilder);
    profileQueryBuilder.getCount.mockResolvedValue(0);
    profileQueryBuilder.getRawAndEntities.mockResolvedValue({
      entities: [],
      raw: [],
    });

    userRepository = {
      manager: { transaction: transactionMock },
    };
    technicianProfileRepository = {
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn<MockProfileQueryBuilder, [string]>(
        () => profileQueryBuilder,
      ),
      manager: { transaction: transactionMock },
    };
    technicianSkillRepository = {
      find: jest.fn(),
    };
    skillRepository = {
      countBy: jest.fn(),
    };
    ticketRepository = {
      count: jest.fn(),
    };
    usersService = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TechniciansService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(TechnicianProfile),
          useValue: technicianProfileRepository,
        },
        {
          provide: getRepositoryToken(TechnicianSkill),
          useValue: technicianSkillRepository,
        },
        { provide: getRepositoryToken(Skill), useValue: skillRepository },
        { provide: getRepositoryToken(Ticket), useValue: ticketRepository },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(TechniciansService);
  });

  describe('create', () => {
    const dto: CreateTechnicianDto = {
      username: 'jtech',
      email: 'jtech@example.com',
      password: 'StrongPassw0rd',
    };

    function stubSuccessfulReload(): void {
      technicianProfileRepository.findOne.mockResolvedValue(
        buildProfileWithUser({ id: 'new-profile-id', userId: 'new-user-id' }),
      );
      technicianSkillRepository.find.mockResolvedValue([]);
      ticketRepository.count.mockResolvedValue(0);
    }

    it('checks for an existing username/email INCLUDING soft-deleted rows, creates the User with role TECHNICIAN and an argon2id-hashed password (never the raw plaintext)', async () => {
      userTxRepo.exists.mockResolvedValue(false);
      userTxRepo.create.mockImplementation((data: Record<string, unknown>) => ({
        ...data,
        id: 'new-user-id',
      }));
      profileTxRepo.create.mockImplementation(
        (data: Record<string, unknown>) => ({ ...data, id: 'new-profile-id' }),
      );
      stubSuccessfulReload();

      await service.create(dto);

      expect(userTxRepo.exists).toHaveBeenCalledWith({
        where: [{ username: 'jtech' }, { email: 'jtech@example.com' }],
        withDeleted: true,
      });
      const createArg = userTxRepo.create.mock.calls[0][0];
      expect(createArg.role).toBe(UserRole.TECHNICIAN);
      expect(createArg.password).toMatch(/^\$argon2id\$/);
      expect(createArg.password).not.toBe(dto.password);
    });

    it('defaults isAvailable to true and maxConcurrentTickets to 5 on the TechnicianProfile when omitted from the DTO', async () => {
      userTxRepo.exists.mockResolvedValue(false);
      userTxRepo.create.mockImplementation((data: Record<string, unknown>) => ({
        ...data,
        id: 'new-user-id',
      }));
      profileTxRepo.create.mockImplementation(
        (data: Record<string, unknown>) => ({ ...data, id: 'new-profile-id' }),
      );
      stubSuccessfulReload();

      await service.create(dto);

      expect(profileTxRepo.create).toHaveBeenCalledWith({
        userId: 'new-user-id',
        isAvailable: true,
        maxConcurrentTickets: 5,
      });
    });

    it('honors explicit isAvailable/maxConcurrentTickets instead of the defaults', async () => {
      userTxRepo.exists.mockResolvedValue(false);
      userTxRepo.create.mockImplementation((data: Record<string, unknown>) => ({
        ...data,
        id: 'new-user-id',
      }));
      profileTxRepo.create.mockImplementation(
        (data: Record<string, unknown>) => ({ ...data, id: 'new-profile-id' }),
      );
      stubSuccessfulReload();

      await service.create({
        ...dto,
        isAvailable: false,
        maxConcurrentTickets: 8,
      });

      expect(profileTxRepo.create).toHaveBeenCalledWith({
        userId: 'new-user-id',
        isAvailable: false,
        maxConcurrentTickets: 8,
      });
    });

    it('creates one TechnicianSkill row per requested skill, defaulting level to 3 and honoring an explicit level', async () => {
      userTxRepo.exists.mockResolvedValue(false);
      userTxRepo.create.mockImplementation((data: Record<string, unknown>) => ({
        ...data,
        id: 'new-user-id',
      }));
      profileTxRepo.create.mockImplementation(
        (data: Record<string, unknown>) => ({ ...data, id: 'new-profile-id' }),
      );
      skillTxRepo.countBy.mockResolvedValue(2);
      stubSuccessfulReload();

      await service.create({
        ...dto,
        skills: [{ skillId: 'skill-1' }, { skillId: 'skill-2', level: 5 }],
      });

      expect(skillTxRepo.countBy).toHaveBeenCalledWith({
        id: In(['skill-1', 'skill-2']),
      });
      expect(technicianSkillTxRepo.create).toHaveBeenNthCalledWith(1, {
        technicianProfileId: 'new-profile-id',
        skillId: 'skill-1',
        level: 3,
      });
      expect(technicianSkillTxRepo.create).toHaveBeenNthCalledWith(2, {
        technicianProfileId: 'new-profile-id',
        skillId: 'skill-2',
        level: 5,
      });
      expect(technicianSkillTxRepo.save).toHaveBeenCalledTimes(1);
    });

    it('rejects with 409 when username/email is already taken, and never creates a User row', async () => {
      userTxRepo.exists.mockResolvedValue(true);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);

      expect(userTxRepo.create).not.toHaveBeenCalled();
      expect(userTxRepo.save).not.toHaveBeenCalled();
    });

    it('rejects with 409 (not a raw 500) when the final save() hits a unique-violation race, even though the pre-check passed', async () => {
      userTxRepo.exists.mockResolvedValue(false);
      userTxRepo.create.mockImplementation((data: Record<string, unknown>) => ({
        ...data,
      }));
      userTxRepo.save.mockRejectedValue({ code: '23505' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    // Proves the whole point of wrapping this in ONE transaction (P5 brief, T5.1b): an unknown
    // skillId must roll back the User row too. Mutation-tested (see the implementer's report):
    // moving skill validation/creation OUTSIDE `userRepository.manager.transaction(...)` makes
    // this exact test fail, because the mutated flow would have already called
    // `userTxRepo.create`/`save` (committing the user) before ever checking the skill.
    it('rejects with 404 when a skillId does not exist, and creates NEITHER a User NOR a TechnicianProfile row (single transaction, rolled back)', async () => {
      userTxRepo.exists.mockResolvedValue(false);
      skillTxRepo.countBy.mockResolvedValue(1); // only 1 of the 2 requested skills exists

      await expect(
        service.create({
          ...dto,
          skills: [{ skillId: 'skill-1' }, { skillId: 'unknown-skill' }],
        }),
      ).rejects.toThrow(NotFoundException);

      expect(userTxRepo.create).not.toHaveBeenCalled();
      expect(userTxRepo.save).not.toHaveBeenCalled();
      expect(profileTxRepo.create).not.toHaveBeenCalled();
      expect(profileTxRepo.save).not.toHaveBeenCalled();
      expect(technicianSkillTxRepo.create).not.toHaveBeenCalled();
    });

    it('reloads and returns the created technician via TechnicianResponseDto, id = userId (D4), no password/TechnicianProfile.id leak', async () => {
      userTxRepo.exists.mockResolvedValue(false);
      userTxRepo.create.mockImplementation((data: Record<string, unknown>) => ({
        ...data,
        id: 'new-user-id',
      }));
      profileTxRepo.create.mockImplementation(
        (data: Record<string, unknown>) => ({ ...data, id: 'new-profile-id' }),
      );
      stubSuccessfulReload();

      const result = await service.create(dto);

      expect(result.id).toBe('new-user-id');
      expect(Object.keys(result).sort()).toEqual(
        [
          'currentLoad',
          'email',
          'firstName',
          'id',
          'isActive',
          'isAvailable',
          'lastName',
          'maxConcurrentTickets',
          'phone',
          'skills',
          'username',
        ].sort(),
      );
      expect(result).not.toHaveProperty('password');
    });
  });

  describe('list', () => {
    it('filters by isAvailable/isActive/skillId only when provided, and always excludes soft-deleted users', async () => {
      await service.list(
        buildTechnicianQuery({
          isAvailable: false,
          isActive: true,
          skillId: 'skill-1',
        }),
      );

      const calls = profileQueryBuilder.andWhere.mock.calls.map(
        (call) => call[0],
      );
      expect(calls).toEqual(
        expect.arrayContaining([
          'user.deletedAt IS NULL',
          'profile.isAvailable = :isAvailable',
          'user.isActive = :isActive',
          expect.stringContaining('EXISTS'),
        ]),
      );
      expect(profileQueryBuilder.andWhere).toHaveBeenCalledWith(
        'profile.isAvailable = :isAvailable',
        { isAvailable: false },
      );
      expect(profileQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.isActive = :isActive',
        { isActive: true },
      );
    });

    it('applies no isAvailable/isActive/skillId filter when the query omits them', async () => {
      await service.list(buildTechnicianQuery());

      // `buildFilteredProfileQuery` runs twice (count query + data query), each against its own
      // fresh `SelectQueryBuilder` — the mock happens to return the same object both times, so
      // both independent `andWhere('user.deletedAt IS NULL')` calls land in this one array.
      const calls = profileQueryBuilder.andWhere.mock.calls.map(
        (call) => call[0],
      );
      expect(calls).toEqual([
        'user.deletedAt IS NULL',
        'user.deletedAt IS NULL',
      ]);
    });

    it('builds exactly two independent query builders (count + data) regardless of result size', async () => {
      profileQueryBuilder.getCount.mockResolvedValue(3);
      profileQueryBuilder.getRawAndEntities.mockResolvedValue({
        entities: [
          buildProfileWithUser({ id: 'p-1', userId: 'u-1' }, { username: 'a' }),
          buildProfileWithUser({ id: 'p-2', userId: 'u-2' }, { username: 'b' }),
          buildProfileWithUser({ id: 'p-3', userId: 'u-3' }, { username: 'c' }),
        ],
        raw: [{ currentLoad: 1 }, { currentLoad: 0 }, { currentLoad: 2 }],
      });
      technicianSkillRepository.find.mockResolvedValue([]);

      await service.list(buildTechnicianQuery());

      expect(
        technicianProfileRepository.createQueryBuilder,
      ).toHaveBeenCalledTimes(2);
      // No per-technician query: `ticketRepository` (used for the single-technician `count()`
      // path elsewhere) is never touched by `list()` — the whole page's currentLoad is computed
      // by the SQL embedded directly in the data query above.
      expect(ticketRepository.count).not.toHaveBeenCalled();
    });

    it("loads every matched technician's skills in a SINGLE batched query, not one per technician", async () => {
      profileQueryBuilder.getRawAndEntities.mockResolvedValue({
        entities: [
          buildProfileWithUser({ id: 'p-1', userId: 'u-1' }),
          buildProfileWithUser({ id: 'p-2', userId: 'u-2' }),
        ],
        raw: [{ currentLoad: 0 }, { currentLoad: 0 }],
      });
      technicianSkillRepository.find.mockResolvedValue([
        buildTechnicianSkillRow({ technicianProfileId: 'p-1' }),
      ]);

      const result = await service.list(buildTechnicianQuery());

      expect(technicianSkillRepository.find).toHaveBeenCalledTimes(1);
      expect(technicianSkillRepository.find).toHaveBeenCalledWith({
        where: { technicianProfileId: In(['p-1', 'p-2']) },
        relations: { skill: true },
      });
      expect(result.data[0].skills).toHaveLength(1);
      expect(result.data[1].skills).toHaveLength(0);
    });

    it('normalizes the raw currentLoad (possibly a string, per driver quirks) to a JS number in the response', async () => {
      profileQueryBuilder.getCount.mockResolvedValue(1);
      profileQueryBuilder.getRawAndEntities.mockResolvedValue({
        entities: [buildProfileWithUser({ id: 'p-1', userId: 'u-1' })],
        raw: [{ currentLoad: '3' }],
      });
      technicianSkillRepository.find.mockResolvedValue([]);

      const result = await service.list(buildTechnicianQuery());

      expect(result.data[0].currentLoad).toBe(3);
      expect(typeof result.data[0].currentLoad).toBe('number');
    });

    it('returns a PaginatedResponseDto envelope built from getCount()/the page data', async () => {
      profileQueryBuilder.getCount.mockResolvedValue(42);
      profileQueryBuilder.getRawAndEntities.mockResolvedValue({
        entities: [],
        raw: [],
      });
      technicianSkillRepository.find.mockResolvedValue([]);

      const result = await service.list(
        buildTechnicianQuery({ page: 2, limit: 10 }),
      );

      expect(result.meta).toEqual({
        total: 42,
        page: 2,
        limit: 10,
        totalPages: 5,
      });
      expect(profileQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(profileQueryBuilder.take).toHaveBeenCalledWith(10);
    });
  });

  describe('getByIdForCaller', () => {
    it('lets an ADMIN read any technician', async () => {
      const admin = buildUser({ id: 'admin-1', role: UserRole.ADMIN });
      technicianProfileRepository.findOne.mockResolvedValue(
        buildProfileWithUser({ userId: 'user-1' }),
      );
      technicianSkillRepository.find.mockResolvedValue([]);
      ticketRepository.count.mockResolvedValue(0);

      const result = await service.getByIdForCaller('user-1', admin);

      expect(result.id).toBe('user-1');
    });

    it('lets a TECHNICIAN read their own profile', async () => {
      const self = buildUser({ id: 'user-1', role: UserRole.TECHNICIAN });
      technicianProfileRepository.findOne.mockResolvedValue(
        buildProfileWithUser({ userId: 'user-1' }),
      );
      technicianSkillRepository.find.mockResolvedValue([]);
      ticketRepository.count.mockResolvedValue(0);

      const result = await service.getByIdForCaller('user-1', self);

      expect(result.id).toBe('user-1');
    });

    it('rejects a TECHNICIAN reading a DIFFERENT technician profile with 403, without even querying the repository', async () => {
      const other = buildUser({ id: 'user-2', role: UserRole.TECHNICIAN });

      await expect(service.getByIdForCaller('user-1', other)).rejects.toThrow(
        ForbiddenException,
      );
      expect(technicianProfileRepository.findOne).not.toHaveBeenCalled();
    });

    it('rejects with 404 when no technician profile exists for the given userId', async () => {
      const admin = buildUser({ id: 'admin-1', role: UserRole.ADMIN });
      technicianProfileRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getByIdForCaller('missing-user', admin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects with 400 when the body has no field at all, without touching the repository', async () => {
      await expect(service.update('user-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(technicianProfileRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('rejects with 404 when the technician does not exist', async () => {
      technicianProfileRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-user', { isAvailable: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates isAvailable/maxConcurrentTickets on the profile without calling UsersService.update', async () => {
      technicianProfileRepository.findOneBy.mockResolvedValue(buildProfile());
      technicianProfileRepository.findOne.mockResolvedValue(
        buildProfileWithUser(),
      );
      technicianSkillRepository.find.mockResolvedValue([]);
      ticketRepository.count.mockResolvedValue(0);

      const dto: UpdateTechnicianDto = {
        isAvailable: false,
        maxConcurrentTickets: 9,
      };
      await service.update('user-1', dto);

      expect(technicianProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          isAvailable: false,
          maxConcurrentTickets: 9,
        }),
      );
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('routes isActive through UsersService.update (D9) without saving the profile when no profile field was sent', async () => {
      technicianProfileRepository.findOneBy.mockResolvedValue(buildProfile());
      technicianProfileRepository.findOne.mockResolvedValue(
        buildProfileWithUser(),
      );
      technicianSkillRepository.find.mockResolvedValue([]);
      ticketRepository.count.mockResolvedValue(0);

      await service.update('user-1', { isActive: false });

      expect(usersService.update).toHaveBeenCalledWith('user-1', {
        isActive: false,
      });
      expect(technicianProfileRepository.save).not.toHaveBeenCalled();
    });

    it('applies both the profile fields AND isActive when both are sent', async () => {
      technicianProfileRepository.findOneBy.mockResolvedValue(buildProfile());
      technicianProfileRepository.findOne.mockResolvedValue(
        buildProfileWithUser(),
      );
      technicianSkillRepository.find.mockResolvedValue([]);
      ticketRepository.count.mockResolvedValue(0);

      await service.update('user-1', { isAvailable: true, isActive: true });

      expect(technicianProfileRepository.save).toHaveBeenCalled();
      expect(usersService.update).toHaveBeenCalledWith('user-1', {
        isActive: true,
      });
    });
  });

  describe('setSkills', () => {
    it('rejects with 404 when the technician does not exist, without starting a transaction', async () => {
      technicianProfileRepository.findOneBy.mockResolvedValue(null);

      const dto: SetTechnicianSkillsDto = { skills: [{ skillId: 'skill-1' }] };
      await expect(service.setSkills('missing-user', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('rejects with 404 when a requested skillId does not exist, and never deletes the existing skill set', async () => {
      technicianProfileRepository.findOneBy.mockResolvedValue(buildProfile());
      skillTxRepo.countBy.mockResolvedValue(0);

      const dto: SetTechnicianSkillsDto = { skills: [{ skillId: 'unknown' }] };
      await expect(service.setSkills('user-1', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(technicianSkillTxRepo.delete).not.toHaveBeenCalled();
    });

    it('fully replaces the skill set: deletes every existing row for the profile, then inserts exactly the new set', async () => {
      technicianProfileRepository.findOneBy.mockResolvedValue(buildProfile());
      skillTxRepo.countBy.mockResolvedValue(1);
      technicianProfileRepository.findOne.mockResolvedValue(
        buildProfileWithUser(),
      );
      technicianSkillRepository.find.mockResolvedValue([]);
      ticketRepository.count.mockResolvedValue(0);

      const dto: SetTechnicianSkillsDto = {
        skills: [{ skillId: 'skill-9', level: 4 }],
      };
      await service.setSkills('user-1', dto);

      expect(technicianSkillTxRepo.delete).toHaveBeenCalledWith({
        technicianProfileId: 'profile-1',
      });
      expect(technicianSkillTxRepo.create).toHaveBeenCalledWith({
        technicianProfileId: 'profile-1',
        skillId: 'skill-9',
        level: 4,
      });
      expect(technicianSkillTxRepo.save).toHaveBeenCalledTimes(1);
    });

    it('clears every skill (deletes, inserts nothing) when given an empty skills array', async () => {
      technicianProfileRepository.findOneBy.mockResolvedValue(buildProfile());
      technicianProfileRepository.findOne.mockResolvedValue(
        buildProfileWithUser(),
      );
      technicianSkillRepository.find.mockResolvedValue([]);
      ticketRepository.count.mockResolvedValue(0);

      await service.setSkills('user-1', { skills: [] });

      expect(technicianSkillTxRepo.delete).toHaveBeenCalledWith({
        technicianProfileId: 'profile-1',
      });
      expect(technicianSkillTxRepo.create).not.toHaveBeenCalled();
      expect(technicianSkillTxRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateAvailability', () => {
    it('rejects with 404 when the caller has no technician profile', async () => {
      technicianProfileRepository.findOneBy.mockResolvedValue(null);

      const dto: UpdateAvailabilityDto = { isAvailable: false };
      await expect(service.updateAvailability('user-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("updates the caller's own profile availability", async () => {
      const profile = buildProfile({ isAvailable: true });
      technicianProfileRepository.findOneBy.mockResolvedValue(profile);
      technicianProfileRepository.findOne.mockResolvedValue(
        buildProfileWithUser(),
      );
      technicianSkillRepository.find.mockResolvedValue([]);
      ticketRepository.count.mockResolvedValue(0);

      await service.updateAvailability('user-1', { isAvailable: false });

      expect(technicianProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isAvailable: false }),
      );
    });
  });
});
