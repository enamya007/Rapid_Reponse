import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { Ticket } from '../tickets/entities/ticket.entity';
import { OwnershipGuard } from '../tickets/guards/ownership.guard';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { Attachment } from './entities/attachment.entity';

// P4 contract D6: `Attachment` AND `Ticket` are both registered via `forFeature` HERE (not in
// `TicketsModule`, which stays untouched — D1/D6). `Ticket` is required because `OwnershipGuard`
// (imported straight from `tickets/guards/`, not redefined) injects `@InjectRepository(Ticket)`;
// TypeORM repository providers only resolve within a module that itself calls `forFeature` for
// that entity (or imports another module that exports it), so reusing the guard here means this
// module must provide that repository itself.
//
// `StorageModule` is imported explicitly: it is NOT `@Global()` (see its own doc comment) and is
// not wired into `app.module.ts` yet either (P4 contract D7 — orchestrator-only, T4.0-bis).
@Module({
  imports: [TypeOrmModule.forFeature([Attachment, Ticket]), StorageModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, OwnershipGuard],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
