/**
 * Return shape shared by every mail template function in `templates/*.template.ts`
 * (P6 contract §6). Deliberately narrower than `MailMessage`: a template never knows the
 * recipient, only the content — `to` is filled in by whoever calls the template.
 */
export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}
