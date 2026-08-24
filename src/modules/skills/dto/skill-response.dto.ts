import { ApiProperty } from '@nestjs/swagger';
import { Skill } from '../entities/skill.entity';

// Manual response DTO with `fromEntity`, following the project-wide convention (see
// `CommentResponseDto`/`TicketResponseDto`): never serializes the raw `Skill` entity, and never
// exposes `createdAt`/`updatedAt`. P5 contract §5 (`docs/plan-P5-contracts.md`) — figée:
// exactly `{ id, name, description }`.
export class SkillResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  static fromEntity(skill: Skill): SkillResponseDto {
    const dto = new SkillResponseDto();
    dto.id = skill.id;
    dto.name = skill.name;
    dto.description = skill.description;
    return dto;
  }
}
