import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

// Shared body for `POST /tickets/:id/reopen` and `POST /tickets/:id/cancel` (P4 contract §5).
// `reason` is optional at the DTO level for BOTH routes: whether it is actually required is a
// transition-specific rule enforced by `evaluateTicketTransition` (P3) via
// `TransitionContext.hasReason` — REOPEN's guard rejects a missing/empty reason with
// `GUARD_FAILED` (-> 403), CANCEL's guards never require one. This DTO does not (and must not)
// duplicate that rule.
export class ReasonDto {
  @ApiPropertyOptional({
    example:
      'Le problème persiste, la climatisation ne fonctionne toujours pas.',
    minLength: 1,
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string;
}
