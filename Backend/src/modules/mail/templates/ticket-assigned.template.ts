import { escapeHtml } from './escape-html.util';
import { RenderedMail } from './rendered-mail.type';

export interface TicketAssignedMailParams {
  reference: string;
  title: string;
  appUrl: string;
}

// `title` is user-originated (a ticket title) and gets escaped before landing in `html`; `text`
// needs no escaping since plain-text mail bodies carry no markup to inject into.
export function ticketAssignedMail({
  reference,
  title,
  appUrl,
}: TicketAssignedMailParams): RenderedMail {
  const subject = `Ticket ${reference} affecté`;

  const text = [
    `Le ticket ${reference} — "${title}" vous a été affecté.`,
    '',
    `Consultez-le ici : ${appUrl}`,
  ].join('\n');

  const html = [
    `<p>Le ticket <strong>${reference}</strong> — « ${escapeHtml(title)} » vous a été affecté.</p>`,
    `<p><a href="${appUrl}">Consulter le ticket</a></p>`,
  ].join('\n');

  return { subject, text, html };
}
