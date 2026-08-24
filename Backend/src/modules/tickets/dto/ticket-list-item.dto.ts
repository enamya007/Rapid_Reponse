import { ApiProperty } from '@nestjs/swagger';
import { Ticket } from '../entities/ticket.entity';
import { TicketPriority } from '../enums/ticket-priority.enum';
import { TicketStatus } from '../enums/ticket-status.enum';

// Nested `{ id, name }` projection of `Category`, embedded in `TicketListItemDto` only —
// mirrors `TicketCategorySummaryDto` in `ticket-response.dto.ts` but kept private to this
// file: the P4 contract (`docs/plan-P4-contracts.md` §5) does not list a shared category DTO.
class TicketListCategorySummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

// Nested `{ id, username }` projection of the assignee, deliberately narrower than
// `UserSummaryDto` (used by `TicketResponseDto`): the list view has no need for
// firstName/lastName.
class TicketListAssigneeSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;
}

// Lightweight response DTO for `GET /tickets` (P4 contract §5). Deliberately narrower than
// `TicketResponseDto`: no `description`, no `createdBy`, no lifecycle timestamps beyond
// `slaDueAt`/`createdAt`. Like every response DTO in this codebase, never serializes the raw
// entity and never leaks `password` (via `assignee`) nor `deletedAt`.
export class TicketListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  reference: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: TicketStatus, enumName: 'TicketStatus' })
  status: TicketStatus;

  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority' })
  priority: TicketPriority;

  @ApiProperty({ type: TicketListCategorySummaryDto })
  category: TicketListCategorySummaryDto;

  @ApiProperty({ type: TicketListAssigneeSummaryDto, nullable: true })
  assignee: TicketListAssigneeSummaryDto | null;

  @ApiProperty({ nullable: true, type: Date })
  slaDueAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  // Requires `ticket.category` and (when set) `ticket.assignee` to already be loaded
  // relations — `TicketsService.list` is responsible for that via its query builder joins,
  // this method never triggers a lazy load itself.
  static fromEntity(ticket: Ticket): TicketListItemDto {
    const dto = new TicketListItemDto();
    dto.id = ticket.id;
    dto.reference = ticket.reference;
    dto.title = ticket.title;
    dto.status = ticket.status;
    dto.priority = ticket.priority;
    dto.category = {
      id: ticket.category.id,
      name: ticket.category.name,
    };
    dto.assignee = ticket.assignee
      ? { id: ticket.assignee.id, username: ticket.assignee.username }
      : null;
    dto.slaDueAt = ticket.slaDueAt;
    dto.createdAt = ticket.createdAt;
    return dto;
  }
}
