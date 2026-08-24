import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Defaults and hard cap shared by every paginated list endpoint (cahier des charges §6.1:
// pagination is mandatory beyond 20 items). Re-exported so `pagination.util.ts` and any
// consumer stay in sync with this single source of truth.
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Generic query-string DTO for paginated list endpoints. Not tied to any particular
 * resource: controllers extend/compose it (e.g. via `@Query() query: PaginationQueryDto`)
 * and combine it with their own filter DTOs.
 *
 * `limit` is capped at `MAX_PAGE_SIZE`: requesting more than that is a validation error
 * (400), not silently clamped, consistent with the rest of the API's fail-fast validation
 * (`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`).
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: '1-based page number',
    minimum: 1,
    default: DEFAULT_PAGE,
    example: DEFAULT_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be greater than or equal to 1' })
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    example: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be greater than or equal to 1' })
  @Max(MAX_PAGE_SIZE, {
    message: `limit must not be greater than ${MAX_PAGE_SIZE}`,
  })
  limit: number = DEFAULT_PAGE_SIZE;
}
