import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { MailConfig } from '../../config/mail.config';

/**
 * Maps the `mail` config namespace onto Nodemailer's SMTP transport options. Extracted as a
 * pure function (instead of being inlined in MailModule's `useFactory`) so contract D10's most
 * safety-critical rule — omitting the `auth` option entirely, not merely emptying it, when
 * `MAIL_USERNAME` is blank — is directly unit-testable without booting a Nest module or
 * touching the network (Mailpit, used in development, rejects any AUTH attempt outright; see
 * docs/plan-P6-contracts.md D10).
 */
export function buildTransportOptions(
  config: MailConfig,
): SMTPTransport.Options {
  return {
    host: config.host,
    port: config.port,
    // `secure: true` opens an implicit TLS connection from the first byte (SMTPS, typically
    // port 465). `requireTLS` instead forces STARTTLS on an initially plain connection
    // (typically port 587). The two env flags map independently onto these so either style —
    // or neither, as Mailpit needs on its plaintext port 1025 — can be configured without a
    // code change.
    secure: config.useSsl,
    requireTLS: config.useTls,
    // D10: passing `auth: { user: '', pass: '' }` would still make Nodemailer attempt AUTH,
    // which Mailpit rejects outright. The `auth` key itself must be entirely absent when no
    // username is configured, not merely carry empty credentials.
    ...(config.username
      ? { auth: { user: config.username, pass: config.password } }
      : {}),
  };
}
