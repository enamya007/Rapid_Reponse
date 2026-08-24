import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { TechnicianSkillInputDto } from './technician-skill-input.dto';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée. `skills` (unlike
// `CreateTechnicianDto.skills`) is REQUIRED and represents the COMPLETE, final skill set for the
// technician: `TechniciansService.setSkills` replaces every existing `technician_skills` row for
// this profile with exactly what is sent here (an empty array clears all skills).
export class SetTechnicianSkillsDto {
  @ApiProperty({ type: () => [TechnicianSkillInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TechnicianSkillInputDto)
  skills: TechnicianSkillInputDto[];
}
