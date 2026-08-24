import { ticketCommentedMail } from './ticket-commented.template';

describe('ticketCommentedMail', () => {
  it('renders subject, text and html with the reference, title and link', () => {
    const result = ticketCommentedMail({
      reference: 'TCK-000123',
      title: 'Printer out of toner',
      appUrl: 'https://app.example.com/tickets/abc-123',
    });

    expect(result.subject).toBe('Nouveau commentaire sur TCK-000123');
    expect(result.text).toContain('TCK-000123');
    expect(result.text).toContain('Printer out of toner');
    expect(result.text).toContain('https://app.example.com/tickets/abc-123');
    expect(result.html).toContain('TCK-000123');
    expect(result.html).toContain('Printer out of toner');
    expect(result.html).toContain(
      'href="https://app.example.com/tickets/abc-123"',
    );
  });

  it('escapes a title containing a script tag in the html output, but not in the text output', () => {
    const result = ticketCommentedMail({
      reference: 'TCK-000456',
      title: '<script>alert(1)</script>',
      appUrl: 'https://app.example.com/tickets/def-456',
    });

    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.text).toContain('<script>alert(1)</script>');
  });

  it('never includes a comment body field, matching contract D6', () => {
    const result = ticketCommentedMail({
      reference: 'TCK-000789',
      title: 'Printer out of toner',
      appUrl: 'https://app.example.com/tickets/ghi-789',
    });

    // There is no `body`/`comment` parameter in this template's signature at all (see the
    // TicketCommentedMailParams type), so there is nothing to assert an *absence* of beyond
    // the rendered content itself staying limited to reference/title/link.
    expect(Object.keys(result).sort()).toEqual(['html', 'subject', 'text']);
  });
});
