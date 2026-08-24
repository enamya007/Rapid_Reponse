import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Brackets } from 'typeorm';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { CreateUserData } from './types/create-user-data.type';
import { UpdateUserData, UsersService } from './users.service';

interface MockQueryBuilder {
  addSelect: jest.Mock<MockQueryBuilder, [string]>;
  withDeleted: jest.Mock<MockQueryBuilder, []>;
  where: jest.Mock<MockQueryBuilder, [string, Record<string, unknown>?]>;
  orWhere: jest.Mock<MockQueryBuilder, [string, Record<string, unknown>?]>;
  andWhere: jest.Mock<
    MockQueryBuilder,
    [string | Brackets, Record<string, unknown>?]
  >;
  getOne: jest.Mock<Promise<User | null>, []>;
  getExists: jest.Mock<Promise<boolean>, []>;
}

// A `Brackets` instance only stores its `whereFactory`; TypeORM itself invokes it lazily while
// building the final SQL. To assert what conditions `assertNoConflict` puts *inside* the
// brackets without a real query builder, this replays the factory against a tiny fake `qb`
// that just records every `orWhere` call it receives.
function extractBracketConditions(brackets: Brackets): string[] {
  const seen: string[] = [];
  const fakeQb = {
    orWhere: (condition: string) => {
      seen.push(condition);
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
  user.password = 'hashed-password';
  user.role = UserRole.CLIENT;
  user.isActive = true;
  user.createdAt = new Date('2024-01-01T00:00:00.000Z');
  user.updatedAt = new Date('2024-01-01T00:00:00.000Z');
  Object.assign(user, overrides);
  return user;
}

describe('UsersService', () => {
  let service: UsersService;
  let queryBuilder: MockQueryBuilder;
  let userRepository: {
    findOneBy: jest.Mock<Promise<User | null>, [Record<string, unknown>]>;
    create: jest.Mock<User, [Record<string, unknown>]>;
    save: jest.Mock<Promise<User>, [User]>;
    createQueryBuilder: jest.Mock<MockQueryBuilder, [string]>;
  };

  beforeEach(async () => {
    queryBuilder = {
      addSelect: jest.fn<MockQueryBuilder, [string]>(),
      withDeleted: jest.fn<MockQueryBuilder, []>(),
      where: jest.fn<MockQueryBuilder, [string, Record<string, unknown>?]>(),
      orWhere: jest.fn<MockQueryBuilder, [string, Record<string, unknown>?]>(),
      andWhere: jest.fn<
        MockQueryBuilder,
        [string | Brackets, Record<string, unknown>?]
      >(),
      getOne: jest.fn<Promise<User | null>, []>(),
      getExists: jest.fn<Promise<boolean>, []>(),
    };
    // Every chainable method returns the same builder instance, mimicking TypeORM's fluent API.
    queryBuilder.addSelect.mockReturnValue(queryBuilder);
    queryBuilder.withDeleted.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.orWhere.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);

    userRepository = {
      findOneBy: jest.fn<Promise<User | null>, [Record<string, unknown>]>(),
      create: jest.fn<User, [Record<string, unknown>]>(),
      save: jest.fn<Promise<User>, [User]>(),
      createQueryBuilder: jest.fn<MockQueryBuilder, [string]>(
        () => queryBuilder,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findByIdentifierWithPassword', () => {
    it('explicitly re-selects the password column, which is excluded by default, and matches username OR email', async () => {
      const user = buildUser();
      queryBuilder.getOne.mockResolvedValue(user);

      const result = await service.findByIdentifierWithPassword('jdoe');

      expect(userRepository.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(queryBuilder.addSelect).toHaveBeenCalledWith('user.password');
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'user.username = :identifier',
        { identifier: 'jdoe' },
      );
      expect(queryBuilder.orWhere).toHaveBeenCalledWith(
        'user.email = :identifier',
        { identifier: 'jdoe' },
      );
      expect(result).toBe(user);
    });
  });

  describe('findById / findByUsername / findByEmail', () => {
    it('findById looks up by id via findOneBy, without selecting the password column', async () => {
      const user = buildUser();
      userRepository.findOneBy.mockResolvedValue(user);

      const result = await service.findById('user-1');

      expect(userRepository.findOneBy).toHaveBeenCalledWith({ id: 'user-1' });
      expect(userRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(queryBuilder.addSelect).not.toHaveBeenCalled();
      expect(result).toBe(user);
    });

    it('findByUsername looks up by username via findOneBy, without selecting the password column', async () => {
      const user = buildUser();
      userRepository.findOneBy.mockResolvedValue(user);

      const result = await service.findByUsername('jdoe');

      expect(userRepository.findOneBy).toHaveBeenCalledWith({
        username: 'jdoe',
      });
      expect(userRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(queryBuilder.addSelect).not.toHaveBeenCalled();
      expect(result).toBe(user);
    });

    it('findByEmail looks up by email via findOneBy, without selecting the password column', async () => {
      const user = buildUser();
      userRepository.findOneBy.mockResolvedValue(user);

      const result = await service.findByEmail('jdoe@example.com');

      expect(userRepository.findOneBy).toHaveBeenCalledWith({
        email: 'jdoe@example.com',
      });
      expect(userRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(queryBuilder.addSelect).not.toHaveBeenCalled();
      expect(result).toBe(user);
    });
  });

  describe('create', () => {
    it('defaults the role to CLIENT when none is provided, and maps passwordHash to the password column', async () => {
      const data: CreateUserData = {
        username: 'newuser',
        email: 'newuser@example.com',
        passwordHash: 'argon2-hash',
      };
      const createdEntity = buildUser({
        username: data.username,
        email: data.email,
        password: data.passwordHash,
        role: UserRole.CLIENT,
      });
      userRepository.create.mockReturnValue(createdEntity);
      userRepository.save.mockResolvedValue(createdEntity);

      const result = await service.create(data);

      expect(userRepository.create).toHaveBeenCalledWith({
        username: data.username,
        email: data.email,
        password: data.passwordHash,
        role: UserRole.CLIENT,
        firstName: undefined,
        lastName: undefined,
        phone: undefined,
      });
      expect(userRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toBe(createdEntity);
    });

    it('maps optional firstName/lastName/phone through to the created entity', async () => {
      const data: CreateUserData = {
        username: 'newuser3',
        email: 'newuser3@example.com',
        passwordHash: 'argon2-hash',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+1 555 123 4567',
      };
      const createdEntity = buildUser({
        username: data.username,
        email: data.email,
        password: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
      });
      userRepository.create.mockReturnValue(createdEntity);
      userRepository.save.mockResolvedValue(createdEntity);

      await service.create(data);

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Doe',
          phone: '+1 555 123 4567',
        }),
      );
    });

    it('respects an explicitly provided role instead of defaulting', async () => {
      const data: CreateUserData = {
        username: 'newadmin',
        email: 'newadmin@example.com',
        passwordHash: 'argon2-hash',
        role: UserRole.ADMIN,
      };
      const createdEntity = buildUser({
        username: data.username,
        email: data.email,
        password: data.passwordHash,
        role: UserRole.ADMIN,
      });
      userRepository.create.mockReturnValue(createdEntity);
      userRepository.save.mockResolvedValue(createdEntity);

      await service.create(data);

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
      );
    });
  });

  describe('existsByUsernameOrEmail', () => {
    it('runs a single query combining username and email with OR', async () => {
      queryBuilder.getExists.mockResolvedValue(true);

      const result = await service.existsByUsernameOrEmail(
        'jdoe',
        'jdoe@example.com',
      );

      expect(userRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'user.username = :username',
        { username: 'jdoe' },
      );
      expect(queryBuilder.orWhere).toHaveBeenCalledWith('user.email = :email', {
        email: 'jdoe@example.com',
      });
      expect(queryBuilder.getExists).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    // P6.5 D11. Without `withDeleted()`, TypeORM adds `deleted_at IS NULL` to the main alias:
    // a soft-deleted account holding the username would not be seen here, this pre-check would
    // report "free", and the INSERT that follows would fail on the DB's own unique constraint
    // (`23505`) — surfacing as a 500 instead of a 409, since the constraint is NOT scoped to
    // non-deleted rows.
    it('spans soft-deleted rows: the unique constraints it mirrors are not scoped to live rows (D11)', async () => {
      queryBuilder.getExists.mockResolvedValue(false);

      await service.existsByUsernameOrEmail('jdoe', 'jdoe@example.com');

      expect(queryBuilder.withDeleted).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the user does not exist (findOneBy already excludes soft-deleted rows)', async () => {
      userRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { firstName: 'New' }),
      ).rejects.toThrow(NotFoundException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('applies only the provided fields, leaving the rest of the entity untouched', async () => {
      const existing = buildUser();
      userRepository.findOneBy.mockResolvedValue(existing);
      userRepository.save.mockImplementation((user: User) =>
        Promise.resolve(user),
      );

      const data: UpdateUserData = { firstName: 'Jane', isActive: false };
      const result = await service.update('user-1', data);

      // No username/email in the patch: the conflict check is skipped entirely.
      expect(userRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(userRepository.save).toHaveBeenCalledTimes(1);
      expect(result.firstName).toBe('Jane');
      expect(result.isActive).toBe(false);
      expect(result.username).toBe('jdoe');
      expect(result.email).toBe('jdoe@example.com');
    });

    it('never persists a password field: UpdateUserData has no such field and the loaded entity keeps its existing (unselected) password untouched', async () => {
      const existing = buildUser();
      userRepository.findOneBy.mockResolvedValue(existing);
      userRepository.save.mockImplementation((user: User) =>
        Promise.resolve(user),
      );

      const result = await service.update('user-1', { lastName: 'Doe' });

      expect(result.password).toBe('hashed-password');
    });

    it('throws ConflictException when the new username is already taken by another user, and does not save', async () => {
      const existing = buildUser();
      userRepository.findOneBy.mockResolvedValue(existing);
      queryBuilder.getExists.mockResolvedValue(true);

      await expect(
        service.update('user-1', { username: 'someoneelse' }),
      ).rejects.toThrow(ConflictException);

      expect(userRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(queryBuilder.where).toHaveBeenCalledWith('user.id != :id', {
        id: 'user-1',
      });
      const [bracketsArg] = queryBuilder.andWhere.mock.calls[0] as [Brackets];
      expect(extractBracketConditions(bracketsArg)).toEqual([
        'user.username = :username',
      ]);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the new email is already taken by another user, and does not save', async () => {
      const existing = buildUser();
      userRepository.findOneBy.mockResolvedValue(existing);
      queryBuilder.getExists.mockResolvedValue(true);

      await expect(
        service.update('user-1', { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);

      const [bracketsArg] = queryBuilder.andWhere.mock.calls[0] as [Brackets];
      expect(extractBracketConditions(bracketsArg)).toEqual([
        'user.email = :email',
      ]);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('checks both username and email together when both change in the same patch', async () => {
      const existing = buildUser();
      userRepository.findOneBy.mockResolvedValue(existing);
      queryBuilder.getExists.mockResolvedValue(false);
      userRepository.save.mockImplementation((user: User) =>
        Promise.resolve(user),
      );

      await service.update('user-1', {
        username: 'newname',
        email: 'new@example.com',
      });

      const [bracketsArg] = queryBuilder.andWhere.mock.calls[0] as [Brackets];
      expect(extractBracketConditions(bracketsArg)).toEqual([
        'user.username = :username',
        'user.email = :email',
      ]);
    });

    it('does not raise a conflict when the user keeps their own current username and email (no-op values in the patch)', async () => {
      const existing = buildUser();
      userRepository.findOneBy.mockResolvedValue(existing);
      userRepository.save.mockImplementation((user: User) =>
        Promise.resolve(user),
      );

      const result = await service.update('user-1', {
        username: existing.username,
        email: existing.email,
        lastName: 'Updated',
      });

      // Unchanged relative to the current row: the conflict query must never run.
      expect(userRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(userRepository.save).toHaveBeenCalledTimes(1);
      expect(result.lastName).toBe('Updated');
    });

    it('excludes the user being updated from the conflict check (own row must not self-collide)', async () => {
      const existing = buildUser();
      userRepository.findOneBy.mockResolvedValue(existing);
      queryBuilder.getExists.mockResolvedValue(false);
      userRepository.save.mockImplementation((user: User) =>
        Promise.resolve(user),
      );

      await service.update('user-1', { username: 'brandnewname' });

      expect(queryBuilder.where).toHaveBeenCalledWith('user.id != :id', {
        id: 'user-1',
      });
    });

    // P6.5 D11, same reasoning as `existsByUsernameOrEmail` above: renaming a live account to a
    // username still held by a soft-deleted one must be a 409, not a 500 from the DB.
    it('runs the conflict check across soft-deleted rows too (D11)', async () => {
      const existing = buildUser();
      userRepository.findOneBy.mockResolvedValue(existing);
      queryBuilder.getExists.mockResolvedValue(false);
      userRepository.save.mockImplementation((user: User) =>
        Promise.resolve(user),
      );

      await service.update('user-1', { username: 'brandnewname' });

      expect(queryBuilder.withDeleted).toHaveBeenCalledTimes(1);
    });
  });
});
