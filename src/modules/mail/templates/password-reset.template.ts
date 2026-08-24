import { escapeHtml } from './escape-html.util';
import { RenderedMail } from './rendered-mail.type';

export interface PasswordResetMailParams {
  username: string;
  resetUrl: string;
  expiresInMinutes: number;
}

// `username` is user-originated and gets escaped before landing in `html`.
export function passwordResetMail({
  username,
  resetUrl,
  expiresInMinutes,
}: PasswordResetMailParams): RenderedMail {
  const subject = 'Réinitialisation de votre mot de passe';

  const text = [
    `Bonjour ${username},`,
    '',
    `Vous avez demandé la réinitialisation de votre mot de passe. Ce lien expire dans ${expiresInMinutes} minutes. Veuillez cliquez sur le lien afin de réinitialiser votre mot de passe  :`,
    resetUrl,
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.",
  ].join('\n');

  const html = [
    `<p>Bonjour ${escapeHtml(username)},</p>`,
    `<p>Vous avez demandé la réinitialisation de votre mot de passe. Ce lien expire dans ${expiresInMinutes} minutes :</p>`,
    `<p><a href="${resetUrl}">Réinitialiser mon mot de passe</a></p>`,
    "<p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>",
  ].join('\n');

  return { subject, text, html };
}
