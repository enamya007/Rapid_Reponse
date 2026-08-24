/**
 * Promoted to a shared utility per the P6 contract, D18 (`docs/plan-P6-contracts.md` §3):
 * the `enableImplicitConversion` trap this function works around will reproduce identically
 * on `?unreadOnly=false` (the notifications list endpoint), so the already-proven fix
 * originally written for `TechnicianQueryDto` is reused here verbatim rather than
 * re-derived — this comment, the mechanism it traces, and the fix itself are moved as one
 * piece, not re-established.
 *
 * Strict boolean parser for query-string values, reading the ORIGINAL raw value off `obj`
 * rather than the (possibly already-corrupted) `value` class-transformer hands the callback.
 *
 * The frozen P5 contract (`docs/plan-P5-contracts.md` §5) writes
 * `@Type(() => Boolean) isAvailable?: boolean;` for this DTO. That does NOT do what it looks
 * like it does, and a plain `@Transform(({ value }) => ...)` isn't enough to fix it either —
 * both were tried and BOTH proven wrong by `test/technicians.e2e-spec.ts`'s `?isAvailable=false`
 * case, per the brief's explicit instruction not to trust intuition here. The actual mechanism,
 * traced through this project's own `class-transformer` install
 * (`node_modules/class-transformer/cjs/TransformOperationExecutor.js`):
 *
 * 1. The global `ValidationPipe`'s `enableImplicitConversion: true` makes `class-transformer`
 *    reflect this property's TS type (`boolean`) and run `this.transform(...)` on the raw
 *    string FIRST — landing in the `targetType === Boolean` branch, i.e. a plain `Boolean(value)`
 *    call. `Boolean('false')` is `true` (any non-empty string is truthy in JS).
 * 2. ONLY AFTER THAT does `TransformOperationExecutor.transform()` call
 *    `applyCustomTransformations(...)` — which is what actually runs an `@Transform` decorator
 *    (see that method's call sites, both `CLASS_TO_PLAIN` and the `PLAIN_TO_CLASS` branch used
 *    here: `finalValue = this.transform(...)` runs BEFORE
 *    `finalValue = this.applyCustomTransformations(finalValue, ...)`).
 *
 * So a naive `@Transform(({ value }) => ...)` receives `value = true` (already wrong) for
 * `?isAvailable=false` — the original string is gone by the time the callback runs, and
 * `typeof true === 'boolean'` makes even a careful parser pass it straight through unchanged.
 *
 * The fix: `applyCustomTransformations` also passes `obj` — the untouched, original plain
 * request-query object — through to the callback (`TransformFnParams.obj`). Reading `obj[key]`
 * instead of `value` bypasses the implicit-conversion step entirely and recovers the real
 * `'false'` string class-transformer already destroyed for `value`.
 *
 * (`src/config/env.validation.ts`'s `parseBooleanEnv` hits the same root problem for env vars,
 * but sidesteps it differently: it can afford to disable `enableImplicitConversion` entirely at
 * its own, local `plainToInstance` call site. That option isn't available here — the
 * `ValidationPipe` enabling it is global, in `main.ts`, out of this module's scope — hence the
 * `obj`-based read-around instead.)
 */
export function parseBooleanQuery({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown {
  const raw = obj[key];
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return raw;
}
