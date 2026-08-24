import * as argon2 from 'argon2';
import { ARGON2_OPTIONS, hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  describe('ARGON2_OPTIONS', () => {
    // Hardcoded, literal expectation (not derived from `ARGON2_OPTIONS` itself): this is the
    // one test in the suite that actually locks in the exact values, so that an accidental
    // change to any of them (a hashing-policy regression, not just a refactor) is caught here
    // rather than silently passing through a self-referential assertion. Must stay equal to
    // what was previously hardcoded independently in `AuthService` and `seed.ts` (P5 D8).
    it('matches the exact OWASP-recommended argon2id parameters previously duplicated in AuthService and seed.ts', () => {
      expect(ARGON2_OPTIONS).toEqual({
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    });
  });

  describe('hashPassword / verifyPassword', () => {
    it('produces a hash that verifyPassword accepts for the correct plaintext', async () => {
      const hash = await hashPassword('Str0ngP@ssw0rd');

      await expect(verifyPassword(hash, 'Str0ngP@ssw0rd')).resolves.toBe(true);
    });

    it('rejects an incorrect plaintext against a valid hash', async () => {
      const hash = await hashPassword('Str0ngP@ssw0rd');

      await expect(verifyPassword(hash, 'WrongPassword')).resolves.toBe(false);
    });

    it('produces a well-formed argon2id hash', async () => {
      const hash = await hashPassword('Str0ngP@ssw0rd');

      expect(hash).toMatch(/^\$argon2id\$v=\d+\$m=\d+,p=\d+,t=\d+\$/);
    });
  });

  describe('verifyPassword on a malformed hash', () => {
    it('resolves to false, without throwing, for a hash with no leading "$"', async () => {
      await expect(
        verifyPassword('not-a-valid-hash', 'whatever'),
      ).resolves.toBe(false);
    });

    it('resolves to false, without throwing, for an empty hash', async () => {
      await expect(verifyPassword('', 'whatever')).resolves.toBe(false);
    });

    it('resolves to false, without throwing, for a well-formed but garbage-data hash', async () => {
      await expect(
        verifyPassword(
          '$argon2id$v=19$m=19456,t=2,p=1$Z2FyYmFnZXNhbHQ$Z2FyYmFnZWhhc2g',
          'whatever',
        ),
      ).resolves.toBe(false);
    });
  });
});
