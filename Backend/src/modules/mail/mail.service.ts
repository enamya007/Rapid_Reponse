import { Inject, Injectable } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { mailConfig } from '../../config/mail.config';
import type { MailConfig } from '../../config/mail.config';
import { MailMessage } from './dto/mail-message';
import { MAIL_TRANSPORTER } from './mail.constants';

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter,
    @Inject(mailConfig.KEY) private readonly config: MailConfig,
  ) {}

  async send(message: MailMessage): Promise<void> {
    // D9: MAIL_SANDBOX_TO is the safety net for any non-production environment whose SMTP
    // server is real and would otherwise deliver to real mailboxes. Applied here, at the
    // transport boundary, so no caller — present or future — can bypass it by constructing the
    // message differently: every `send()` goes through this same substitution.
    const { sandboxTo } = this.config;
    const recipient = sandboxTo ?? message.to;

    await this.transporter.sendMail({
      from: `"${this.config.fromName}" <${this.config.from}>`,
      to: recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
      // The real recipient is preserved as a header when redirected to the sandbox address, so
      // the mail stays traceable to who it was actually meant for.
      headers: sandboxTo ? { 'X-Original-To': message.to } : undefined,
    });
  }
}
