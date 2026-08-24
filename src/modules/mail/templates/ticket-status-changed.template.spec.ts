import { TicketStatus } from '../../tickets/enums/ticket-status.enum';
import { ticketStatusChangedMail } from './ticket-status-changed.template';

describe('ticketStatusChangedMail', () => {
  it('renders subject, text and html with the from/to status and link', () => {
    const result = ticketStatusChangedMail({
      reference: 'TCK-000123',
      title: 'Printer out of toner',
      fromStatus: TicketStatus.OPEN,
      toStatus: TicketStatus.IN_PROGRESS,
      appUrl: 'https://app.example.com/tickets/abc-123',
    });

    expect(result.subject).toBe('Ticket TCK-000123 : IN_PROGRESS');
    expect(result.text).toContain('OPEN');
    expect(result.text).toContain('IN_PROGRESS');
    expect(result.text).toContain('https://app.example.com/tickets/abc-123');
    expect(result.html).toContain('OPEN');
    expect(result.html).toContain('IN_PROGRESS');
    expect(result.html).toContain(
      'href="https://app.example.com/tickets/abc-123"',
    );
  });

  it('escapes a title containing a script tag in the html output, but not in the text output', () => {
    const result = ticketStatusChangedMail({
      reference: 'TCK-000456',
      title: '<script>alert(1)</script>',
      fromStatus: TicketStatus.ASSIGNED,
      toStatus: TicketStatus.RESOLVED,
      appUrl: 'https://app.example.com/tickets/def-456',
    });

    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.text).toContain('<script>alert(1)</script>');
  });
});
