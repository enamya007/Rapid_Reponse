import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { isUniqueViolation } from '../../common/database/unique-violation.util';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { hashPassword } from '../../common/security/password.util';
import {
  buildPaginatedResponse,
  toTypeOrmSkipTake,
} from '../../common/utils/pagination.util';
import { Skill } from '../skills/entities/skill.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { UsersService } from '../users/users.service';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { SetTechnicianSkillsDto } from './dto/set-technician-skills.dto';
import { TechnicianQueryDto } from './dto/technician-query.dto';
import { TechnicianResponseDto } from './dto/technician-response.dto';
import { TechnicianSkillResponseDto } from './dto/technician-skill-response.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateTechnicianDto } from './dto/update-technician.dto';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianSkill } from './entities/technician-skill.entity';
import {
  ACTIVE_LOAD_STATUSES,
  CURRENT_LOAD_SELECT_SQL,
} from './technician-suggestion.service';

// P5 contract §3 ("Techniciens") and §4 (`docs/plan-P5-contracts.md`) — figées.
@Injectable()
export class TechniciansService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TechnicianProfile)
    private readonly technicianProfileRepository: Repository<TechnicianProfile>,
    @InjectRepository(TechnicianSkill)
    private readonly technicianSkillRepository: Repository<TechnicianSkill>,
    @InjectRepository(Skill)
    private readonly skillRepository: Repository<Skill>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    private readonly usersService: UsersService,
  ) {}

  // `POST /technicians` — User + TechnicianProfile + TechnicianSkill rows are created in ONE
  // transaction: an unknown `skillId` must roll back the `User` row too (never leave an orphan
  // account with no profile), which rules out calling `UsersService.create()` (it manages its
  // own, separate, non-transactional `save()` — see that file's own doc comment, read-only here).
  async create(dto: CreateTechnicianDto): Promise<TechnicianResponseDto> {
    // Hashed OUTSIDE the transaction: it's pure CPU work with no DB interaction, no reason to
    // hold a transaction/connection open for it.
    const passwordHash = await hashPassword(dto.password);
    const uniqueSkillIds = [
      ...new Set((dto.skills ?? []).map((skill) => skill.skillId)),
    ];

    const userId = await this.userRepository.manager.transaction(
      async (manager) => {
        const userRepo = manager.getRepository(User);
        const profileRepo = manager.getRepository(TechnicianProfile);
        const skillRepo = manager.getRepository(Skill);
        const technicianSkillRepo = manager.getRepository(TechnicianSkill);

        // `withDeleted: true`: the `username`/`email` unique constraints are not scoped to
        // "not soft-deleted" at the DB level (`docs/data-model.md` §2.1), so a soft-deleted
        // user still legitimately blocks reuse of their username/email.
        const conflictExists = await userRepo.exists({
          where: [{ username: dto.username }, { email: dto.email }],
          withDeleted: true,
        });
        if (conflictExists) {
          throw new ConflictException('Username or email already in use');
        }

        // Validated BEFORE the `User` row is even created: on failure, this throws before any
        // insert happens in this transaction, so there is nothing to roll back yet — the
        // transaction still guarantees atomicity regardless, this is purely an efficiency
        // choice (no reason to insert a row we already know we'll discard).
        if (uniqueSkillIds.length > 0) {
          const foundCount = await skillRepo.countBy({
            id: In(uniqueSkillIds),
          });
          if (foundCount !== uniqueSkillIds.length) {
            throw new NotFoundException('One or more skills were not found');
          }
        }

        const user = userRepo.create({
          username: dto.username,
          email: dto.email,
          password: passwordHash,
          role: UserRole.TECHNICIAN,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
        });

        let savedUser: User;
        try {
          savedUser = await userRepo.save(user);
        } catch (error) {
          // Same defense-in-depth as `SkillsService.create`: the pre-check above narrows the
          // common case, but two concurrent requests could both pass it before either commits.
          if (isUniqueViolation(error)) {
            throw new ConflictException('Username or email already in use');
          }
          throw error;
        }

        const profile = profileRepo.create({
          userId: savedUser.id,
          isAvailable: dto.isAvailable ?? true,
          maxConcurrentTickets: dto.maxConcurrentTickets ?? 5,
        });
        const savedProfile = await profileRepo.save(profile);

        if (dto.skills?.length) {
          const rows = dto.skills.map((skill) =>
            technicianSkillRepo.create({
              technicianProfileId: savedProfile.id,
              skillId: skill.skillId,
              level: skill.level ?? 3,
            }),
          );
          await technicianSkillRepo.save(rows);
        }

        return savedUser.id;
      },
    );

    return this.getById(userId);
  }

  // `GET /technicians` — paginated, filtered, `currentLoad` computed for the whole page in a
  // SINGLE query (no per-technician round trip): see `buildFilteredProfileQuery`'s own comment
  // for why `profile` (not `user`) is the query builder's root, and `CURRENT_LOAD_SELECT_SQL`'s
  // comment (`technician-suggestion.service.ts`) for the correlated-subquery approach itself.
  // Total query count for this method, REGARDLESS of how many technicians match: exactly 3
  // (`getCount`, the page's `getRawAndEntities`, one batched `skills` lookup) — never `O(n)`.
  async list(
    query: TechnicianQueryDto,
  ): Promise<PaginatedResponseDto<TechnicianResponseDto>> {
    const total = await this.buildFilteredProfileQuery(query).getCount();

    const dataQb = this.buildFilteredProfileQuery(query)
      .addSelect(CURRENT_LOAD_SELECT_SQL, 'currentLoad')
      .orderBy('user.username', 'ASC');

    const { skip, take } = toTypeOrmSkipTake(query);
    dataQb.skip(skip).take(take);

    const { entities, raw } = await dataQb.getRawAndEntities<{
      currentLoad: string | number;
    }>();

    const skillsByProfileId = await this.loadSkillsByProfileIds(
      entities.map((profile) => profile.id),
    );

    const dtos = entities.map((profile, index) =>
      TechnicianResponseDto.fromEntity(
        profile.user,
        profile,
        Number(raw[index].currentLoad),
        skillsByProfileId.get(profile.id) ?? [],
      ),
    );

    return buildPaginatedResponse(dtos, total, query);
  }

  // `GET /technicians/:id` — D4: `id` is a userId. ADMIN may read any technician; a TECHNICIAN
  // may only read their own profile (403 otherwise); a CLIENT never reaches this service method
  // at all (`RolesGuard`, via `@Auth(ADMIN, TECHNICIAN)` on the controller route, rejects it with
  // 403 first) — this role-vs-ownership check lives here, in the service, per the brief.
  async getByIdForCaller(
    id: string,
    currentUser: User,
  ): Promise<TechnicianResponseDto> {
    if (currentUser.role === UserRole.TECHNICIAN && currentUser.id !== id) {
      throw new ForbiddenException(
        'A technician may only view their own profile',
      );
    }
    return this.getById(id);
  }

  // `PATCH /technicians/:id` — `isAvailable`/`maxConcurrentTickets` on the profile,
  // `isActive` via `UsersService.update()` (D9). 400 when the body is entirely empty.
  async update(
    id: string,
    dto: UpdateTechnicianDto,
  ): Promise<TechnicianResponseDto> {
    const hasAnyField =
      dto.isAvailable !== undefined ||
      dto.maxConcurrentTickets !== undefined ||
      dto.isActive !== undefined;
    if (!hasAnyField) {
      throw new BadRequestException(
        'At least one field must be provided to update a technician',
      );
    }

    const profile = await this.technicianProfileRepository.findOneBy({
      userId: id,
    });
    if (!profile) {
      throw new NotFoundException('Technician not found');
    }

    let profileChanged = false;
    if (dto.isAvailable !== undefined) {
      profile.isAvailable = dto.isAvailable;
      profileChanged = true;
    }
    if (dto.maxConcurrentTickets !== undefined) {
      profile.maxConcurrentTickets = dto.maxConcurrentTickets;
      profileChanged = true;
    }
    if (profileChanged) {
      await this.technicianProfileRepository.save(profile);
    }

    if (dto.isActive !== undefined) {
      // D9: routed through `UsersService.update()` (already validated/delivered), never a
      // direct write to `User` from this module.
      await this.usersService.update(id, { isActive: dto.isActive });
    }

    return this.getById(id);
  }

  // `PUT /technicians/:id/skills` — full replacement, in one transaction: the previous rows are
  // gone even if the insert of the new set never happens to run (e.g. an empty `skills: []`).
  async setSkills(
    id: string,
    dto: SetTechnicianSkillsDto,
  ): Promise<TechnicianResponseDto> {
    const profile = await this.technicianProfileRepository.findOneBy({
      userId: id,
    });
    if (!profile) {
      throw new NotFoundException('Technician not found');
    }

    const uniqueSkillIds = [
      ...new Set(dto.skills.map((skill) => skill.skillId)),
    ];

    await this.technicianProfileRepository.manager.transaction(
      async (manager) => {
        if (uniqueSkillIds.length > 0) {
          const foundCount = await manager
            .getRepository(Skill)
            .countBy({ id: In(uniqueSkillIds) });
          if (foundCount !== uniqueSkillIds.length) {
            throw new NotFoundException('One or more skills were not found');
          }
        }

        const technicianSkillRepo = manager.getRepository(TechnicianSkill);
        await technicianSkillRepo.delete({ technicianProfileId: profile.id });

        if (dto.skills.length > 0) {
          const rows = dto.skills.map((skill) =>
            technicianSkillRepo.create({
              technicianProfileId: profile.id,
              skillId: skill.skillId,
              level: skill.level ?? 3,
            }),
          );
          await technicianSkillRepo.save(rows);
        }
      },
    );

    return this.getById(id);
  }

  // `PATCH /technicians/me/availability` — the caller updates THEIR OWN profile; `userId` always
  // comes from `@CurrentUser()`, never from a route param, so there is no ownership check to
  // make here beyond "does a profile even exist for this user".
  async updateAvailability(
    userId: string,
    dto: UpdateAvailabilityDto,
  ): Promise<TechnicianResponseDto> {
    const profile = await this.technicianProfileRepository.findOneBy({
      userId,
    });
    if (!profile) {
      throw new NotFoundException('Technician profile not found');
    }

    profile.isAvailable = dto.isAvailable;
    await this.technicianProfileRepository.save(profile);

    return this.getById(userId);
  }

  private async getById(userId: string): Promise<TechnicianResponseDto> {
    const profile = await this.technicianProfileRepository.findOne({
      where: { userId },
      relations: { user: true },
    });
    if (!profile) {
      throw new NotFoundException('Technician not found');
    }

    // Single, already-known technician: a plain `count()` is enough (D3) — the correlated
    // subquery form (`CURRENT_LOAD_SELECT_SQL`) only earns its complexity for `list()`, where
    // many technicians are scored inside the SAME query.
    const currentLoad = await this.ticketRepository.count({
      where: { assigneeId: userId, status: In(ACTIVE_LOAD_STATUSES) },
    });

    const skillRows = await this.technicianSkillRepository.find({
      where: { technicianProfileId: profile.id },
      relations: { skill: true },
    });

    return TechnicianResponseDto.fromEntity(
      profile.user,
      profile,
      currentLoad,
      skillRows.map((row) => TechnicianSkillResponseDto.fromEntity(row)),
    );
  }

  // Shared WHERE/JOIN base for `list()`'s count query and its data query: two INDEPENDENT
  // `SelectQueryBuilder` instances (never the same mutated object reused across both calls), so
  // neither can be accidentally left in a state — an `ORDER BY`/`LIMIT` set for one — that
  // corrupts the other.
  private buildFilteredProfileQuery(
    query: TechnicianQueryDto,
  ): SelectQueryBuilder<TechnicianProfile> {
    const qb = this.technicianProfileRepository
      .createQueryBuilder('profile')
      .innerJoinAndSelect('profile.user', 'user')
      // `user` is a JOINED alias here, not this query builder's main entity (`profile` is): only
      // the main alias gets TypeORM's automatic `deletedAt IS NULL` guard for free (see
      // `TicketsService.list`'s own comment on that behaviour), so it is added explicitly.
      .andWhere('user.deletedAt IS NULL');

    if (query.isAvailable !== undefined) {
      qb.andWhere('profile.isAvailable = :isAvailable', {
        isAvailable: query.isAvailable,
      });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('user.isActive = :isActive', {
        isActive: query.isActive,
      });
    }
    if (query.skillId) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM technician_skills ts WHERE ts.technician_profile_id = profile.id AND ts.skill_id = :skillId)',
        { skillId: query.skillId },
      );
    }

    return qb;
  }

  // Batched (ONE query for the whole page, not one per technician): the "no N+1" requirement
  // applies just as much to the skills lookup as it does to `currentLoad`.
  private async loadSkillsByProfileIds(
    profileIds: string[],
  ): Promise<Map<string, TechnicianSkillResponseDto[]>> {
    const skillsByProfileId = new Map<string, TechnicianSkillResponseDto[]>();
    if (profileIds.length === 0) {
      return skillsByProfileId;
    }

    const rows = await this.technicianSkillRepository.find({
      where: { technicianProfileId: In(profileIds) },
      relations: { skill: true },
    });

    for (const row of rows) {
      const existing = skillsByProfileId.get(row.technicianProfileId) ?? [];
      existing.push(TechnicianSkillResponseDto.fromEntity(row));
      skillsByProfileId.set(row.technicianProfileId, existing);
    }

    return skillsByProfileId;
  }
}
