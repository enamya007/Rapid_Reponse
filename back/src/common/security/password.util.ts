import * as argon2 from 'argon2';

// OWASP-recommended argon2id parameters. Single source of truth: previously duplicated
// (byte-for-byte identical) between `AuthService` and `src/database/seeds/seed.ts` (P5 D8).
// Both now import this constant instead of declaring their own copy.
//
// Safe to change in the future without invalidating already-stored password hashes: argon2
// encodes its cost parameters directly inside the produced hash string (`$argon2id$v=..$m=..,
// t=..,p=..$...`), so `argon2.verify`/`verifyPassword` always re-reads the parameters that were
// actually used to create a given hash, regardless of what `ARGON2_OPTIONS` currently holds.
export const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Hashes a plaintext password with `ARGON2_OPTIONS`.
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against a previously produced argon2 hash. Never throws: a
 * malformed/corrupt hash (e.g. bad data read back from storage) is treated as "does not
 * match" rather than propagating an argon2 parsing error to the caller.
 */
export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
