import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IsStrongPassword } from './strong-password.decorator';

// A minimal host class, mirroring the way every real consumer (`RegisterDto`,
// `CreateTechnicianDto`) only ever applies `@IsStrongPassword()` to a single `password`
// field — no host-specific behaviour to account for.
class PasswordHost {
  @IsStrongPassword()
  password: string;
}

async function validatePassword(password: unknown): Promise<string[]> {
  const instance = plainToInstance(PasswordHost, { password });
  const errors = await validate(instance);
  if (errors.length === 0) {
    return [];
  }
  return errors[0].constraints ? Object.values(errors[0].constraints) : [];
}

describe('IsStrongPassword', () => {
  it('accepts a password that is long enough and meets the complexity rule', async () => {
    const messages = await validatePassword('Str0ngP@ssw0rd');
    expect(messages).toEqual([]);
  });

  it('rejects a password shorter than the 10-character minimum', async () => {
    const messages = await validatePassword('Sh0rt1');
    expect(messages).toContain(
      'password must be between 10 and 72 characters long',
    );
  });

  // This is the exact P5 regression: `CreateTechnicianDto` had been frozen at
  // `@Length(8, 72)`, so an 8-9 character password — too short under the shared 10-char
  // floor, but long enough under the old, weaker rule — must now be refused.
  it('rejects an 8-character password (the exact P5 regression)', async () => {
    const messages = await validatePassword('Ab1defgh');
    expect(messages).toContain(
      'password must be between 10 and 72 characters long',
    );
  });

  it('rejects a 9-character password (still below the shared 10-char floor)', async () => {
    const messages = await validatePassword('Ab1defghi');
    expect(messages).toContain(
      'password must be between 10 and 72 characters long',
    );
  });

  it('rejects a password longer than the 72-character maximum', async () => {
    const messages = await validatePassword('Aa1' + 'a'.repeat(70));
    expect(messages).toContain(
      'password must be between 10 and 72 characters long',
    );
  });

  it('rejects a password with no lowercase letter', async () => {
    const messages = await validatePassword('STRONGP@SSW0RD');
    expect(messages).toContain(
      'password must contain at least one lowercase letter, one uppercase letter and one digit',
    );
  });

  it('rejects a password with no uppercase letter', async () => {
    const messages = await validatePassword('str0ngp@ssword');
    expect(messages).toContain(
      'password must contain at least one lowercase letter, one uppercase letter and one digit',
    );
  });

  it('rejects a password with no digit', async () => {
    const messages = await validatePassword('StrongP@ssword');
    expect(messages).toContain(
      'password must contain at least one lowercase letter, one uppercase letter and one digit',
    );
  });

  it('rejects a non-string value', async () => {
    const messages = await validatePassword(12345678901);
    expect(messages.length).toBeGreaterThan(0);
  });
});
