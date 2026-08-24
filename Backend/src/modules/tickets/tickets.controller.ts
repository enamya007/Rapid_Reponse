import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  PaginatedResponseDto,
} from '../../common/dto/paginated-response.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TechnicianSuggestionDto } from '../technicians/dto/technician-suggestion.dto';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ReasonDto } from './dto/reason.dto';
import { ResolveTicketDto } from './dto/resolve-ticket.dto';
import { SuggestionQueryDto } from './dto/suggestion-query.dto';
import { TicketAssignmentResponseDto } from './dto/ticket-assignment-response.dto';
import { TicketListItemDto } from './dto/ticket-list-item.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { OwnershipGuard } from './guards/ownership.guard';
import { TicketsService } from './tickets.service';

// P5 contract §5 (`docs/plan-P5-contracts.md`): the default applied when
// `SuggestionQueryDto.limit` is omitted from the query string.
const DEFAULT_SUGGESTION_LIMIT = 10;

// Shared Swagger description for the 403 every transition route can return: the P3 evaluator
// (`evaluateTicketTransition`) rejected the event for the caller's role/ownership/assignment
// given the ticket's CURRENT status (`GUARD_FAILED`) — distinct from `OwnershipGuard`'s own 403
// ("can't see this ticket at all").
const TRANSITION_FORBIDDEN_DESCRIPTION =
  'OwnershipGuard rejected the caller (not owner/assignee/admin), or the P3 evaluator rejected the request for the caller role/ownership/assignment given the current status (GUARD_FAILED)';
// Shared Swagger description for the 409 every transition route can return.
const TRANSITION_CONFLICT_DESCRIPTION =
  'The requested event is not a valid transition from the current status (INVALID_TRANSITION)';

