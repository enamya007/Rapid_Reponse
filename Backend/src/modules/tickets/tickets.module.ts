import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../categories/entities/category.entity';
import { SlaPolicy } from '../sla/entities/sla-policy.entity';
import { TechniciansModule } from '../technicians/technicians.module';
import { TicketAssignment } from './entities/ticket-assignment.entity';
import { Ticket } from './entities/ticket.entity';
import { TicketStatusHistory } from './entities/ticket-status-history.entity';
import { OwnershipGuard } from './guards/ownership.guard';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

// T5.3 (`docs/plan-P5-contracts.md` §6) adds `TechniciansModule` to consume
// `TechnicianSuggestionService` (eligibility §4.1 + suggestion §4.3, exported by that module —
// see its own doc comment) for `POST /tickets/:id/assign` and
// `GET /tickets/:id/assignment-suggestions`. No cycle: `TechniciansModule` only imports
// `UsersModule`, never `TicketsModule`. `TicketAssignment` (the `ticket_assignments` history
// table) is registered here, not in `TechniciansModule`, since only this module writes/reads it.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ticket,
      Category,
      SlaPolicy,
      TicketStatusHistory,
      TicketAssignment,
    ]),
    TechniciansModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService, OwnershipGuard],
  exports: [TicketsService],
})
export class TicketsModule {}
