import { escapeHtml } from './escape-html.util';
import { RenderedMail } from './rendered-mail.type';

export interface TicketCommentedMailParams {
  reference: string;
  title: string;
  appUrl: string;
}

// No comment body param here, by design (P6 contract D6): the email for a new comment never
// carries the comment's content, so an INTERNAL comment cannot leak to a CLIENT recipient
// through this channel. The guarantee holds because the data is simply never passed in, not
// because a filter downstream is trusted to strip it.
export function ticketCommentedMail({
  reference,
  title,
  appUrl,
}: TicketCommentedMailParams): RenderedMail {
  const subject = `Nouveau commentaire sur ${reference}`;

  const text = [
    `Un commentaire a été ajouté au ticket ${reference} — "${title}".`,
    '',
    `Consultez-le ici : ${appUrl}`,
  ].join('\n');

  const html = [
    `<p>Un commentaire a été ajouté au ticket <strong>${reference}</strong> — « ${escapeHtml(title)} ».</p>`,
    `<p><a href="${appUrl}">Consulter le ticket</a></p>`,
  ].join('\n');

  return { subject, text, html };
}
