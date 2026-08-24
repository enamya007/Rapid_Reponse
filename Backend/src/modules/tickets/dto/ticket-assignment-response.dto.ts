import { ApiProperty } from '@nestjs/swagger';
import { TicketAssignment } from '../entities/ticket-assignment.entity';

// Nested `{ id, username }` projection of a `User` (technician/assigner), embedded ONLY in
// `TicketAssignmentResponseDto` below. Deliberately narrower than `UserSummaryDto`
// (`ticket-response.dto.ts`'s own nested actor shape): the P5 contract §5
// (`docs/plan-P5-contracts.md`) fixes this DTO's shape to exactly `{ id, username }`, no
// `firstName`/`lastName`.
class AssignmentActorSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;
}

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée: `{ id, technician { id, username },
// assignedBy { id, username } | null, reason, isAutoSuggested, assignedAt, unassignedAt }`.
// Manual DTO with `static fromEntity`, following the project-wide convention (see
// `TicketResponseDto`): never serializes the raw `TicketAssignment` entity, never leaks the raw
// `ticketId`/`technicianId`/`assignedById` foreign keys.
export class TicketAssignmentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: AssignmentActorSummaryDto })
  technician: AssignmentActorSummaryDto;

  // `null` when `assignedById` is `null` — either because the assigning admin's account was
  // later deleted (`assignedBy` is `onDelete: 'SET NULL'`, see the entity), never because this
  // DTO omits the field.
  @ApiProperty({ type: AssignmentActorSummaryDto, nullable: true })
  assignedBy: AssignmentActorSummaryDto | null;

  @ApiProperty({ type: String, nullable: true })
  reason: string | null;

  @ApiProperty()
  isAutoSuggested: boolean;

  @ApiProperty()
  assignedAt: Date;

  // `null` while this row is the CURRENT assignment (§4.4); set the moment a later assignment
  // supersedes it.
  @ApiProperty({ type: Date, nullable: true })
  unassignedAt: Date | null;

  // Requires `assignment.technician` (and `assignment.assignedBy`, when set) to already be
  // loaded relations — `TicketsService.getAssignmentHistory` is responsible for that, this
  // method never triggers a lazy load itself.
  static fromEntity(assignment: TicketAssignment): TicketAssignmentResponseDto {
    const dto = new TicketAssignmentResponseDto();
    dto.id = assignment.id;
    dto.technician = {
      id: assignment.technician.id,
      username: assignment.technician.username,
    };
    dto.assignedBy = assignment.assignedBy
      ? {
          id: assignment.assignedBy.id,
          username: assignment.assignedBy.username,
        }
      : null;
    dto.reason = assignment.reason;
    dto.isAutoSuggested = assignment.isAutoSuggested;
    dto.assignedAt = assignment.assignedAt;
    dto.unassignedAt = assignment.unassignedAt;
    return dto;
  }
}
