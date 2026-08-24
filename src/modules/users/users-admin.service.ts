import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { isUniqueViolation } from '../../common/database/unique-violation.util';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { hashPassword } from '../../common/security/password.util';
import {
  buildPaginatedResponse,
  toTypeOrmSkipTake,
} from '../../common/utils/pagination.util';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketStatus } from '../tickets/enums/ticket-status.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { UsersService } from './users.service';

// A ticket in one of these statuses is still live work: its assignee must not be able to
// disappear from under it (D4). `RESOLVED` is deliberately absent — nothing more is expected
// from the assignee once it is resolved, only a CLIENT/ADMIN close or reopen.
const NON_TERMINAL_STATUSES: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
];

// `%` and `_` are LIKE wildcards. Left unescaped, `?search=%` matches every account and
// `?search=_` becomes a single-character joker: the filter would be trivially bypassable and its
// cost unbounded (D10). The backslash itself is escaped first, otherwise escaping the wildcards
// would produce sequences this function had itself introduced.
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * ADMIN-facing account management (P6.5 contract, `docs/plan-P6.5-contracts.md`).
 *
 * Kept separate from `UsersService` on purpose: that service sits on the hot path — `JwtStrategy`
 * calls `findById` on EVERY authenticated request — and has exactly one repository dependency.
 * The admin surface needs a second one (`Ticket`, for D4) and carries policy rather than data
 * access. Splitting keeps the hot path narrow and puts every rule of this phase in one file.
 */
