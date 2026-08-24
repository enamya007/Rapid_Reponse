/**
 * Detects a PostgreSQL unique-violation error (SQLSTATE `23505`) without requiring the caught
 * value to be an actual `typeorm` `QueryFailedError` instance.
 *
 * TypeORM's `QueryFailedError` copies every own property of the underlying driver error
 * (including `code`) onto itself (`node_modules/typeorm/error/QueryFailedError.js`), so checking
 * `.code` alone covers both the real `pg` driver path in production AND a directly-mocked
 * repository rejection shaped `{ code: '23505' }`, as used by the unit tests.
 *
 * Single source of truth: this was previously duplicated byte-for-byte in `SkillsService` and
 * `TechniciansService`, each carrying a comment explaining that the other copy could not be
 * reused because it was out of that task's scope. P6.5 needed a third copy — that was the point
 * to stop and extract it instead.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
