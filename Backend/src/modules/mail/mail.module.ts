import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { mailConfig } from '../../config/mail.config';
import type { MailConfig } from '../../config/mail.config';
import { MailQueueService } from './mail-queue.service';
import { buildTransportOptions } from './mail-transport-options';
import { MAIL_QUEUE_NAME, MAIL_TRANSPORTER } from './mail.constants';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';

// Registered locally (not via app.module.ts's global ConfigModule.forRoot `load`), so this
// namespace only becomes available where MailModule is actually imported — same pattern as
// StorageModule (src/modules/storage/storage.module.ts).
//
// `createTransport()` does not open a network connection by itself — Nodemailer only connects
// on the first `sendMail()` (or an explicit `.verify()`, which this module never calls) — so the
// application can start even with no SMTP server listening.
//
// P6 §6 "File": `registerQueue` only declares the `mail` queue on top of the shared BullMQ
// connection already established by `BullModule.forRootAsync` in app.module.ts (prefix,
// `maxRetriesPerRequest: null`) — it does not repeat that connection config here.
//
// Only `MailQueueService` is exported, deliberately: notification listeners and the
// password-reset flow (later tasks) must go through the queue, never call `MailService`
// directly, or SMTP would end up back on the HTTP request path (D4). `MailService` remains an
// internal provider, wired only into `MailProcessor` — the sole place SMTP actually happens.
@Module({
  imports: [
    ConfigModule.forFeature(mailConfig),
    BullModule.registerQueue({ name: MAIL_QUEUE_NAME }),
  ],
  providers: [
    MailService,
    MailQueueService,
    MailProcessor,
    {
      provide: MAIL_TRANSPORTER,
      inject: [mailConfig.KEY],
      useFactory: (config: MailConfig) =>
        createTransport(buildTransportOptions(config)),
    },
  ],
  exports: [MailQueueService],
})
export class MailModule {}
