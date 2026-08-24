import { TicketStatus } from '../../tickets/enums/ticket-status.enum';
import { escapeHtml } from './escape-html.util';
import { RenderedMail } from './rendered-mail.type';

export interface TicketStatusChangedMailParams {
  reference: string;
  title: string;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  appUrl: string;
}

// `title` is user-originated and gets escaped before landing in `html`. `fromStatus`/`toStatus`
// are typed enum values, not free text, so they carry no escaping risk.
export function ticketStatusChangedMail({
  reference,
  title,
  fromStatus,
  toStatus,
  appUrl,
}: TicketStatusChangedMailParams): RenderedMail {
  const subject = `Ticket ${reference} : ${toStatus}`;

  const text = [
    `Le statut du ticket ${reference} — "${title}" est passé de ${fromStatus} à ${toStatus}.`,
    '',
    `Consultez-le ici : ${appUrl}`,
  ].join('\n');

  const html = [
    `<p>Le statut du ticket <strong>${reference}</strong> — « ${escapeHtml(title)} » est passé de <strong>${fromStatus}</strong> à <strong>${toStatus}</strong>.</p>`,
    `<p><a href="${appUrl}">Consulter le ticket</a></p>`,
  ].join('\n');

  return { subject, text, html };
}
