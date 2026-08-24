import { passwordResetMail } from './password-reset.template';

describe('passwordResetMail', () => {
  it('renders subject, text and html with the username, link and expiry', () => {
    const result = passwordResetMail({
      username: 'jdoe',
      resetUrl: 'https://app.example.com/reset-password?token=abc.def',
      expiresInMinutes: 60,
    });

    expect(result.subject).toBe('Réinitialisation de votre mot de passe');
    expect(result.text).toContain('jdoe');
    expect(result.text).toContain(
      'https://app.example.com/reset-password?token=abc.def',
    );
    expect(result.text).toContain('60 minutes');
    expect(result.html).toContain('jdoe');
    expect(result.html).toContain(
      'href="https://app.example.com/reset-password?token=abc.def"',
    );
    expect(result.html).toContain('60 minutes');
  });

  it('escapes a username containing a script tag in the html output, but not in the text output', () => {
    const result = passwordResetMail({
      username: '<script>alert(1)</script>',
      resetUrl: 'https://app.example.com/reset-password?token=xyz.123',
      expiresInMinutes: 60,
    });

    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.text).toContain('<script>alert(1)</script>');
  });
});