@Injectable()
export class UsersAdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    private readonly usersService: UsersService,
  ) {}

  // `GET /users` — paginated, filtered, soft-deleted rows excluded (the `user` alias is this
  // query builder's main alias, so TypeORM adds `deleted_at IS NULL` for free).
  async list(
    query: UserQueryDto,
  ): Promise<PaginatedResponseDto<UserResponseDto>> {
    const total = await this.buildFilteredQuery(query).getCount();

    const { skip, take } = toTypeOrmSkipTake(query);
    const users = await this.buildFilteredQuery(query)
      .orderBy('user.username', 'ASC')
      .skip(skip)
      .take(take)
      .getMany();

    return buildPaginatedResponse(
      users.map((user) => UserResponseDto.fromEntity(user)),
      total,
      query,
    );
  }

  // `GET /users/:id` — `findOneBy` implicitly excludes soft-deleted rows, so a deleted account
  // reads as 404 rather than being resurrected in the admin UI.
  async getById(id: string): Promise<UserResponseDto> {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return UserResponseDto.fromEntity(user);
  }

  // `POST /users` — D1: TECHNICIAN is refused here, because only `POST /technicians` creates the
  // account AND its `TechnicianProfile` in one transaction.
  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const role = dto.role ?? UserRole.CLIENT;
    if (role === UserRole.TECHNICIAN) {
      throw new BadRequestException(
        'Use POST /technicians to create a technician: it creates the account and its technician profile in one transaction. A TECHNICIAN without a profile can never be assigned a ticket.',
      );
    }

    // Hashed before the existence check rather than after: argon2id is ~100 ms of pure CPU, and
    // doing it first keeps the cost identical whether or not the account already exists. Same
    // reasoning as D13-bis on `forgot-password` — an ADMIN-only route is a far weaker oracle,
    // but the ordering costs nothing.
    const passwordHash = await hashPassword(dto.password);

    const alreadyExists = await this.usersService.existsByUsernameOrEmail(
      dto.username,
      dto.email,
    );
    if (alreadyExists) {
      throw new ConflictException('Username or email already in use');
    }

    let user: User;
    try {
      user = await this.usersService.create({
        username: dto.username,
        email: dto.email,
        passwordHash,
        role,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
      });
    } catch (error) {
      // The pre-check above narrows the common case, but two concurrent requests could both
      // pass it before either commits. Same defense-in-depth as `SkillsService.create`.
      if (isUniqueViolation(error)) {
        throw new ConflictException('Username or email already in use');
      }
      throw error;
    }

    return UserResponseDto.fromEntity(user);
  }

  // `PATCH /users/:id` — D2 (no role change to/from TECHNICIAN) and D3 (no self-mutation of
  // `role`/`isActive`).
  async update(
    id: string,
    dto: UpdateUserDto,
    currentUser: User,
  ): Promise<UserResponseDto> {
    const hasAnyField =
      dto.username !== undefined ||
      dto.email !== undefined ||
      dto.firstName !== undefined ||
      dto.lastName !== undefined ||
      dto.phone !== undefined ||
      dto.role !== undefined ||
      dto.isActive !== undefined;
    if (!hasAnyField) {
      throw new BadRequestException(
        'At least one field must be provided to update a user',
      );
    }

    // D3, checked BEFORE the row is loaded: the rule depends only on who the caller is and what
    // they are trying to change, never on the target's current state. Note it fires even when
    // the submitted value equals the current one — "an admin never touches their own role or
    // activation through this route" is a rule that stays easy to verify precisely because it
    // has no exception.
    if (
      id === currentUser.id &&
      (dto.role !== undefined || dto.isActive !== undefined)
    ) {
      throw new BadRequestException(
        'An administrator cannot change their own role or activation state',
      );
    }

    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.role !== undefined && dto.role !== user.role) {
      if (
        dto.role === UserRole.TECHNICIAN ||
        user.role === UserRole.TECHNICIAN
      ) {
        throw new BadRequestException(
          'A role cannot be changed to or from TECHNICIAN here: it would leave either an account without a technician profile, or a technician profile attached to an account that is no longer a technician. Use POST /technicians, or deactivate the account instead.',
        );
      }
    }

    let updated: User;
    try {
      updated = await this.usersService.update(id, {
        username: dto.username,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: dto.role,
        isActive: dto.isActive,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Username or email already in use');
      }
      throw error;
    }

    return UserResponseDto.fromEntity(updated);
  }

  // `DELETE /users/:id` — soft delete (D4). The row survives, so every ticket, comment and
  // status-history entry that references it stays readable ("conservation de l'historique pour
  // traçabilité", cahier des charges §3).
  //
  // No refresh-token revocation here (D5): `JwtStrategy.validate` re-reads the user on every
  // request and `AuthService.refresh` re-reads it before issuing, and both reject a row that
  // `findById` no longer returns — which is exactly what a soft-deleted row becomes.
  async softDelete(id: string, currentUser: User): Promise<void> {
    if (id === currentUser.id) {
      throw new BadRequestException(
        'An administrator cannot delete their own account',
      );
    }

    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const hasLiveWork = await this.ticketRepository.exists({
      where: { assigneeId: id, status: In(NON_TERMINAL_STATUSES) },
    });
    if (hasLiveWork) {
      throw new ConflictException(
        'This user is still assigned to open tickets. Reassign or close them first, or deactivate the account instead (PATCH /users/:id with isActive: false).',
      );
    }

    await this.userRepository.softDelete(id);
  }

  // Two INDEPENDENT builders are produced (one per call) rather than one mutated object reused
  // for both the count and the page: an `ORDER BY`/`LIMIT` set for one must not leak into the
  // other. Same pattern as `TechniciansService.buildFilteredProfileQuery`.
  private buildFilteredQuery(query: UserQueryDto): SelectQueryBuilder<User> {
    const qb = this.userRepository.createQueryBuilder('user');

    if (query.role !== undefined) {
      qb.andWhere('user.role = :role', { role: query.role });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('user.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.search) {
      const search = `%${escapeLikePattern(query.search)}%`;
      // Wrapped in `Brackets`: without them the OR chain would associate with the `role`/
      // `isActive` conditions above and silently widen the result set past those filters.
      qb.andWhere(
        new Brackets((where) => {
          where
            .orWhere('user.username ILIKE :search', { search })
            .orWhere('user.email ILIKE :search', { search })
            .orWhere('user.firstName ILIKE :search', { search })
            .orWhere('user.lastName ILIKE :search', { search });
        }),
      );
    }

    return qb;
  }
}
