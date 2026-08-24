import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/enums/user-role.enum';
import { Ticket } from '../entities/ticket.entity';

interface RequestWithUserAndTicket {
  params: { id?: string };
  user?: User;
  ticket?: Ticket;
}

// Coarse-grained HTTP guard: "can this user see this ticket at all" (P4 contract §3),
// applied to every route carrying a `:id` ticket param. Deliberately distinct from the P3
// transition evaluator's fine-grained guards ("can this user perform THIS transition"),
// which stay in `state/ticket-status.evaluator.ts` and are invoked by the service layer, not
// here.
//
// Loads only a bare `Ticket` (no relations): most of the routes this guard will end up
// protecting (DELETE, the /start /resolve /reopen /close /cancel transitions...) need
// nothing more than `createdById`/`assigneeId` to authorize the request, and don't want the
// extra joins. Handlers that need the fully-hydrated ticket (e.g. `GET /tickets/:id`) reload
// it themselves via `TicketsService.getById`, which is the single place that knows which
// relations a `TicketResponseDto` needs.
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithUserAndTicket>();
    const ticketId = request.params.id;
    const user = request.user;

    if (!ticketId) {
      throw new NotFoundException('Ticket not found');
    }
    // Must run after `JwtAuthGuard` (via `@Auth()`), which is responsible for populating
    // `request.user`. A missing user here means the guard ordering was broken upstream.
    if (!user) {
      throw new ForbiddenException('Insufficient permissions');
    }

    // `findOneBy` implicitly excludes soft-deleted rows (TypeORM's default behaviour for
    // entities carrying a `@DeleteDateColumn`), matching the "non supprimé" requirement.
    const ticket = await this.ticketRepository.findOneBy({ id: ticketId });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const isAdmin = user.role === UserRole.ADMIN;
    const isOwner = ticket.createdById === user.id;
    const isAssignee = ticket.assigneeId === user.id;

    if (!isAdmin && !isOwner && !isAssignee) {
      throw new ForbiddenException('Insufficient permissions');
    }

    request.ticket = ticket;
    return true;
  }
}
