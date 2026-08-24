import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationQueryDto,
} from './pagination-query.dto';

// Mirrors exactly how the global `ValidationPipe` processes query params
// (`transform: true`, `enableImplicitConversion: true`): plain strings in, typed/validated
// instance out.
async function transformAndValidate(
  query: Record<string, unknown>,
): Promise<{ instance: PaginationQueryDto; errorCount: number }> {
  const instance = plainToInstance(PaginationQueryDto, query, {
    enableImplicitConversion: true,
  });
  const errors = await validate(instance, { whitelist: true });
  return { instance, errorCount: errors.length };
}

describe('PaginationQueryDto', () => {
  it('defaults to page 1 and limit 20 when nothing is provided', async () => {
    const { instance, errorCount } = await transformAndValidate({});

    expect(errorCount).toBe(0);
    expect(instance.page).toBe(DEFAULT_PAGE);
    expect(instance.limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it('accepts explicit, in-range page and limit values', async () => {
    const { instance, errorCount } = await transformAndValidate({
      page: '3',
      limit: '50',
    });

    expect(errorCount).toBe(0);
    expect(instance.page).toBe(3);
    expect(instance.limit).toBe(50);
  });

  it('accepts limit at exactly the hard cap of 100', async () => {
    const { errorCount } = await transformAndValidate({ limit: '100' });
    expect(errorCount).toBe(0);
  });

  it('rejects a limit above the hard cap, even far above it (e.g. 1000)', async () => {
    const { errorCount, instance } = await transformAndValidate({
      limit: '1000',
    });

    expect(errorCount).toBeGreaterThan(0);
    // The cap is enforced by validation (400), never silently clamped: the raw,
    // out-of-range value is still what was parsed.
    expect(instance.limit).toBe(1000);
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it('rejects limit = 0', async () => {
    const { errorCount } = await transformAndValidate({ limit: '0' });
    expect(errorCount).toBeGreaterThan(0);
  });

  it('rejects a negative page', async () => {
    const { errorCount } = await transformAndValidate({ page: '-1' });
    expect(errorCount).toBeGreaterThan(0);
  });

  it('rejects page = 0', async () => {
    const { errorCount } = await transformAndValidate({ page: '0' });
    expect(errorCount).toBeGreaterThan(0);
  });

  it('rejects a non-numeric page', async () => {
    const { errorCount } = await transformAndValidate({ page: 'not-a-number' });
    expect(errorCount).toBeGreaterThan(0);
  });

  it('rejects a non-integer limit', async () => {
    const { errorCount } = await transformAndValidate({ limit: '20.5' });
    expect(errorCount).toBeGreaterThan(0);
  });
});
