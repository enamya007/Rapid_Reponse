/**
 * A fully rendered message, ready to hand to `MailService.send()` — no further templating
 * happens downstream (P6 contract §6, `docs/plan-P6-contracts.md`).
 *
 * This is also exactly the payload BullMQ mail jobs carry (contract D5): the queue only moves
 * this shape around, it never re-resolves an id or re-renders a template. Whoever enqueues a
 * job renders it first, using one of the `templates/*.template.ts` functions.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}
