import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée. Shared input shape for both
// `CreateTechnicianDto.skills` and `SetTechnicianSkillsDto.skills`.
export class TechnicianSkillInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skillId: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    default: 3,
    description: '1 (novice) to 5 (expert). Defaults to 3 when omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  level?: number;
}
