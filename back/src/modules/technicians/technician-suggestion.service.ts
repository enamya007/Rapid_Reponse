import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketStatus } from '../tickets/enums/ticket-status.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import {
  TechnicianSuggestionDto,
  TechnicianSuggestionRawRow,
} from './dto/technician-suggestion.dto';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianSkill } from './entities/technician-skill.entity';
import { TechnicianEligibility } from './types/technician-eligibility.type';

// D3 (`docs/plan-P5-contracts.md` §2): only these two statuses keep a ticket "in a technician's
// active load". Single source of truth, reused by `TechniciansService` (list currentLoad) so the
// two can never silently diverge.
export const ACTIVE_LOAD_STATUSES: TicketStatus[] = [
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
];

// Correlated scalar subquery computing a technician's current load, written once and reused
// wherever the calculation must happen INSIDE a single larger SQL statement (as opposed to
// `ticketRepository.count(...)` for a single, already-known technician — see
// `TechniciansService.getById`/`evaluateEligibility` below). `user.id` is a recognized alias in
// every query builder this is spliced into (`TechnicianSuggestionService.suggestForTicket`'s own
// `user`-rooted query, and `TechniciansService.list`'s `profile`-rooted query which still joins
// `user` under that exact alias), so TypeORM's alias-aware string preprocessing resolves it to
// the correct, fully-qualified column — this is NOT a naive string concatenation of
// caller-provided input, only fixed enum literals and a recognized alias name.
// `t`/`assignee_id`/`deleted_at`/`status` deliberately use the raw physical `tickets` column
// names (snake_case): `t` is a subquery-local alias unknown to the outer query builder, so it is
// left untouched by that same preprocessing rather than being (wrongly) rewritten.
const ACTIVE_LOAD_STATUSES_SQL_LIST = ACTIVE_LOAD_STATUSES.map(
  (status) => `'${status}'`,
).join(', ');
export const CURRENT_LOAD_SELECT_SQL = `(SELECT COUNT(*)::int FROM tickets t WHERE t.assignee_id = user.id AND t.deleted_at IS NULL AND t.status IN (${ACTIVE_LOAD_STATUSES_SQL_LIST}))`;

