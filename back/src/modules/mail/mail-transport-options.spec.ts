import { MailConfig } from '../../config/mail.config';
import { buildTransportOptions } from './mail-transport-options';

function buildMailConfig(overrides: Partial<MailConfig> = {}): MailConfig {
  return {
    host: 'localhost',
    port: 1025,
    username: '',
    password: '',
    from: 'noreply@example.com',
    fromName: 'Ticket Checker',
    useTls: false,
    useSsl: false,
    sandboxTo: undefined,
    ...overrides,
  };
}

describe('buildTransportOptions', () => {
  it('maps host, port, secure and requireTLS directly from the config', () => {
    const options = buildTransportOptions(
      buildMailConfig({
        host: 'smtp.example.com',
        port: 587,
        useTls: true,
        useSsl: false,
      }),
    );

    expect(options.host).toBe('smtp.example.com');
    expect(options.port).toBe(587);
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
  });

  it('maps useSsl onto secure for an implicit-TLS (SMTPS) setup', () => {
    const options = buildTransportOptions(
      buildMailConfig({ useSsl: true, useTls: false }),
    );

    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  // D10 — the safety-critical case: Mailpit rejects any AUTH attempt, so the `auth` key must
  // not exist at all on the returned options object, not merely be set to empty credentials.
  it('omits the auth option entirely when MAIL_USERNAME is the empty string', () => {
    const options = buildTransportOptions(
      buildMailConfig({ username: '', password: '' }),
    );

    expect('auth' in options).toBe(false);
    expect(options.auth).toBeUndefined();
  });

  it('includes auth with the configured credentials when MAIL_USERNAME is non-empty', () => {
    const options = buildTransportOptions(
      buildMailConfig({ username: 'smtp-user', password: 'smtp-pass' }),
    );

    expect(options.auth).toEqual({ user: 'smtp-user', pass: 'smtp-pass' });
  });
});
