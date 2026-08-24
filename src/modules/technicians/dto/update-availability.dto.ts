import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée. Used by `PATCH /technicians/me/availability`.
export class UpdateAvailabilityDto {
  @ApiProperty()
  @IsBoolean()
  isAvailable: boolean;
}
