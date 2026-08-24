import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

// `POST /tickets/:id/resolve` body (P4 contract §5). The RESOLVE transition itself — who may
// perform it, from which status, whether it is even allowed at all — is entirely owned by
// `evaluateTicketTransition` (P3); this DTO only carries the `resolutionNote` that transition's
// guard requires (`TransitionContext.hasResolutionNote`) and that `TicketsService` persists on
// both `Ticket.resolutionNote` and the `ticket_status_history` row it writes alongside it.
export class ResolveTicketDto {
  @ApiProperty({
    example: 'Climatiseur remis en service après remplacement du condensateur.',
    minLength: 1,
    maxLength: 2000,
  })
  @IsString()
  @Length(1, 2000)
  resolutionNote: string;
}
