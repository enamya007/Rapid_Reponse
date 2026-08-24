import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée. Body of `POST /tickets/:id/assign`.
//
// `reason` is optional at THIS DTO level for both a first assignment and a reassignment: which
// case actually REQUIRES it is a transition-specific rule enforced by
// `evaluateTicketTransition` (P3) via `TransitionContext.hasReason` — the `canReassignFromAssigned`
// guard rejects a missing/empty reason with `GUARD_FAILED` (-> 403) when reassigning an already
// `ASSIGNED` ticket, `canAssignFromOpen` never requires one. `TicketsService.assign` never
// duplicates that rule (D2).
export class AssignTicketDto {
  @ApiProperty({
    description:
      'userId of the technician to assign (D4 — never TechnicianProfile.id)',
  })
  @IsUUID()
  technicianId: string;

  @ApiPropertyOptional({
    example: 'Le technicien précédent est indisponible pour la journée.',
    minLength: 1,
    maxLength: 1000,
    description:
      'Mandatory (enforced by the P3 guard, not this DTO) when reassigning a ticket already ASSIGNED to someone else.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'D6: set by the caller when this assignment follows a suggestion read from GET .../assignment-suggestions. Purely informational — the suggestion endpoint itself never triggers an assignment.',
  })
  @IsOptional()
  @IsBoolean()
  isAutoSuggested?: boolean;
}
