// Minimal, dependency-free HTML escaping for values of user origin (ticket titles, usernames)
// that get interpolated into a template's `html` output. The P6 contract explicitly rules out a
// templating engine here (docs/plan-P6-contracts.md §2 — handlebars/pug/@nestjs-modules/mailer
// are all refused, precisely so there is no template-injection surface to secure). That leaves
// this string-replace escaper as the entire defense: it must run on every user-originated value
// before it lands in `html`, e.g. a ticket title of `<script>alert(1)</script>` must never
// become live markup in a mail client.
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
