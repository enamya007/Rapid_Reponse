import 'reflect-metadata';
import { Transform, plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { parseBooleanQuery } from './parse-boolean-query.util';

describe('parseBooleanQuery', () => {
  it("parses the string 'true' to the boolean true", () => {
    expect(parseBooleanQuery({ obj: { flag: 'true' }, key: 'flag' })).toBe(
      true,
    );
  });

  // This is the exact case that demasks a naive `Boolean(value)` implementation: JS's
  // `Boolean('false')` is `true`, since any non-empty string is truthy.
  it("parses the string 'false' to the boolean false, not true", () => {
    expect(parseBooleanQuery({ obj: { flag: 'false' }, key: 'flag' })).toBe(
      false,
    );
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(parseBooleanQuery({ obj: { flag: ' TRUE ' }, key: 'flag' })).toBe(
      true,
    );
    expect(parseBooleanQuery({ obj: { flag: ' False ' }, key: 'flag' })).toBe(
      false,
    );
  });

  it('passes an already-boolean raw value through unchanged', () => {
    expect(parseBooleanQuery({ obj: { flag: true }, key: 'flag' })).toBe(true);
    expect(parseBooleanQuery({ obj: { flag: false }, key: 'flag' })).toBe(
      false,
    );
  });

  it('returns undefined unchanged when the key is absent from obj', () => {
    expect(parseBooleanQuery({ obj: {}, key: 'flag' })).toBeUndefined();
  });

  it('returns an empty string unchanged (not a recognized boolean literal)', () => {
    expect(parseBooleanQuery({ obj: { flag: '' }, key: 'flag' })).toBe('');
  });

  it('returns an unrecognized string value unchanged, letting @IsBoolean reject it', () => {
    expect(parseBooleanQuery({ obj: { flag: 'maybe' }, key: 'flag' })).toBe(
      'maybe',
    );
  });
});

// Reproduces the actual failure mode `parseBooleanQuery` exists to fix, end-to-end through
// `class-transformer`, exactly as the global `ValidationPipe` (`enableImplicitConversion: true`)
// runs it — not just calling the function directly with a hand-built `{ obj, key }` argument.
// This is what makes the mutation in D18 (`docs/plan-P6-contracts.md` §9 — replacing the body
// with a naive `Boolean(value)`) observable: `enableImplicitConversion` has already turned the
// raw string `'false'` into the boolean `true` by the time a `@Transform` callback's `value`
// argument is read (see this function's own doc comment), so a naive `Boolean(value)` receives
// `value === true` and returns `true` — silently ignoring `?unreadOnly=false`.
class BooleanQueryHost {
  @IsOptional()
  @Transform(parseBooleanQuery)
  @IsBoolean()
  flag?: boolean;
}

function transformQuery(query: Record<string, unknown>): BooleanQueryHost {
  return plainToInstance(BooleanQueryHost, query, {
    enableImplicitConversion: true,
  });
}

describe('parseBooleanQuery through the class-transformer pipeline', () => {
  it('resolves ?flag=false to false, not true (the D18 case)', () => {
    expect(transformQuery({ flag: 'false' }).flag).toBe(false);
  });

  it('resolves ?flag=true to true', () => {
    expect(transformQuery({ flag: 'true' }).flag).toBe(true);
  });

  it('leaves flag undefined when the query param is absent', () => {
    expect(transformQuery({}).flag).toBeUndefined();
  });
});
