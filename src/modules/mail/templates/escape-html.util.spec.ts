import { escapeHtml } from './escape-html.util';

describe('escapeHtml', () => {
  it('escapes a script tag so it cannot become live markup in a mail client', () => {
    const result = escapeHtml('<script>alert(1)</script>');

    expect(result).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('escapes every reserved HTML character individually', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('leaves plain text without reserved characters untouched', () => {
    expect(escapeHtml('Printer out of toner')).toBe('Printer out of toner');
  });

  it('returns an empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('escapes an attribute-breakout attempt containing quotes', () => {
    expect(escapeHtml('"><img src=x onerror=alert(1)>')).toBe(
      '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
    );
  });
});
