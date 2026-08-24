import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketComment } from '../tickets/entities/ticket-comment.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { OwnershipGuard } from '../tickets/guards/ownership.guard';
import { TicketCommentsController } from './ticket-comments.controller';
import { TicketCommentsService } from './ticket-comments.service';

// D1/D6 (`docs/plan-P4-contracts.md` §4, "Décisions complémentaires figées pour T4.5 / T4.6"):
// lives in its own module, symmetrical with `src/modules/attachments/` (T4.6) — `TicketsModule`
// (`tickets.module.ts`, `tickets.controller.ts`, `tickets.service.ts`) stays untouched.
// `Ticket` is registered here too (alongside `TicketComment`), and NOT exported from
// `TicketsModule` today, so it must be re-registered via `forFeature` in this module — D6
// explicitly allows the same entity to be registered from multiple modules.
//
// `OwnershipGuard` is listed in `providers` even though NestJS would auto-register it for us:
// a class passed to `@UseGuards()` gets scoped to the controller's own module, and `Ticket`
// being in the `forFeature` array above already satisfies its `@InjectRepository(Ticket)`.
// Declaring it anyway matches `TicketsModule` and `AttachmentsModule`, and keeps the wiring off
// an internal scanner behaviour that carries no compatibility promise.
@Module({
  imports: [TypeOrmModule.forFeature([TicketComment, Ticket])],
  controllers: [TicketCommentsController],
  providers: [TicketCommentsService, OwnershipGuard],
})
export class TicketCommentsModule {}
