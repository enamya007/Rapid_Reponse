import { ticketAssignedMail } from './ticket-assigned.template';

describe('ticketAssignedMail', () => {
  it('renders subject, text and html with the reference, title and link', () => {
    const result = ticketAssignedMail({
      reference: 'TCK-000123',
      title: 'Printer out of toner',
      appUrl: 'https://app.example.com/tickets/abc-123',
    });

    expect(result.subject).toBe('Ticket TCK-000123 affecté');
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
    const result = ticketAssignedMail({
      reference: 'TCK-000456',
      title: '<script>alert(1)</script>',
      appUrl: 'https://app.example.com/tickets/def-456',
    });

    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The plain-text body is not HTML, so the raw title is expected there.
    expect(result.text).toContain('<script>alert(1)</script>');
  });
});
