import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { CreateUserData } from './types/create-user-data.type';

// Deliberately excludes `password` (no generic password-update path here — see `AuthService`
// for the dedicated, argon2-hashing flow) and `id`/`deletedAt` (never mutated through this
// type).
export interface UpdateUserData {
  isActive?: boolean;
  role?: UserRole;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  username?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.userRepository.findOneBy({ id });
  }

  findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOneBy({ username });
  }

  // Resolves a user by username OR email (the `identifier` field accepted at login), also
  // re-selecting the password column which is excluded by default.
  findByIdentifierWithPassword(identifier: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.username = :identifier', { identifier })
      .orWhere('user.email = :identifier', { identifier })
      .getOne();
  }

  findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email });
  }

  async create(data: CreateUserData): Promise<User> {
    const user = this.userRepository.create({
      username: data.username,
      email: data.email,
      password: data.passwordHash,
      role: data.role ?? UserRole.CLIENT,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
    });

    return this.userRepository.save(user);
  }

  // `withDeleted()` (P6.5 contract D11): the `username`/`email` unique constraints are NOT
  // scoped to "not soft-deleted" at the DB level (`docs/data-model.md` §2.1), so a soft-deleted
  // row still blocks reuse of its username/email. Without it this pre-check passes while the
  // INSERT that follows fails on `23505` — a 500 where the caller should have received a 409.
  // Same reasoning, and same fix, as the `withDeleted: true` existence check in
  // `TechniciansService.create`.
  existsByUsernameOrEmail(username: string, email: string): Promise<boolean> {
    return this.userRepository
      .createQueryBuilder('user')
      .withDeleted()
      .where('user.username = :username', { username })
      .orWhere('user.email = :email', { email })
      .getExists();
  }

  // Partial update of a user's non-credential fields. `findOneBy` implicitly excludes
  // soft-deleted rows (same TypeORM default `TicketsService.update` relies on), so a
  // soft-deleted user is treated as not found. `password` is never selected here (`select:
  // false` on the column), and since it stays `undefined` on the loaded entity, `save()` below
  // does not touch it: TypeORM only writes columns whose value is defined on the entity being
  // persisted, so the existing password hash is left untouched.
  async update(id: string, data: UpdateUserData): Promise<User> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.assertNoConflict(id, user, data.username, data.email);

    if (data.isActive !== undefined) {
      user.isActive = data.isActive;
    }
    if (data.role !== undefined) {
      user.role = data.role;
    }
    if (data.firstName !== undefined) {
      user.firstName = data.firstName;
    }
    if (data.lastName !== undefined) {
      user.lastName = data.lastName;
    }
    if (data.phone !== undefined) {
      user.phone = data.phone;
    }
    if (data.email !== undefined) {
      user.email = data.email;
    }
    if (data.username !== undefined) {
      user.username = data.username;
    }

    return this.userRepository.save(user);
  }

  // Same non-specific-conflict pattern as `AuthService.register` (via `existsByUsernameOrEmail`):
  // a single combined check, without revealing whether it was the username or the email that
  // collided. Scoped to "owned by a DIFFERENT user" so a user keeping their own current
  // username/email never trips a false conflict.
  private async assertNoConflict(
    id: string,
    current: User,
    username: string | undefined,
    email: string | undefined,
  ): Promise<void> {
    const usernameChanged =
      username !== undefined && username !== current.username;
    const emailChanged = email !== undefined && email !== current.email;
    if (!usernameChanged && !emailChanged) {
      return;
    }

    const conflictExists = await this.userRepository
      .createQueryBuilder('user')
      // See `existsByUsernameOrEmail` above (P6.5 D11): the conflict check must span
      // soft-deleted rows too, because the DB's unique constraints do.
      .withDeleted()
      .where('user.id != :id', { id })
      .andWhere(
        new Brackets((qb) => {
          if (usernameChanged) {
            qb.orWhere('user.username = :username', { username });
          }
          if (emailChanged) {
            qb.orWhere('user.email = :email', { email });
          }
        }),
      )
      .getExists();

    if (conflictExists) {
      throw new ConflictException('Username or email already in use');
    }
  }
}
