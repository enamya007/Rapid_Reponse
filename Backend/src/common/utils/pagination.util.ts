import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationQueryDto,
} from '../dto/pagination-query.dto';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from '../dto/paginated-response.dto';

export interface TypeOrmSkipTake {
  skip: number;
  take: number;
}

// Clamps to the same bounds as `PaginationQueryDto`'s own class-validator decorators. This
// is a deliberate defense-in-depth duplication: it protects callers that build/mutate a
// `PaginationQueryDto`-shaped object by hand instead of going through the global
// `ValidationPipe` (e.g. an internal service-to-service call), so `limit` can never exceed
// `MAX_PAGE_SIZE` or drop below 1 regardless of how the value reached this function.
function normalizePage(page: number | undefined): number {
  if (!Number.isFinite(page) || (page as number) < 1) {
    return DEFAULT_PAGE;
  }
  return Math.floor(page as number);
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || (limit as number) < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(limit as number), MAX_PAGE_SIZE);
}

/**
 * Converts a validated `PaginationQueryDto` into TypeORM's `skip`/`take` pair, e.g.:
 * `repository.find({ ...toTypeOrmSkipTake(query) })`.
 */
export function toTypeOrmSkipTake(query: PaginationQueryDto): TypeOrmSkipTake {
  const page = normalizePage(query.page);
  const limit = normalizeLimit(query.limit);
  return { skip: (page - 1) * limit, take: limit };
}

/**
 * Wraps a page of results and the total item count into the generic paginated response
 * shape (`{ data, meta }`) returned by every paginated endpoint.
 */
export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  query: PaginationQueryDto,
): PaginatedResponseDto<T> {
  const page = normalizePage(query.page);
  const limit = normalizeLimit(query.limit);
  const totalPages = Math.ceil(total / limit);

  const meta = new PaginationMetaDto();
  meta.total = total;
  meta.page = page;
  meta.limit = limit;
  meta.totalPages = totalPages;

  const response = new PaginatedResponseDto<T>();
  response.data = data;
  response.meta = meta;
  return response;
}
