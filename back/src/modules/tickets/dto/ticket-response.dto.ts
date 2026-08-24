import { ApiProperty } from '@nestjs/swagger';
import { Ticket } from '../entities/ticket.entity';
import { TicketPriority } from '../enums/ticket-priority.enum';
import { TicketStatus } from '../enums/ticket-status.enum';
import { UserSummaryDto } from './user-summary.dto';

// Nested `{ id, name }` projection of `Category`, embedded in `TicketResponseDto` only. Not a
// standalone file: the P4 contract (`docs/plan-P4-contracts.md` §5) does not list a dedicated
// category DTO, only this inline shape.
class TicketCategorySummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

// Manual response DTO with `fromEntity`, following the project-wide convention (see
// `UserResponseDto`): never serializes the raw `Ticket` entity, never leaks `password`
// (via `createdBy`/`assignee`) nor `deletedAt`.
export class TicketResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  reference: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: TicketStatus, enumName: 'TicketStatus' })
  status: TicketStatus;

  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority' })
  priority: TicketPriority;

  @ApiProperty({ type: TicketCategorySummaryDto })
  category: TicketCategorySummaryDto;

  @ApiProperty({ type: UserSummaryDto })
  createdBy: UserSummaryDto;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  assignee: UserSummaryDto | null;

  @ApiProperty({ nullable: true, type: String })
  siteLabel: string | null;

  @ApiProperty({ nullable: true, type: String })
  siteAddress: string | null;

  @ApiProperty({ nullable: true, type: Date })
  slaDueAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  assignedAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  startedAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  resolvedAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  closedAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  cancelledAt: Date | null;

  @ApiProperty({ nullable: true, type: String })
  resolutionNote: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  // Requires `ticket.category` and `ticket.createdBy` (and `ticket.assignee` when set) to
  // already be loaded relations — `TicketsService.getById`/`create` are responsible for that,
  // this method never triggers a lazy load itself.
  static fromEntity(ticket: Ticket): TicketResponseDto {
    const dto = new TicketResponseDto();
    dto.id = ticket.id;
    dto.reference = ticket.reference;
    dto.title = ticket.title;
    dto.description = ticket.description;
    dto.status = ticket.status;
    dto.priority = ticket.priority;
    dto.category = {
      id: ticket.category.id,
      name: ticket.category.name,
    };
    dto.createdBy = UserSummaryDto.fromEntity(ticket.createdBy);
    dto.assignee = ticket.assignee
      ? UserSummaryDto.fromEntity(ticket.assignee)
      : null;
    dto.siteLabel = ticket.siteLabel;
    dto.siteAddress = ticket.siteAddress;
    dto.slaDueAt = ticket.slaDueAt;
    dto.assignedAt = ticket.assignedAt;
    dto.startedAt = ticket.startedAt;
    dto.resolvedAt = ticket.resolvedAt;
    dto.closedAt = ticket.closedAt;
    dto.cancelledAt = ticket.cancelledAt;
    dto.resolutionNote = ticket.resolutionNote;
    dto.createdAt = ticket.createdAt;
    dto.updatedAt = ticket.updatedAt;
    return dto;
  }
}
