import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IsNull, Repository } from 'typeorm';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  buildPaginatedResponse,
  toTypeOrmSkipTake,
} from '../../common/utils/pagination.util';
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
import { evaluateTicketTransition } from './state';
import type { TicketEvent, TransitionContext } from './state';

const MINUTE_IN_MS = 60_000;

// Whitespace-only strings don't count as "provided" for `TransitionContext.hasResolutionNote`/
// `hasReason` (P4 contract §4): both DTOs already enforce a non-empty length via
// `class-validator`, but this keeps `applyTransition` correct even for the optional `reason?`
// field, which may legitimately be `undefined`.
function isNonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

// Escapes ILIKE metacharacters (`%`, `_`) plus the escape character itself (`\`) in a raw
// search term BEFORE it is wrapped in `%...%` for `list`'s free-text `q` filter, so a literal
// `%`/`_` typed by the user is matched as text instead of being interpreted as a wildcard by
// Postgres. The backslash MUST be escaped first: escaping it after `%`/`_` would re-escape the
// escape sequences those two steps just introduced. Paired with the explicit `ESCAPE '\'`
// clause added to the SQL fragment in `list` below — Postgres already defaults to backslash as
// the escape character when no `ESCAPE` clause is given, but this keeps the pairing explicit
// rather than relying on that implicit default.
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Explicit whitelist mapping `TicketQueryDto.sort` (already validated against
// `TICKET_SORT_FIELDS` by `@IsIn`) to a real, aliased column expression. Typed as
// `Record<(typeof TICKET_SORT_FIELDS)[number], string>` — rather than `Record<string, string>`
// — specifically so this IS a real, compiler-enforced single source of truth with
// `TICKET_SORT_FIELDS`: adding a value there without adding a matching entry here fails
// `pnpm build`, instead of silently falling back to the default sort column at runtime.
// `sort`/`order` are NEVER interpolated into the query builder as raw strings: `order` is
// passed straight through because `@IsIn(['ASC','DESC'])` already constrains it to one of
// exactly two safe literals, but the column name always goes through this map first — defense
// in depth against SQL injection even if validation were ever bypassed upstream.
const SORT_COLUMNS: Record<(typeof TICKET_SORT_FIELDS)[number], string> = {
  createdAt: 'ticket.createdAt',
  priority: 'ticket.priority',
  slaDueAt: 'ticket.slaDueAt',
  status: 'ticket.status',
};
const DEFAULT_SORT_COLUMN = SORT_COLUMNS.createdAt;
const DEFAULT_SORT_ORDER = 'DESC';

// The relations required to build a full `TicketResponseDto` (P4 contract §5) are joined
// directly in `getById` below — every other read path reaches a full ticket through it, so there
// is still exactly one place where that set is declared. The `FindOptionsRelations` constant
// that used to hold them was removed with D12: expressing them as `find` relations is precisely
// what dropped a soft-deleted author. See `getById`.

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(SlaPolicy)
    private readonly slaPolicyRepository: Repository<SlaPolicy>,
    @InjectRepository(TicketAssignment)
    private readonly ticketAssignmentRepository: Repository<TicketAssignment>,
    private readonly technicianSuggestionService: TechnicianSuggestionService,
    // P6 contract §4: business events are emitted from this service directly --
    // `EventEmitterModule.forRoot()` is wired globally in `AppModule`, so `EventEmitter2` is
    // injectable here without `TicketsModule` importing anything new.
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreateTicketDto, currentUser: User): Promise<Ticket> {
    // Existence AND active-ness: an inactive category has been deliberately retired from use
    // and should not be selectable for new tickets, not just for historical/reporting
    // purposes. Both cases surface the same 404 (a client has no legitimate reason to
    // distinguish "unknown" from "retired" categoryId).
    const category = await this.categoryRepository.findOneBy({
      id: dto.categoryId,
      isActive: true,
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const priority = dto.priority ?? TicketPriority.NORMAL;

    // Reference instant used to compute `slaDueAt` below. Stands in for the ticket's
    // `created_at` (set a few milliseconds later by Postgres via `@CreateDateColumn`'s
    // default `now()`): the drift between the two is negligible for an SLA measured in
    // minutes/hours/days, and computing `slaDueAt` up front keeps `create()` a single insert
    // instead of an insert-then-reread-then-update.
    const now = new Date();
    const slaDueAt = await this.resolveSlaDueAt(priority, now);

    const ticket = this.ticketRepository.create({
      title: dto.title,
      description: dto.description,
      status: TicketStatus.OPEN,
      priority,
      categoryId: category.id,
      createdById: currentUser.id,
      siteLabel: dto.siteLabel ?? null,
      siteAddress: dto.siteAddress ?? null,
      slaDueAt,
    });
    // `reference` is never set here: it is generated exclusively by the `tickets_reference_seq`
    // Postgres sequence via the entity's column default (see `Ticket.reference`), and the
    // column is `insert: false` so TypeORM would silently ignore any value assigned anyway.

    const saved = await this.ticketRepository.save(ticket);

    // Reload with relations rather than returning `saved` as-is: `saved` only carries scalar
    // columns and FK ids, not the `category`/`createdBy` objects `TicketResponseDto.fromEntity`
    // needs.
    const reloaded = await this.getById(saved.id);

    // P6 contract §4: `ticket.created` is emitted here, after the reload, before the return.
    // This method never opens a transaction, so D1 (never emit inside one) is moot here -- it
    // matters for `assign`/`applyTransition` below. The creator is both the actor and the
    // ticket's owner; a brand-new ticket never has an assignee yet.
    this.eventEmitter.emit(TICKET_CREATED, {
      ticketId: reloaded.id,
      reference: reloaded.reference,
      title: reloaded.title,
      actorId: currentUser.id,
      createdById: reloaded.createdById,
      assigneeId: reloaded.assigneeId,
      occurredAt: new Date().toISOString(),
    } satisfies TicketCreatedEvent);

    return reloaded;
  }

  // P6.5 D12. This method used to be `findOne({ where: { id }, relations: RESPONSE_RELATIONS })`
  // and answered **500 on every ticket whose author had been soft-deleted** — a state no route
  // could produce before `DELETE /users/:id` existed, which is why it went unnoticed until P6.5.
  //
  // The mechanism, verified against the SQL TypeORM actually emits rather than assumed: the
  // `deletedAt IS NULL` guard is pushed into the JOIN CONDITION of every relation whose entity
  // has a `@DeleteDateColumn` — `LEFT JOIN "users" "createdBy" ON "createdBy"."id" =
  // "ticket"."created_by_id" AND ("createdBy"."deleted_at" IS NULL)`. Switching to a query
  // builder changes nothing on its own: `leftJoinAndSelect` is filtered exactly the same way.
  // The author therefore came back `null`, and `TicketResponseDto.fromEntity` — whose
  // `createdBy` is non-nullable by contract (P4 §5) — threw.
  //
  // `withDeleted()` lifts the guard, but query-WIDE: it would also start returning soft-deleted
  // TICKETS. The explicit `ticket.deletedAt IS NULL` below puts that half back, deliberately and
  // visibly. Net effect: a deleted ticket is still a 404, while a deleted author or assignee is
  // still named on the tickets they were part of — which is what "conservation de l'historique
  // pour traçabilité" (cahier des charges §3) requires of a soft delete.
  async getById(id: string): Promise<Ticket> {
    const ticket = await this.ticketRepository
      .createQueryBuilder('ticket')
      .withDeleted()
      .leftJoinAndSelect('ticket.category', 'category')
      .leftJoinAndSelect('ticket.createdBy', 'createdBy')
      .leftJoinAndSelect('ticket.assignee', 'assignee')
      .where('ticket.id = :id', { id })
      .andWhere('ticket.deletedAt IS NULL')
      .getOne();
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  // `GET /tickets` (P4 contract §4/§5) — paginated, filtered, and, above all, scoped by role:
  // - CLIENT: forced to `createdById = currentUser.id`; any `assigneeId`/`createdById` from
  //   the query is ignored. A client can never widen the list beyond their own tickets.
  // - TECHNICIAN: forced to `assigneeId = currentUser.id`; same ignoring of the query's own
  //   `assigneeId`/`createdById`.
  // - ADMIN: no forced scope; `query.assigneeId`/`query.createdById` are honored as regular
  //   filters when supplied.
  // Soft-deleted tickets are excluded by the explicit `ticket.deletedAt IS NULL` below. It is
  // written out rather than left to TypeORM because `withDeleted()` — required so a
  // soft-deleted ASSIGNEE still resolves through the join, same mechanism as `getById` (P6.5
  // D12) — lifts that guard query-wide, joins and main alias alike. The two read paths are
  // deliberately identical on this point: a technician who left must still be named on the
  // closed tickets they handled, in the list exactly as in the detail view.
  async list(
    query: TicketQueryDto,
    currentUser: User,
  ): Promise<PaginatedResponseDto<TicketListItemDto>> {
    const qb = this.ticketRepository
      .createQueryBuilder('ticket')
      .withDeleted()
      .leftJoinAndSelect('ticket.category', 'category')
      .leftJoinAndSelect('ticket.assignee', 'assignee')
      .andWhere('ticket.deletedAt IS NULL');

    if (currentUser.role === UserRole.CLIENT) {
      qb.andWhere('ticket.createdById = :scopeOwnerId', {
        scopeOwnerId: currentUser.id,
      });
    } else if (currentUser.role === UserRole.TECHNICIAN) {
      qb.andWhere('ticket.assigneeId = :scopeAssigneeId', {
        scopeAssigneeId: currentUser.id,
      });
    } else {
      // ADMIN: the query's own filters are honored, not forced.
      if (query.assigneeId) {
        qb.andWhere('ticket.assigneeId = :assigneeId', {
          assigneeId: query.assigneeId,
        });
      }
      if (query.createdById) {
        qb.andWhere('ticket.createdById = :createdById', {
          createdById: query.createdById,
        });
      }
    }

    if (query.status) {
      qb.andWhere('ticket.status = :status', { status: query.status });
    }
    if (query.priority) {
      qb.andWhere('ticket.priority = :priority', {
        priority: query.priority,
      });
    }
    if (query.categoryId) {
      qb.andWhere('ticket.categoryId = :categoryId', {
        categoryId: query.categoryId,
      });
    }
    if (query.q) {
      // `query.q` is escaped BEFORE being wrapped in `%...%`: without this, a literal `%`/`_`
      // typed by the user would be interpreted as an ILIKE wildcard instead of matched as text
      // (e.g. a search for `100%` would otherwise match everything, via the pattern `%100%%`).
      // The `ESCAPE '\'` clause is what tells Postgres which character `escapeLikePattern`
      // used.
      qb.andWhere(
        "(ticket.title ILIKE :q ESCAPE '\\' OR ticket.reference ILIKE :q ESCAPE '\\')",
        { q: `%${escapeLikePattern(query.q)}%` },
      );
    }

    const sortColumn = query.sort
      ? (SORT_COLUMNS[query.sort as (typeof TICKET_SORT_FIELDS)[number]] ??
        DEFAULT_SORT_COLUMN)
      : DEFAULT_SORT_COLUMN;
    const order = query.order ?? DEFAULT_SORT_ORDER;
    qb.orderBy(sortColumn, order);

    const { skip, take } = toTypeOrmSkipTake(query);
    qb.skip(skip).take(take);

    const [items, total] = await qb.getManyAndCount();

    return buildPaginatedResponse(
      items.map((item) => TicketListItemDto.fromEntity(item)),
      total,
      query,
    );
  }

  // `PATCH /tickets/:id` (P4 contract §4, "Règles fines"): mutable-field update, gated by a
  // role x status rule that goes beyond `OwnershipGuard`'s coarse "can see this ticket" check.
  // - ADMIN: allowed at all times.
  // - CLIENT owner (`createdById === currentUser.id`): allowed only while `status = OPEN`.
  // - TECHNICIAN (even the assignee) and every other case: forbidden — the business fields
  //   this method touches are not what a technician's actions mutate (those go through the
  //   P3/T4.4 transition endpoints instead).
  async update(
    id: string,
    dto: UpdateTicketDto,
    currentUser: User,
  ): Promise<Ticket> {
    // `findOneBy` implicitly excludes soft-deleted rows, matching the "non supprimé"
    // requirement (same TypeORM default `OwnershipGuard` relies on).
    const ticket = await this.ticketRepository.findOneBy({ id });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    this.assertCanUpdate(ticket, currentUser);

    const hasAnyField =
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.priority !== undefined ||
      dto.categoryId !== undefined ||
      dto.siteLabel !== undefined ||
      dto.siteAddress !== undefined;
    if (!hasAnyField) {
      throw new BadRequestException(
        'At least one field must be provided to update a ticket',
      );
    }

    if (dto.categoryId !== undefined) {
      // Same "active only" rule as `create`: see its comment above.
      const category = await this.categoryRepository.findOneBy({
        id: dto.categoryId,
        isActive: true,
      });
      if (!category) {
        throw new NotFoundException('Category not found');
      }
      ticket.categoryId = category.id;
    }
    if (dto.title !== undefined) {
      ticket.title = dto.title;
    }
    if (dto.description !== undefined) {
      ticket.description = dto.description;
    }
    if (dto.siteLabel !== undefined) {
      ticket.siteLabel = dto.siteLabel;
    }
    if (dto.siteAddress !== undefined) {
      ticket.siteAddress = dto.siteAddress;
    }
    // Recomputed only on an actual change: re-running the same priority through
    // `resolveSlaDueAt` would silently shift `slaDueAt` forward (it's always "now + target"),
    // for no reason, and would defeat the "unchanged priority" behaviour required by the
    // contract.
    if (dto.priority !== undefined && dto.priority !== ticket.priority) {
      ticket.priority = dto.priority;
      ticket.slaDueAt = await this.resolveSlaDueAt(dto.priority, new Date());
    }
    // `status`, `reference` and the transition timestamps are never touched here: they are
    // exclusively owned by `evaluateTicketTransition` (P3), invoked from the T4.4 transition
    // endpoints, not from this generic field update.

    await this.ticketRepository.save(ticket);

    // Reloaded with relations for the response, exactly like `create`/`getById`.
    return this.getById(ticket.id);
  }

  private assertCanUpdate(ticket: Ticket, currentUser: User): void {
    if (currentUser.role === UserRole.ADMIN) {
      return;
    }
    const isOwner = ticket.createdById === currentUser.id;
    if (
      currentUser.role === UserRole.CLIENT &&
      isOwner &&
      ticket.status === TicketStatus.OPEN
    ) {
      return;
    }
    throw new ForbiddenException(
      'Insufficient permissions to update this ticket',
    );
  }

  // `DELETE /tickets/:id` (P4 contract §4): ADMIN-only soft delete (enforced by `@Auth(ADMIN)`
  // on the route, not here). Never a hard delete: `Ticket.deletedAt` is a `@DeleteDateColumn`,
  // so `Repository.softDelete` issues an `UPDATE ... SET deleted_at = now()`, not a `DELETE
  // FROM` — every read path already excludes soft-deleted rows by TypeORM's default behaviour
  // for that column type.
  async softDelete(id: string): Promise<void> {
    const ticket = await this.ticketRepository.findOneBy({ id });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    await this.ticketRepository.softDelete(id);
  }

  // T4.4 — status transitions (P4 contract §4/§5, `docs/plan-backend.md` §3). `ASSIGN` is
  // deliberately absent from this group: it is implemented below (T5.3) as the dedicated
  // `assign()` method, not through `applyTransition` — see that method's own doc comment for
  // why. Each of the five methods below is a thin wrapper handing its `TicketEvent` and
  // event-specific payload to `applyTransition`, which is the single place that talks to the P3
  // evaluator and writes the DB for THESE five events.
  async start(id: string, currentUser: User): Promise<Ticket> {
    return this.applyTransition(id, 'START', currentUser);
  }

  async resolve(
    id: string,
    dto: ResolveTicketDto,
    currentUser: User,
  ): Promise<Ticket> {
    return this.applyTransition(id, 'RESOLVE', currentUser, {
      resolutionNote: dto.resolutionNote,
    });
  }

  async reopen(id: string, dto: ReasonDto, currentUser: User): Promise<Ticket> {
    return this.applyTransition(id, 'REOPEN', currentUser, {
      reason: dto.reason,
    });
  }

  async close(id: string, currentUser: User): Promise<Ticket> {
    return this.applyTransition(id, 'CLOSE', currentUser);
  }

  async cancel(id: string, dto: ReasonDto, currentUser: User): Promise<Ticket> {
    return this.applyTransition(id, 'CANCEL', currentUser, {
      reason: dto.reason,
    });
  }

  // T5.3 — `GET /tickets/:id/assignment-suggestions` (P5 contract §4.3, D6). Pure delegation to
  // T5.1b's `TechnicianSuggestionService`: no eligibility rule, ranking rule or tie-break is
  // reimplemented here. That service itself throws `NotFoundException` when `ticketId` doesn't
  // resolve to an existing ticket — exactly the 404 this route's contract calls for — so there
  // is nothing else for this wrapper to check.
  async getAssignmentSuggestions(
    ticketId: string,
    limit: number,
  ): Promise<TechnicianSuggestionDto[]> {
    return this.technicianSuggestionService.suggestForTicket(ticketId, limit);
  }

  // T5.3 — `POST /tickets/:id/assign` (P5 contract §4.2). Deliberately a DEDICATED method
  // rather than a sixth thin wrapper feeding `applyTransition`: ASSIGN needs an extra, async
  // domain check that happens BEFORE `evaluateTicketTransition` even runs (D1/D2 — the target
  // technician's eligibility, computed by `TechnicianSuggestionService.evaluateEligibility`,
  // never reimplemented here) and writes an extra table (`ticket_assignments`) alongside the
  // ticket/history rows every transition already writes. Retrofitting `applyTransition`'s
  // shared `payload`/`switch` shape to carry `technicianId`/`isAutoSuggested` and to run an
  // async pre-check only ONE of its six events needs would complicate a method five OTHER
  // events already rely on, for no benefit. This method still reuses the exact same pattern
  // `applyTransition` does: build a `TransitionContext` from already-loaded state, delegate the
  // actual rule to `evaluateTicketTransition` (P3, never reimplemented), and perform every
  // write inside ONE `manager.transaction(...)` call so a failure anywhere rolls all of it back.
  async assign(
    id: string,
    dto: AssignTicketDto,
    currentUser: User,
  ): Promise<Ticket> {
    const ticket = await this.ticketRepository.findOneBy({ id });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    // D5: reassigning to the technician already holding the ticket is refused outright, before
    // any eligibility check or transition evaluation even runs — it would otherwise write a
    // no-op assignment/history row for a status that isn't actually changing.
    if (ticket.assigneeId === dto.technicianId) {
      throw new BadRequestException(
        'Ticket is already assigned to this technician',
      );
    }

    // D1/D2: the target's eligibility is validated HERE, before `evaluateTicketTransition`
    // runs, because the P3 guard `canReassignFromAssigned` only checks `ADMIN + hasReason` — it
    // has no notion of technician availability/capacity, and `canAssignFromOpen` trusts
    // whatever `isTargetTechnicianActiveAndAvailable` it is given. That value is `eligibility
    // .eligible` below: the REAL computed result, never hardcoded `false` (nor `true`).
    const eligibility =
      await this.technicianSuggestionService.evaluateEligibility(
        dto.technicianId,
      );
    if (!eligibility.eligible) {
      throw new ForbiddenException(
        `Target technician is not eligible for assignment (${eligibility.reason})`,
      );
    }

    const ctx: TransitionContext = {
      actorRole: currentUser.role,
      isActorOwnerClient: ticket.createdById === currentUser.id,
      isActorAssignedTechnician: ticket.assigneeId === currentUser.id,
      isTargetTechnicianActiveAndAvailable: eligibility.eligible,
      hasResolutionNote: false,
      hasReason: isNonEmpty(dto.reason),
    };

    const result = evaluateTicketTransition(ticket.status, 'ASSIGN', ctx);
    if (!result.allowed) {
      if (result.reason === 'INVALID_TRANSITION') {
        throw new ConflictException(
          `Cannot apply transition "ASSIGN" to a ticket in status "${ticket.status}"`,
        );
      }
      // GUARD_FAILED here is what enforces the mandatory reassignment `reason` (D2,
      // `canReassignFromAssigned`): never checked by hand in this method.
      throw new ForbiddenException(
        'Insufficient permissions to apply transition "ASSIGN" to this ticket',
      );
    }

    const fromStatus = ticket.status;
    const toStatus = result.nextStatus as TicketStatus;
    const now = new Date();
    const reason = dto.reason ?? null;
    // Captured BEFORE the transaction below mutates `ticket.assigneeId` in place: `null` on a
    // first assignment from OPEN, the previous technician's id on a reassignment (P6 contract
    // §4, `TicketAssignedEvent.previousAssigneeId`).
    const previousAssigneeId = ticket.assigneeId;

    await this.ticketRepository.manager.transaction(async (em) => {
      // Close the currently open assignment row, if any — a first assignment from OPEN has
      // none, a reassignment from ASSIGNED always does.
      const currentAssignment = await em.findOne(TicketAssignment, {
        where: { ticketId: ticket.id, unassignedAt: IsNull() },
      });
      if (currentAssignment) {
        currentAssignment.unassignedAt = now;
        await em.save(currentAssignment);
      }

      await em.save(
        em.create(TicketAssignment, {
          ticketId: ticket.id,
          technicianId: dto.technicianId,
          assignedById: currentUser.id,
          reason,
          isAutoSuggested: dto.isAutoSuggested ?? false,
          assignedAt: now,
          unassignedAt: null,
        }),
      );

      ticket.assigneeId = dto.technicianId;
      ticket.assignedAt = now;
      // D7: `slaDueAt` is deliberately left untouched — it is never recomputed at assignment.
      ticket.status = toStatus;
      await em.save(ticket);

      await em.save(
        em.create(TicketStatusHistory, {
          ticketId: ticket.id,
          fromStatus,
          toStatus,
          changedById: currentUser.id,
          note: reason,
        }),
      );
    });

    // Reloaded with relations for the response, exactly like every other transition method.
    const reloaded = await this.getById(ticket.id);

    // P6 contract §4/D1: emitted strictly AFTER `manager.transaction(...)` above has returned
    // (i.e. committed) and after the reload, never from inside the callback -- a listener that
    // reads the ticket here must see the write, and a rollback must never already have been
    // notified. `assign()` emits `ticket.assigned` ONLY: the `ticket_status_history` row it
    // also writes above never additionally raises `ticket.status-changed`, or a single
    // assignment would notify twice (contract §4, "Une affectation produit ticket.assigned
    // uniquement").
    this.eventEmitter.emit(TICKET_ASSIGNED, {
      ticketId: reloaded.id,
      reference: reloaded.reference,
      title: reloaded.title,
      actorId: currentUser.id,
      createdById: reloaded.createdById,
      assigneeId: reloaded.assigneeId,
      occurredAt: new Date().toISOString(),
      previousAssigneeId,
    } satisfies TicketAssignedEvent);

    return reloaded;
  }

  // T5.3 — `GET /tickets/:id/assignments` (P5 contract §4.4). Route-level access is
  // `OwnershipGuard` (owner/assignee/admin), which already re-confirms the ticket exists; this
  // method still checks again itself, exactly like `getById`/`update`/`softDelete` all do,
  // rather than trusting the guard's own separate load.
  async getAssignmentHistory(ticketId: string): Promise<TicketAssignment[]> {
    const ticket = await this.ticketRepository.findOneBy({ id: ticketId });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return this.ticketAssignmentRepository.find({
      where: { ticketId },
      relations: { technician: true, assignedBy: true },
      order: { assignedAt: 'DESC' },
    });
  }

  // Single entry point for every status transition EXCEPT `ASSIGN` (P4 contract §4,
  // "Transitions"; `ASSIGN` is T5.3's dedicated `assign()` method above):
  //   1. Load the (non-deleted) ticket, 404 if missing.
  //   2. Build the `TransitionContext` straight from the ticket/actor state already loaded —
  //      never from anything the caller asserts about themselves.
  //   3. Delegate the actual rule ("is this transition even allowed") to
  //      `evaluateTicketTransition` (P3). NO transition rule is re-implemented here.
  //   4. On success, update `status` + the ONE dedicated timestamp for this event, insert the
  //      matching `ticket_status_history` row, and persist both in a single transaction — if
  //      either write fails, both are rolled back.
  // `isTargetTechnicianActiveAndAvailable` is hardcoded `false`: it only matters for `ASSIGN`,
  // which this method never evaluates (no caller here ever passes it — `assign()` calls
  // `evaluateTicketTransition` directly with the real computed value instead).
  private async applyTransition(
    id: string,
    event: TicketEvent,
    currentUser: User,
    payload: { resolutionNote?: string; reason?: string } = {},
  ): Promise<Ticket> {
    const ticket = await this.ticketRepository.findOneBy({ id });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const ctx: TransitionContext = {
      actorRole: currentUser.role,
      isActorOwnerClient: ticket.createdById === currentUser.id,
      isActorAssignedTechnician: ticket.assigneeId === currentUser.id,
      isTargetTechnicianActiveAndAvailable: false,
      hasResolutionNote:
        event === 'RESOLVE' && isNonEmpty(payload.resolutionNote),
      hasReason: isNonEmpty(payload.reason),
    };

    const result = evaluateTicketTransition(ticket.status, event, ctx);
    if (!result.allowed) {
      if (result.reason === 'INVALID_TRANSITION') {
        throw new ConflictException(
          `Cannot apply transition "${event}" to a ticket in status "${ticket.status}"`,
        );
      }
      throw new ForbiddenException(
        `Insufficient permissions to apply transition "${event}" to this ticket`,
      );
    }

    const fromStatus = ticket.status;
    const toStatus = result.nextStatus as TicketStatus;
    const now = new Date();
    let historyNote: string | null = null;

    switch (event) {
      case 'ASSIGN':
        // Unreachable in practice (no caller ever passes `ASSIGN` here, see the method's doc
        // comment) but kept explicit rather than falling through, so `noFallthroughCasesInSwitch`
        // and an exhaustive review both make the P5 boundary obvious.
        break;
      case 'START':
        ticket.startedAt = now;
        break;
      case 'RESOLVE':
        ticket.resolvedAt = now;
        ticket.resolutionNote = payload.resolutionNote ?? null;
        historyNote = payload.resolutionNote ?? null;
        break;
      case 'REOPEN':
        // The previous resolution is void once a ticket is reopened: both the timestamp and
        // the note it carried are cleared on the ticket row. The reason for reopening is not
        // lost, though — it is what `historyNote` traces on the `ticket_status_history` row.
        ticket.resolvedAt = null;
        ticket.resolutionNote = null;
        historyNote = payload.reason ?? null;
        break;
      case 'CLOSE':
        ticket.closedAt = now;
        break;
      case 'CANCEL':
        ticket.cancelledAt = now;
        historyNote = payload.reason ?? null;
        break;
    }
    ticket.status = toStatus;

    await this.ticketRepository.manager.transaction(async (em) => {
      await em.save(ticket);
      await em.save(
        em.create(TicketStatusHistory, {
          ticketId: ticket.id,
          fromStatus,
          toStatus,
          changedById: currentUser.id,
          note: historyNote,
        }),
      );
    });

    // Reloaded with relations for the response, exactly like `create`/`update`/`getById`.
    const reloaded = await this.getById(ticket.id);

    // P6 contract §4/D1: emitted strictly AFTER `manager.transaction(...)` above has returned
    // and after the reload -- identical rationale to `assign()` above. `fromStatus`/`toStatus`
    // are both taken from state captured around this write: `evaluateTicketTransition` itself
    // only returns the destination status, never the origin one.
    this.eventEmitter.emit(TICKET_STATUS_CHANGED, {
      ticketId: reloaded.id,
      reference: reloaded.reference,
      title: reloaded.title,
      actorId: currentUser.id,
      createdById: reloaded.createdById,
      assigneeId: reloaded.assigneeId,
      occurredAt: new Date().toISOString(),
      fromStatus,
      toStatus,
    } satisfies TicketStatusChangedEvent);

    return reloaded;
  }

  // A missing SLA policy for the given priority is logged as a warning, not a blocking
  // error: a ticket must still be creatable even if SLA reference data hasn't been seeded
  // yet for every priority (P4 contract §6).
  private async resolveSlaDueAt(
    priority: TicketPriority,
    now: Date,
  ): Promise<Date | null> {
    const policy = await this.slaPolicyRepository.findOneBy({ priority });
    if (!policy) {
      this.logger.warn(
        `No SLA policy configured for priority "${priority}"; slaDueAt will be null`,
      );
      return null;
    }
    return new Date(
      now.getTime() + policy.resolutionTargetMinutes * MINUTE_IN_MS,
    );
  }
}