@ApiTags('tickets')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  @Auth(UserRole.CLIENT, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new ticket' })
  @ApiCreatedResponse({ type: TicketResponseDto })
  @ApiNotFoundResponse({ description: 'Category not found (or inactive)' })
  async create(
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: User,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsService.create(dto, user);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Get()
  @Auth()
  @ApiOperation({
    summary:
      "List tickets, paginated and filtered, scoped by the caller's role",
  })
  @ApiPaginatedResponse(TicketListItemDto)
  async list(
    @Query() query: TicketQueryDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResponseDto<TicketListItemDto>> {
    // No `OwnershipGuard` here: unlike the single-ticket routes, visibility for a list is not
    // "can the caller see this one resource" but "which subset of ALL tickets may the caller
    // see" — a row-level concern the service's role-based scoping (`TicketsService.list`)
    // already enforces, so a per-ticket guard would be redundant (and couldn't run before a
    // ticket even exists in the query result).
    return this.ticketsService.list(query, user);
  }

  @Get(':id')
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before
  // `OwnershipGuard` is appended to it — giving the final execution order
  // `[JwtAuthGuard, RolesGuard, OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which
  // only exists once `JwtAuthGuard` has run; swapping this order would make it always throw.
  // (Verified empirically against Nest's `extendArrayMetadata`/`applyDecorators` semantics —
  // do not reorder without re-checking.)
  @UseGuards(OwnershipGuard)
  @Auth()
  @ApiOperation({ summary: 'Get a single ticket by id' })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiForbiddenResponse({
    description: 'Not the owner, the assignee, nor an admin',
  })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketResponseDto> {
    // Reloaded here (with relations) rather than reusing `request.ticket` attached by
    // `OwnershipGuard`: the guard intentionally only loads a bare `Ticket` (see its own
    // doc comment), so this handler still needs `TicketsService.getById` to get
    // `category`/`createdBy`/`assignee` for `TicketResponseDto.fromEntity`.
    const ticket = await this.ticketsService.getById(id);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Patch(':id')
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before
  // `OwnershipGuard` is appended to it — giving the final execution order
  // `[JwtAuthGuard, RolesGuard, OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which
  // only exists once `JwtAuthGuard` has run; swapping this order would make it always throw.
  // (Verified empirically against Nest's `extendArrayMetadata`/`applyDecorators` semantics —
  // do not reorder without re-checking.)
  @UseGuards(OwnershipGuard)
  @Auth()
  @ApiOperation({
    summary:
      'Update mutable fields of a ticket (role x status rules enforced by the service)',
  })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiBadRequestResponse({ description: 'No field provided to update' })
  @ApiForbiddenResponse({
    description:
      'Not an admin, not the owning CLIENT with the ticket still OPEN (nor the owner at all), or a TECHNICIAN',
  })
  @ApiNotFoundResponse({
    description:
      'Ticket not found, or the given categoryId is unknown/inactive',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: User,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsService.update(id, dto, user);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Delete(':id')
  // ADMIN-only via `@Auth(ADMIN)`: no `OwnershipGuard` here on purpose. An admin already
  // passes ownership for every ticket, so stacking the guard would only add a redundant SELECT
  // before the service's own existence check; the service still throws `NotFoundException`
  // when the id doesn't resolve to a (non-deleted) ticket.
  @Auth(UserRole.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft delete a ticket (ADMIN only)' })
  @ApiNoContentResponse({ description: 'Ticket soft deleted' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.ticketsService.softDelete(id);
  }

  // T4.4 — status transitions (P4 contract §4). `ASSIGN` is deliberately absent (-> P5). Every
  // route here consumes the P3 evaluator (`evaluateTicketTransition`, called from
  // `TicketsService`'s private `applyTransition`) — no transition rule is duplicated in this
  // controller.

  @Post(':id/start')
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before
  // `OwnershipGuard` is appended to it — giving the final execution order
  // `[JwtAuthGuard, RolesGuard, OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which
  // only exists once `JwtAuthGuard` has run; swapping this order would make it always throw.
  // (Verified empirically against Nest's `extendArrayMetadata`/`applyDecorators` semantics —
  // do not reorder without re-checking.)
  @UseGuards(OwnershipGuard)
  @Auth()
  // `@Post` defaults to 201 Created in Nest; the P4 contract requires 200 for every transition
  // route (it updates an existing resource, it does not create one).
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start work on an assigned ticket (START)' })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiForbiddenResponse({ description: TRANSITION_FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiConflictResponse({ description: TRANSITION_CONFLICT_DESCRIPTION })
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsService.start(id, user);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Post(':id/resolve')
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before
  // `OwnershipGuard` is appended to it — giving the final execution order
  // `[JwtAuthGuard, RolesGuard, OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which
  // only exists once `JwtAuthGuard` has run; swapping this order would make it always throw.
  // (Verified empirically against Nest's `extendArrayMetadata`/`applyDecorators` semantics —
  // do not reorder without re-checking.)
  @UseGuards(OwnershipGuard)
  @Auth()
  // `@Post` defaults to 201 Created in Nest; the P4 contract requires 200 for every transition
  // route (it updates an existing resource, it does not create one).
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve an in-progress ticket (RESOLVE)' })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiBadRequestResponse({ description: 'resolutionNote missing or invalid' })
  @ApiForbiddenResponse({ description: TRANSITION_FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiConflictResponse({ description: TRANSITION_CONFLICT_DESCRIPTION })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveTicketDto,
    @CurrentUser() user: User,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsService.resolve(id, dto, user);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Post(':id/reopen')
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before
  // `OwnershipGuard` is appended to it — giving the final execution order
  // `[JwtAuthGuard, RolesGuard, OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which
  // only exists once `JwtAuthGuard` has run; swapping this order would make it always throw.
  // (Verified empirically against Nest's `extendArrayMetadata`/`applyDecorators` semantics —
  // do not reorder without re-checking.)
  @UseGuards(OwnershipGuard)
  @Auth()
  // `@Post` defaults to 201 Created in Nest; the P4 contract requires 200 for every transition
  // route (it updates an existing resource, it does not create one).
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a resolved ticket (REOPEN)' })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiBadRequestResponse({ description: 'reason invalid, if supplied' })
  @ApiForbiddenResponse({ description: TRANSITION_FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiConflictResponse({ description: TRANSITION_CONFLICT_DESCRIPTION })
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: User,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsService.reopen(id, dto, user);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Post(':id/close')
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before
  // `OwnershipGuard` is appended to it — giving the final execution order
  // `[JwtAuthGuard, RolesGuard, OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which
  // only exists once `JwtAuthGuard` has run; swapping this order would make it always throw.
  // (Verified empirically against Nest's `extendArrayMetadata`/`applyDecorators` semantics —
  // do not reorder without re-checking.)
  @UseGuards(OwnershipGuard)
  @Auth()
  // `@Post` defaults to 201 Created in Nest; the P4 contract requires 200 for every transition
  // route (it updates an existing resource, it does not create one).
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a resolved ticket (CLOSE)' })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiForbiddenResponse({ description: TRANSITION_FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiConflictResponse({ description: TRANSITION_CONFLICT_DESCRIPTION })
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsService.close(id, user);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Post(':id/cancel')
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before
  // `OwnershipGuard` is appended to it — giving the final execution order
  // `[JwtAuthGuard, RolesGuard, OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which
  // only exists once `JwtAuthGuard` has run; swapping this order would make it always throw.
  // (Verified empirically against Nest's `extendArrayMetadata`/`applyDecorators` semantics —
  // do not reorder without re-checking.)
  @UseGuards(OwnershipGuard)
  @Auth()
  // `@Post` defaults to 201 Created in Nest; the P4 contract requires 200 for every transition
  // route (it updates an existing resource, it does not create one).
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a ticket (CANCEL)' })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiBadRequestResponse({ description: 'reason invalid, if supplied' })
  @ApiForbiddenResponse({ description: TRANSITION_FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiConflictResponse({ description: TRANSITION_CONFLICT_DESCRIPTION })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: User,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsService.cancel(id, dto, user);
    return TicketResponseDto.fromEntity(ticket);
  }

  // T5.3 — affectation (P5 contract §3/§4.2-4.4, `docs/plan-P5-contracts.md`). All three routes
  // below consume `TicketsService`'s new methods, which themselves consume T5.1b's
  // `TechnicianSuggestionService` for eligibility/suggestion — no rule is duplicated here.

  @Get(':id/assignment-suggestions')
  // ADMIN-only via `@Auth(ADMIN)`: no `OwnershipGuard` here, same reasoning as `DELETE
  // /tickets/:id` above — an ADMIN already passes ownership for every ticket, so stacking the
  // guard would only add a redundant SELECT before the service's own existence check (via
  // `TechnicianSuggestionService.suggestForTicket`, which still throws `NotFoundException` when
  // the id doesn't resolve to a ticket).
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Suggest eligible technicians for a ticket, ranked deterministically (consultative only, D6 — never assigns anything)',
  })
  @ApiOkResponse({ type: TechnicianSuggestionDto, isArray: true })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  async getAssignmentSuggestions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SuggestionQueryDto,
  ): Promise<TechnicianSuggestionDto[]> {
    return this.ticketsService.getAssignmentSuggestions(
      id,
      query.limit ?? DEFAULT_SUGGESTION_LIMIT,
    );
  }

  @Post(':id/assign')
  // ADMIN-only via `@Auth(ADMIN)`: no `OwnershipGuard` here, same reasoning as `DELETE
  // /tickets/:id` and the suggestions route above.
  @Auth(UserRole.ADMIN)
  // `@Post` defaults to 201 Created in Nest; like every other transition route (T4.4), ASSIGN
  // updates an existing resource rather than creating one, so the contract requires 200.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Assign or reassign a ticket to a technician (ADMIN only, ASSIGN — reassigning an already ASSIGNED ticket requires a reason, enforced by the P3 guard)',
  })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiBadRequestResponse({
    description:
      "technicianId is invalid, or (D5) equals the ticket's current assignee",
  })
  @ApiForbiddenResponse({
    description:
      'Caller is not an ADMIN, the target technician is not eligible for assignment (D1), or the P3 evaluator rejected the request (GUARD_FAILED — e.g. a reassignment with no reason)',
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiConflictResponse({ description: TRANSITION_CONFLICT_DESCRIPTION })
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() user: User,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsService.assign(id, dto, user);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Get(':id/assignments')
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before
  // `OwnershipGuard` is appended to it — giving the final execution order
  // `[JwtAuthGuard, RolesGuard, OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which
  // only exists once `JwtAuthGuard` has run; swapping this order would make it always throw.
  // (Verified empirically against Nest's `extendArrayMetadata`/`applyDecorators` semantics —
  // do not reorder without re-checking.)
  @UseGuards(OwnershipGuard)
  @Auth()
  @ApiOperation({
    summary: "Get a ticket's full assignment history, most recent first (§4.4)",
  })
  @ApiOkResponse({ type: TicketAssignmentResponseDto, isArray: true })
  @ApiForbiddenResponse({
    description: 'Not the owner, the assignee, nor an admin',
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  async getAssignmentHistory(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketAssignmentResponseDto[]> {
    const assignments = await this.ticketsService.getAssignmentHistory(id);
    return assignments.map((assignment) =>
      TicketAssignmentResponseDto.fromEntity(assignment),
    );
  }
}
