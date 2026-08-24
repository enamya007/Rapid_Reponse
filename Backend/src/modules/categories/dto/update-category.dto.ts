import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. Every field optional; the "at least
// one field" rule (400 otherwise) lives in the service, as everywhere else in this codebase.
//
// There is no `DELETE /categories/:id` (D6): `tickets.category_id` is a foreign key, so a
// retired category is retired by setting `isActive: false` — which `TicketsService.create`
// already treats as unusable — not by deleting a row historical tickets still point at.
export class UpdateCategoryDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // `@IsOptional()` skips validation for `null` as well as `undefined`, which is exactly what is
  // needed here: sending `null` explicitly clears the required skill, while omitting the key
  // leaves it untouched. The service tells the two apart with `!== undefined`.
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Send null to clear the required skill; omit to leave it as is.',
  })
  @IsOptional()
  @IsUUID()
  requiredSkillId?: string | null;

  @ApiPropertyOptional({
    description:
      'Set to false to retire the category: it stays attached to historical tickets but can no longer be chosen for a new one.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
