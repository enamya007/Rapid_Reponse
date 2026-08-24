import { Test, TestingModule } from '@nestjs/testing';
import type { SendMailOptions } from 'nodemailer';
import { mailConfig, MailConfig } from '../../config/mail.config';
import { MailMessage } from './dto/mail-message';
import { MAIL_TRANSPORTER } from './mail.constants';
import { MailService } from './mail.service';

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

function buildMessage(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    to: 'real-user@example.com',
    subject: 'Ticket TCK-000123 affecté',
    text: 'plain text body',
    html: '<p>html body</p>',
    ...overrides,
  };
}

describe('MailService', () => {
  let service: MailService;
  let transporter: {
    sendMail: jest.Mock<Promise<void>, [SendMailOptions]>;
  };

  async function buildModule(config: MailConfig): Promise<TestingModule> {
    return Test.createTestingModule({
      providers: [
        MailService,
        { provide: MAIL_TRANSPORTER, useValue: transporter },
        { provide: mailConfig.KEY, useValue: config },
      ],
    }).compile();
  }

  beforeEach(() => {
    transporter = {
      sendMail: jest
        .fn<Promise<void>, [SendMailOptions]>()
        .mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('without MAIL_SANDBOX_TO configured', () => {
    beforeEach(async () => {
      const module = await buildModule(
        buildMailConfig({ sandboxTo: undefined }),
      );
      service = module.get(MailService);
    });

    it('sends to the real recipient, with no X-Original-To header, and never touches the network beyond the injected transporter stub', async () => {
      await service.send(buildMessage({ to: 'real-user@example.com' }));

      expect(transporter.sendMail).toHaveBeenCalledTimes(1);
      const call = transporter.sendMail.mock.calls[0][0];
      expect(call.to).toBe('real-user@example.com');
      expect(call.headers).toBeUndefined();
    });

    it('formats the From header from fromName and from', async () => {
      await service.send(buildMessage());

      const call = transporter.sendMail.mock.calls[0][0];
      expect(call.from).toBe('"Ticket Checker" <noreply@example.com>');
    });

    it('forwards subject, text and html unchanged', async () => {
      await service.send(
        buildMessage({
          subject: 'Subject',
          text: 'Text body',
          html: '<p>Html body</p>',
        }),
      );

      const call = transporter.sendMail.mock.calls[0][0];
      expect(call.subject).toBe('Subject');
      expect(call.text).toBe('Text body');
      expect(call.html).toBe('<p>Html body</p>');
    });
  });

  describe('with MAIL_SANDBOX_TO configured (D9)', () => {
    beforeEach(async () => {
      const module = await buildModule(
        buildMailConfig({ sandboxTo: 'sandbox@example.com' }),
      );
      service = module.get(MailService);
    });

    it('redirects the recipient to the sandbox address instead of the real one', async () => {
      await service.send(buildMessage({ to: 'real-user@example.com' }));

      const call = transporter.sendMail.mock.calls[0][0];
      expect(call.to).toBe('sandbox@example.com');
    });

    it('adds an X-Original-To header carrying the real recipient', async () => {
      await service.send(buildMessage({ to: 'real-user@example.com' }));

      const call = transporter.sendMail.mock.calls[0][0];
      expect(call.headers).toEqual({
        'X-Original-To': 'real-user@example.com',
      });
    });

    it('redirects regardless of which recipient is passed in', async () => {
      await service.send(buildMessage({ to: 'someone-else@example.com' }));

      const call = transporter.sendMail.mock.calls[0][0];
      expect(call.to).toBe('sandbox@example.com');
      expect(call.headers).toEqual({
        'X-Original-To': 'someone-else@example.com',
      });
    });
  });
});
