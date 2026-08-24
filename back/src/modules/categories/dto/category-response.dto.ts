import { ApiProperty } from '@nestjs/swagger';
import { SkillResponseDto } from '../../skills/dto/skill-response.dto';
import { Category } from '../entities/category.entity';

// Manual response DTO with `fromEntity`, per the project-wide convention: never serializes the
// raw entity, never exposes `createdAt`/`updatedAt`.
//
// `requiredSkill` is nested rather than reduced to a bare `requiredSkillId` (P6.5 contract §4):
// the ticket-creation form displays the required skill's name, and nesting it saves a second
// round trip to `/skills`. It is null both when the category requires no skill and when the
// caller loaded the category without its relation — see `fromEntity` below.
export class CategoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: () => SkillResponseDto, nullable: true })
  requiredSkill: SkillResponseDto | null;

  @ApiProperty()
  isActive: boolean;

  static fromEntity(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.description = category.description;
    // `?? null` rather than a plain read: TypeORM leaves the property `undefined` when the
    // relation was not requested, and `undefined` would be dropped from the JSON body entirely,
    // making the key disappear instead of being reported as null.
    dto.requiredSkill = category.requiredSkill
      ? SkillResponseDto.fromEntity(category.requiredSkill)
      : null;
    dto.isActive = category.isActive;
    return dto;
  }
}