// P5 contract §4.1 (eligibility) and §4.3 (suggestion) — `docs/plan-P5-contracts.md`, figées.
// Exported from `TechniciansModule` (T5.1b) for T5.3 (affectation) to consume; this module never
// exposes an HTTP route for either method itself.
@Injectable()
export class TechnicianSuggestionService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TechnicianProfile)
    private readonly technicianProfileRepository: Repository<TechnicianProfile>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
  ) {}

  // §4.1 — the FIRST failure wins; each branch returns immediately rather than accumulating
  // reasons, so a technician who is e.g. both inactive AND unavailable is reported as INACTIVE,
  // never UNAVAILABLE (INACTIVE is checked first).
  async evaluateEligibility(userId: string): Promise<TechnicianEligibility> {
    // `withDeleted: true`: a soft-deleted account must be classified as INACTIVE (per the
    // contract's own parenthetical, "inactive OU soft-deleted"), not NOT_FOUND — the default
    // `findOne` would silently exclude it and produce the wrong reason.
    const user = await this.userRepository.findOne({
      where: { id: userId },
      withDeleted: true,
    });
    if (!user) {
      return {
        eligible: false,
        reason: 'NOT_FOUND',
        currentLoad: 0,
        maxConcurrentTickets: 0,
      };
    }

    if (user.role !== UserRole.TECHNICIAN) {
      return {
        eligible: false,
        reason: 'NOT_A_TECHNICIAN',
        currentLoad: 0,
        maxConcurrentTickets: 0,
      };
    }

    if (!user.isActive || user.deletedAt !== null) {
      return {
        eligible: false,
        reason: 'INACTIVE',
        currentLoad: 0,
        maxConcurrentTickets: 0,
      };
    }

    const profile = await this.technicianProfileRepository.findOneBy({
      userId,
    });
    if (!profile) {
      return {
        eligible: false,
        reason: 'NO_PROFILE',
        currentLoad: 0,
        maxConcurrentTickets: 0,
      };
    }

    if (!profile.isAvailable) {
      return {
        eligible: false,
        reason: 'UNAVAILABLE',
        currentLoad: 0,
        maxConcurrentTickets: profile.maxConcurrentTickets,
      };
    }

    // Single, already-known technician: a plain `count()` (COUNT query, D3) is simpler and
    // just as "computed in SQL" as the correlated-subquery form `suggestForTicket`/`list` need —
    // that form only earns its complexity when many technicians are scored in the SAME query.
    const currentLoad = await this.ticketRepository.count({
      where: { assigneeId: userId, status: In(ACTIVE_LOAD_STATUSES) },
    });

    if (currentLoad >= profile.maxConcurrentTickets) {
      return {
        eligible: false,
        reason: 'AT_CAPACITY',
        currentLoad,
        maxConcurrentTickets: profile.maxConcurrentTickets,
      };
    }

    return {
      eligible: true,
      currentLoad,
      maxConcurrentTickets: profile.maxConcurrentTickets,
    };
  }

  // §4.3 — consultative only (D6): never assigns anything, a 200 with an empty array is a valid,
  // non-exceptional outcome (step 8).
  async suggestForTicket(
    ticketId: string,
    limit: number,
  ): Promise<TechnicianSuggestionDto[]> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
      relations: { category: true },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const requiredSkillId = ticket.category?.requiredSkillId ?? null;

    // Root alias is `user`: TypeORM's `SelectQueryBuilder` auto-adds `user.deletedAt IS NULL`
    // for the MAIN alias of an entity carrying a `@DeleteDateColumn` (unless `.withDeleted()` is
    // called, which it never is here) — same convention documented in
    // `TicketsService.list`/`TechniciansService.list`.
    const qb = this.userRepository
      .createQueryBuilder('user')
      .innerJoin(TechnicianProfile, 'profile', 'profile.userId = user.id')
      .where('user.role = :role', { role: UserRole.TECHNICIAN })
      .andWhere('user.isActive = :isActive', { isActive: true })
      .andWhere('profile.isAvailable = :isAvailable', { isAvailable: true })
      // Step 3 — AT_CAPACITY exclusion (D3), computed with the exact same subquery text
      // `currentLoad` is selected with below, so the two can never disagree with each other.
      .andWhere(`${CURRENT_LOAD_SELECT_SQL} < profile.maxConcurrentTickets`);

    // Step 4 — never suggest the technician already assigned to this ticket.
    if (ticket.assigneeId) {
      qb.andWhere('user.id != :excludedAssigneeId', {
        excludedAssigneeId: ticket.assigneeId,
      });
    }

    qb.select('user.id', 'userId')
      .addSelect('user.username', 'username')
      .addSelect('user.firstName', 'firstName')
      .addSelect('user.lastName', 'lastName')
      .addSelect('profile.maxConcurrentTickets', 'maxConcurrentTickets')
      .addSelect(CURRENT_LOAD_SELECT_SQL, 'currentLoad');

    // Step 5 — skill filter, only when the category actually requires one.
    if (requiredSkillId) {
      qb.innerJoin(
        TechnicianSkill,
        'ts',
        'ts.technicianProfileId = profile.id AND ts.skillId = :requiredSkillId',
        { requiredSkillId },
      );
      qb.addSelect('ts.level', 'skillLevel');
    } else {
      qb.addSelect('CAST(NULL AS smallint)', 'skillLevel');
    }

    // Step 6 — deterministic order. `username ASC` is NOT decorative: without it, two
    // technicians tied on `skillLevel`/`currentLoad` would come back in whatever order
    // PostgreSQL's query planner happens to produce, which is not guaranteed stable across runs
    // — see `technician-suggestion.service.spec.ts`'s dedicated tie-break test. Quoted aliases
    // (`"skillLevel"`, `"currentLoad"`) match exactly how TypeORM quotes the `addSelect` aliases
    // above, so `ORDER BY` resolves to the same computed columns, not a (nonexistent) table
    // column of that name.
    qb.orderBy('"skillLevel"', 'DESC', 'NULLS LAST')
      .addOrderBy('"currentLoad"', 'ASC')
      .addOrderBy('user.username', 'ASC')
      .limit(limit);

    const rows = await qb.getRawMany<TechnicianSuggestionRawRow>();

    return rows.map((row) => TechnicianSuggestionDto.fromRaw(row));
  }
}
