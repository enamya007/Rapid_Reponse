import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { MailMessage } from './dto/mail-message';
import { MAIL_QUEUE_NAME, MAIL_SEND_JOB_NAME } from './mail.constants';

// P6 contract §6 "File": exactly these job options, so a failed SMTP attempt is retried up
// to 5 times with exponential backoff instead of being lost, while completed/failed jobs
// don't pile up in Redis forever.
const MAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: true,
  removeOnFail: 500,
};

@Injectable()
export class MailQueueService {
  constructor(
    @InjectQueue(MAIL_QUEUE_NAME) private readonly queue: Queue<MailMessage>,
  ) {}

  // D4: this only adds a job to Redis and resolves — no SMTP call happens on this call
  // stack, so nothing in an HTTP request path ever waits on a mail server being reachable.
  //
  // D5: `message` is the fully rendered `MailMessage` handed in by the caller (already built
  // from a `templates/*.template.ts` function). The job carries that rendered shape verbatim,
  // never an id to re-resolve later — see `MailProcessor`, which only reads `job.data`.
  async enqueue(message: MailMessage): Promise<void> {
    await this.queue.add(MAIL_SEND_JOB_NAME, message, MAIL_JOB_OPTIONS);
  }
}
