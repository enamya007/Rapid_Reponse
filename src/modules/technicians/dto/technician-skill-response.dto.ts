import { ApiProperty } from '@nestjs/swagger';
import { TechnicianSkill } from '../entities/technician-skill.entity';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée: exactly `{ id, name, level }`, `id`/`name`
// from the underlying `Skill`, never `TechnicianSkill`'s own composite key columns.
export class TechnicianSkillResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  level: number;

  // Requires `technicianSkill.skill` to already be a loaded relation — callers are
  // responsible for that (`TechniciansService` always loads it via `relations: { skill: true }`),
  // this method never triggers a lazy load.
  static fromEntity(
    technicianSkill: TechnicianSkill,
  ): TechnicianSkillResponseDto {
    const dto = new TechnicianSkillResponseDto();
    dto.id = technicianSkill.skill.id;
    dto.name = technicianSkill.skill.name;
    dto.level = technicianSkill.level;
    return dto;
  }
}
