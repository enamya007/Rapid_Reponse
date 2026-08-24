import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée. Query string of
// `GET /tickets/:id/assignment-suggestions`. `@Type(() => Number)` is required: a query string
// value arrives as a raw `string`, and without it `class-validator`'s `@IsInt` would reject even
// a perfectly valid `?limit=10` (same pitfall documented on `TechnicianQueryDto`'s boolean
// fields).
export class SuggestionQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 50,
    default: 10,
    description: 'Maximum number of suggestions to return (default 10).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
