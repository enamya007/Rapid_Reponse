import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { buildPaginatedResponse, toTypeOrmSkipTake } from './pagination.util';

function query(page?: number, limit?: number): PaginationQueryDto {
  const dto = new PaginationQueryDto();
  if (page !== undefined) {
    dto.page = page;
  }
  if (limit !== undefined) {
    dto.limit = limit;
  }
  return dto;
}

describe('toTypeOrmSkipTake', () => {
  it('computes skip/take for page 1', () => {
    expect(toTypeOrmSkipTake(query(1, 20))).toEqual({ skip: 0, take: 20 });
  });

  it('computes skip/take for page 3 with a limit of 10', () => {
    expect(toTypeOrmSkipTake(query(3, 10))).toEqual({ skip: 20, take: 10 });
  });

  it('falls back to the defaults when page/limit are absent', () => {
    const dto = new PaginationQueryDto();
    // Simulate a hand-built object bypassing the DTO's own class-field defaults.
    delete (dto as { page?: number }).page;
    delete (dto as { limit?: number }).limit;
    expect(toTypeOrmSkipTake(dto)).toEqual({ skip: 0, take: 20 });
  });

  it('clamps a limit above the hard cap of 100, as defense-in-depth independent of DTO validation', () => {
    expect(toTypeOrmSkipTake(query(1, 1000))).toEqual({ skip: 0, take: 100 });
  });

  it('never produces a negative skip for an invalid (e.g. zero) page', () => {
    expect(toTypeOrmSkipTake(query(0, 20))).toEqual({ skip: 0, take: 20 });
  });
});

describe('buildPaginatedResponse', () => {
  it('wraps data with the correct metadata for a full page', () => {
    const data = ['a', 'b', 'c'];
    const result = buildPaginatedResponse(data, 42, query(2, 3));

    expect(result.data).toBe(data);
    expect(result.meta).toEqual({
      total: 42,
      page: 2,
      limit: 3,
      totalPages: 14,
    });
  });

  it('rounds totalPages up for a partial last page', () => {
    const result = buildPaginatedResponse([], 41, query(1, 20));
    expect(result.meta.totalPages).toBe(3);
  });

  it('reports 0 total pages when there are no items', () => {
    const result = buildPaginatedResponse([], 0, query(1, 20));
    expect(result.meta.totalPages).toBe(0);
  });

  it('clamps an over-the-cap limit in the reported meta too, keeping it consistent with skip/take', () => {
    const result = buildPaginatedResponse([], 250, query(1, 1000));
    expect(result.meta.limit).toBe(100);
    expect(result.meta.totalPages).toBe(3);
  });
});
