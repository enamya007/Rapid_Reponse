// Injection token for the Nodemailer transporter used by MailService. Behind a token (rather
// than injecting `Transporter` directly) so tests can provide a lightweight
// `{ sendMail: jest.fn() }` stub with no network access — same pattern as `STORAGE_S3_CLIENT`
// in src/modules/storage/storage.constants.ts.
export const MAIL_TRANSPORTER = Symbol('MAIL_TRANSPORTER');

// P6 §6 "File": queue and job names for the async mail pipeline. Shared between
// `MailModule` (registerQueue), `MailQueueService` (producer, `InjectQueue`) and
// `MailProcessor` (`@Processor`) so the three never risk drifting from each other.
export const MAIL_QUEUE_NAME = 'mail';
export const MAIL_SEND_JOB_NAME = 'send';
