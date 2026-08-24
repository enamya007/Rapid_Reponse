import { ConfigType, registerAs } from '@nestjs/config';
import { getValidatedEnv } from './env.validation';

export const mailConfig = registerAs('mail', () => {
  const env = getValidatedEnv();

  return {
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    username: env.MAIL_USERNAME,
    password: env.MAIL_PASSWORD,
    from: env.MAIL_FROM,
    fromName: env.MAIL_FROM_NAME,
    useTls: env.MAIL_USE_TLS,
    useSsl: env.MAIL_USE_SSL,
    // When set, every outgoing mail must be redirected here instead of its
    // real recipient. The SMTP server behind MAIL_* is real and delivers to
    // real mailboxes, so this is the safety net for non-production
    // environments. Not enforced yet: the mailer that reads it lands in P6.
    sandboxTo: env.MAIL_SANDBOX_TO,
  };
});

export type MailConfig = ConfigType<typeof mailConfig>;
