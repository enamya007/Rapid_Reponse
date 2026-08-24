import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MailMessage } from './dto/mail-message';
import { MAIL_QUEUE_NAME } from './mail.constants';
import { MailService } from './mail.service';

@Processor(MAIL_QUEUE_NAME)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  // D5: the only dependency here is `MailService` — no repository, no DataSource, no
  // template import. `job.data` is already a rendered `MailMessage`, so this method does
  // nothing but hand it to SMTP: a replayed job sends exactly the original mail.
  async process(job: Job<MailMessage>): Promise<void> {
    try {
      await this.mailService.send(job.data);
    } catch (error) {
      this.logger.error(
        `Failed to send mail job "${job.id}" to "${job.data.to}" (attempt ${job.attemptsMade}/${job.opts.attempts}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      // Re-throw, do not swallow: BullMQ only retries a job whose processor rejects. A
      // try/catch that stops here would silently turn the configured 5 attempts into 1.
      throw error;
    }
  }

  // D20: a BullMQ `Worker` is a Node `EventEmitter`, and Node treats an unlistened 'error'
  // event as fatal — it crashes the process. This event does not describe a failed job (that
  // is 'failed', handled below); it describes an infrastructure problem on the worker's own
  // connection (Redis dropped, connection closing, ...). There is nothing to retry here: the
  // job that was mid-flight, if any, is already handled by BullMQ's own stall/retry logic. This
  // handler exists purely so the process survives a connection blip, in production exactly as
  // in tests — it must never re-throw, unlike `process()` above.
  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    this.logger.error(
      `Mail worker connection error: ${error.message}`,
      error.stack,
    );
  }

  // D20: logs a job that has exhausted all of its configured attempts (contract: `attempts: 5`)
  // before BullMQ discards it (`removeOnFail: 500` still keeps it queryable in Redis, but
  // nothing surfaces it in application logs otherwise). Purely observational — this handler
  // does not retry or re-enqueue anything.
  @OnWorkerEvent('failed')
  onWorkerFailed(job: Job<MailMessage> | undefined, error: Error): void {
    this.logger.error(
      `Mail job "${job?.id ?? 'unknown'}" failed permanently after ${job?.attemptsMade ?? '?'} attempt(s): ${error.message}`,
    );
  }
}
