import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. Bounds mirror the column widths in
// `docs/data-model.md` (`categories.name` is `varchar(80)`, `description` is `text`).
export class CreateCategoryDto {
  @ApiProperty({ example: 'Panne électrique', minLength: 2, maxLength: 80 })
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({
    example: 'Coupure ou dysfonctionnement électrique.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // The pivot of the automatic assignment suggestion: category -> required skill -> technicians
  // holding it. A category without one is legal — it simply falls back to load-only ranking.
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Skill required to handle this category. Drives the automatic assignment suggestion.',
  })
  @IsOptional()
  @IsUUID()
  requiredSkillId?: string;
}
