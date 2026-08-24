import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { parseBooleanQuery } from '../../../common/utils/parse-boolean-query.util';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée in shape (three optional filters on top
// of `page`/`limit`). The boolean-parsing fix for `isAvailable`/`isActive` is now the shared
// `parseBooleanQuery` (P6 contract D18, `docs/plan-P6-contracts.md` §3) — see that function's
// own doc comment for the full `enableImplicitConversion` mechanism it works around.
export class TechnicianQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by TechnicianProfile.isAvailable',
  })
  @IsOptional()
  @Transform(parseBooleanQuery)
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only technicians holding this skill',
  })
  @IsOptional()
  @IsUUID()
  skillId?: string;

  @ApiPropertyOptional({ description: 'Filter by User.isActive' })
  @IsOptional()
  @Transform(parseBooleanQuery)
  @IsBoolean()
  isActive?: boolean;
}
