import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée. Every field is optional; the "at least
// one field must be provided" rule (-> 400 otherwise) is enforced by `TechniciansService.update`,
// not here (same pattern as `UpdateTicketDto`/`TicketsService.update`).
export class UpdateTechnicianDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxConcurrentTickets?: number;

  // D9 (`docs/plan-P5-contracts.md` §2): routed through `UsersService.update()`, not written
  // to `TechnicianProfile` — see `TechniciansService.update`.
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
