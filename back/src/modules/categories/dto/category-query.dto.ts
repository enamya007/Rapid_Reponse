import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { parseBooleanQuery } from '../../../common/utils/parse-boolean-query.util';

// Not paginated (P6.5 contract §3): the referential is bounded by construction — a handful of
// rows — exactly like `GET /skills`. `isActive` goes through the shared `parseBooleanQuery`
// (P6 D18) because `enableImplicitConversion` turns the string `'false'` into `true`.
export class CategoryQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by Category.isActive. A ticket-creation form wants isActive=true.',
  })
  @IsOptional()
  @Transform(parseBooleanQuery)
  @IsBoolean()
  isActive?: boolean;
}
