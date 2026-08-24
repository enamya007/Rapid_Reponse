import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { MailMessage } from './dto/mail-message';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';

function buildMessage(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    to: 'real-user@example.com',
    subject: 'Ticket TCK-000123 affecté',
    text: 'plain text body',
    html: '<p>html body</p>',
    ...overrides,
  };
}

function buildJob(data: MailMessage): Job<MailMessage> {
  return {
    id: 'job-1',
    data,
    attemptsMade: 1,
    opts: { attempts: 5 },
  } as unknown as Job<MailMessage>;
}

describe('MailProcessor', () => {
  let processor: MailProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailProcessor,
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    processor = module.get(MailProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sends the job payload through MailService.send, unchanged (D5)', async () => {
    mailService.send.mockResolvedValue(undefined);
    const message = buildMessage({ to: 'assignee@example.com' });

    await processor.process(buildJob(message));

    expect(mailService.send).toHaveBeenCalledTimes(1);
    expect(mailService.send).toHaveBeenCalledWith(message);
  });

  it('propagates a send failure out of the processor instead of swallowing it, so BullMQ retries the job', async () => {
    const smtpError = new Error('SMTP connection refused');
    mailService.send.mockRejectedValue(smtpError);

    await expect(processor.process(buildJob(buildMessage()))).rejects.toThrow(
      smtpError,
    );
  });

  // D20: a BullMQ Worker's 'error' event reports an infrastructure problem (dropped Redis
  // connection, connection closing, ...), never a job outcome. Node treats an unlistened
  // 'error' event on an EventEmitter as fatal, which is exactly the crash D20 fixes. This test
  // is the mutation target named in the brief: making `onWorkerError` re-throw must turn it red.
  describe('onWorkerError (D20)', () => {
    it('logs the connection error and does NOT re-throw it', () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const connectionError = new Error('Connection is closed.');

      expect(() => processor.onWorkerError(connectionError)).not.toThrow();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connection is closed.'),
        connectionError.stack,
      );

      loggerSpy.mockRestore();
    });
  });

  // D20: without this handler, a mail job that exhausts its 5 configured attempts vanishes
  // silently once BullMQ discards it — this is purely observational, it never retries or
  // re-enqueues anything.
  describe('onWorkerFailed (D20)', () => {
    it('logs the job id and the number of attempts already consumed', () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const job = buildJob(buildMessage());
      job.attemptsMade = 5;
      const smtpError = new Error('SMTP connection refused');

      processor.onWorkerFailed(job, smtpError);

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('job-1'));
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('5'));
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('SMTP connection refused'),
      );

      loggerSpy.mockRestore();
    });

    it('tolerates an undefined job (stalled job removed by removeOnFail before the event fires)', () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const smtpError = new Error('SMTP connection refused');

      expect(() =>
        processor.onWorkerFailed(undefined, smtpError),
      ).not.toThrow();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown'),
      );

      loggerSpy.mockRestore();
    });
  });
});
