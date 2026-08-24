import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { JobsOptions } from 'bullmq';
import { MailMessage } from './dto/mail-message';
import { MailQueueService } from './mail-queue.service';
import { MAIL_QUEUE_NAME } from './mail.constants';

type QueueAddMock = jest.Mock<
  Promise<void>,
  [jobName: string, data: MailMessage, opts: JobsOptions]
>;

function buildMessage(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    to: 'real-user@example.com',
    subject: 'Ticket TCK-000123 affecté',
    text: 'plain text body',
    html: '<p>html body</p>',
    ...overrides,
  };
}

describe('MailQueueService', () => {
  let service: MailQueueService;
  let queueAdd: QueueAddMock;

  beforeEach(async () => {
    queueAdd = jest
      .fn<
        Promise<void>,
        [jobName: string, data: MailMessage, opts: JobsOptions]
      >()
      .mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailQueueService,
        {
          provide: getQueueToken(MAIL_QUEUE_NAME),
          useValue: { add: queueAdd },
        },
      ],
    }).compile();

    service = module.get(MailQueueService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('adds exactly one job, never touching the network beyond the injected queue stub', async () => {
    await service.enqueue(buildMessage());

    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('enqueues under the job name "send"', async () => {
    await service.enqueue(buildMessage());

    const [jobName] = queueAdd.mock.calls[0];
    expect(jobName).toBe('send');
  });

  it('carries the exact rendered message as the job payload, unchanged (D5)', async () => {
    const message = buildMessage({
      to: 'someone@example.com',
      subject: 'Custom subject',
      text: 'Custom text',
      html: '<p>Custom html</p>',
    });

    await service.enqueue(message);

    const [, data] = queueAdd.mock.calls[0];
    expect(data).toEqual(message);
  });

  it('applies exactly the job options from the P6 contract §6, spelled out literally so this assertion does not silently track a code change', async () => {
    await service.enqueue(buildMessage());

    // Deliberately not importing whatever constant `MailQueueService` might use internally:
    // referencing it here would make this assertion move in lockstep with a regression
    // instead of catching one.
    const [, , opts] = queueAdd.mock.calls[0];
    expect(opts).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 500,
    });
  });
});
