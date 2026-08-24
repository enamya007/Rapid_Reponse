import { applyDecorators } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';

/**
 * Single source of truth for the password complexity policy, shared by every DTO that
 * accepts a plaintext password (`RegisterDto`, `CreateTechnicianDto`, and P6's
 * `ResetPasswordDto`).
 *
 * This used to be hand-copied onto each DTO's `password` field. That is exactly what
 * produced the P5 regression: `CreateTechnicianDto` was frozen at `@Length(8, 72)` with NO
 * complexity check at all, so an ADMIN-created technician — a higher-privilege account —
 * ended up with a WEAKER password policy than a self-registered CLIENT. Composing the rule
 * once here and consuming it everywhere makes that class of drift structurally impossible:
 * there is no second copy left to diverge.
 *
 * Lower bound of 10 per the spec (cahier des charges §6.3). The upper bound of 72 is a
 * denial-of-service guard, not a cryptographic one: Argon2 hashes an input of any length
 * (the 72-byte truncation is bcrypt's limitation, not Argon2's), but it is deliberately
 * memory-hard, so an unbounded password is an unbounded amount of work handed to an
 * unauthenticated caller.
 *
 * `applyDecorators` (rather than a custom `registerDecorator` validator) is used because
 * this is a fixed composition of three already-existing class-validator decorators with no
 * new validation logic of its own — it only needs to fold `@IsString()` + `@Length()` +
 * `@Matches()` into one call site, keeping every consumer's messages byte-identical to what
 * they were before extraction.
 */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    Length(10, 72, {
      message: 'password must be between 10 and 72 characters long',
    }),
    Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
      message:
        'password must contain at least one lowercase letter, one uppercase letter and one digit',
    }),
  );
}
