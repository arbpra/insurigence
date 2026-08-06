/**
 * Email templates. Premium, inline-styled, table-based HTML that renders
 * consistently across email clients (which don't support external CSS, custom
 * fonts, flexbox, or grid). All layout uses tables; all styles are inlined.
 */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const NAVY = '#07496C';
const INK = '#0D2137';
const MINT = '#00E9B0';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Bulletproof CTA button (table-based for cross-client rendering). */
function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">
    <tr><td align="center" style="border-radius:10px;background-color:${MINT};">
      <a href="${href}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1;color:${NAVY};text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

/** Premium branded shell. `preheader` sets the inbox preview text. */
function layout(opts: { title: string; preheader: string; body: string }): string {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:${FONT};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef2f7;font-size:1px;line-height:1px;">${escapeHtml(opts.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2f7;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

        <!-- Header -->
        <tr><td style="background-color:${NAVY};padding:30px 40px 24px;">
          <span style="font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">Insurigence</span>
          <div style="font-family:${FONT};font-size:11px;letter-spacing:0.12em;color:#8fd6c4;margin-top:4px;">INSURANCE PLACEMENT INTELLIGENCE</div>
        </td></tr>
        <tr><td style="height:4px;line-height:4px;font-size:0;background-color:${MINT};">&nbsp;</td></tr>

        <!-- Body -->
        <tr><td style="padding:38px 40px 34px;">
          <h1 style="margin:0 0 20px;font-family:${FONT};font-size:23px;line-height:1.32;font-weight:700;color:${INK};">${escapeHtml(opts.title)}</h1>
          ${opts.body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:28px 40px 30px;background-color:#f7f9fc;border-top:1px solid #e9eef4;">
          <p style="margin:0 0 6px;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${NAVY};text-align:center;">Insurigence</p>
          <p style="margin:0 0 16px;font-family:${FONT};font-size:13px;color:#64748b;line-height:1.6;text-align:center;">The modern platform for high-performing insurance teams.</p>
          <p style="margin:0;font-family:${FONT};font-size:12px;color:#8a99ad;line-height:1.7;text-align:center;">
            If you weren't expecting this email, you can safely ignore it.<br>
            © ${year} Insurigence. All rights reserved.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Team invite. Contains a one-time link where the invitee sets their OWN
 * password — no password is ever sent by email.
 */
export function inviteEmail(params: {
  inviteeName: string;
  agencyName: string;
  invitedByName: string;
  acceptUrl: string;
  expiresInHours: number;
}): { subject: string; html: string; text: string } {
  const { inviteeName, agencyName, invitedByName, acceptUrl, expiresInHours } = params;
  const subject = `You've been invited to join ${agencyName} on Insurigence`;

  const html = layout({
    title: `You're invited to join ${agencyName}`,
    preheader: `${invitedByName} invited you to join ${agencyName} on Insurigence.`,
    body: `
    <p style="margin:0 0 14px;font-family:${FONT};font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(inviteeName)},
    </p>
    <p style="margin:0 0 24px;font-family:${FONT};font-size:15px;color:#334155;line-height:1.65;">
      ${escapeHtml(invitedByName)} invited you to join <strong style="color:${INK};">${escapeHtml(agencyName)}</strong> on Insurigence.
      Click below to set your password and activate your account.
    </p>
    ${button(acceptUrl, 'Accept Invite & Set Password')}
    <p style="margin:22px 0 14px;font-family:${FONT};font-size:13px;color:#64748b;line-height:1.6;">
      This link expires in ${expiresInHours} hours and can only be used once.
    </p>
    <div style="height:1px;background-color:#eef2f7;margin:6px 0 14px;line-height:1px;font-size:0;">&nbsp;</div>
    <p style="margin:0;font-family:${FONT};font-size:12px;color:#94a3b8;line-height:1.6;word-break:break-all;">
      Button not working? Paste this link into your browser:<br>
      <a href="${acceptUrl}" style="color:#00B383;">${acceptUrl}</a>
    </p>
  `,
  });

  const text = `Hi ${inviteeName},

${invitedByName} invited you to join ${agencyName} on Insurigence.

Set your password and activate your account:
${acceptUrl}

This link expires in ${expiresInHours} hours and can only be used once.`;

  return { subject, html, text };
}

/**
 * Password reset verification code. The 6-digit code is entered on the reset
 * page — it is never a clickable link, and expires quickly.
 */
export function passwordResetEmail(params: {
  firstName: string | null;
  code: string;
  expiresInMinutes: number;
}): { subject: string; html: string; text: string } {
  const { firstName, code, expiresInMinutes } = params;
  const subject = 'Your Insurigence password reset code';

  const html = layout({
    title: 'Reset your password',
    preheader: `Your Insurigence verification code is ${code}. It expires in ${expiresInMinutes} minutes.`,
    body: `
    <p style="margin:0 0 22px;font-family:${FONT};font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName || 'there')}, use the verification code below to reset your Insurigence password.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 22px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="background-color:#F1F5F9;border:1px solid #e2e8f0;border-radius:12px;padding:18px 30px;">
            <span style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:12px;color:${NAVY};">${escapeHtml(code)}</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
    <p style="margin:0;font-family:${FONT};font-size:13px;color:#64748b;line-height:1.6;">
      This code expires in <strong>${expiresInMinutes} minutes</strong>. If you didn't request a password reset, you can safely ignore this email — your password won't change.
    </p>
  `,
  });

  const text = `Hi ${firstName || 'there'},

Your Insurigence password reset code is: ${code}

It expires in ${expiresInMinutes} minutes. If you didn't request this, you can ignore this email.`;

  return { subject, html, text };
}

interface ContactData {
  name: string;
  email: string;
  company?: string;
  message: string;
}

/** Notification sent to the admin/team when someone submits the contact form. */
export function contactAdminEmail(data: ContactData): { subject: string; html: string; text: string } {
  const subject = `New contact form submission from ${data.name}`;
  const html = layout({
    title: 'New contact submission',
    preheader: `${data.name} (${data.email}) sent a message via the website.`,
    body: `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #eef2f7;border-radius:12px;overflow:hidden;margin:0 0 22px;">
      <tr>
        <td style="padding:12px 18px;background-color:#f8fafc;width:120px;font-family:${FONT};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#94a3b8;font-weight:700;">Name</td>
        <td style="padding:12px 18px;font-family:${FONT};font-size:14px;color:${INK};border-bottom:1px solid #eef2f7;">${escapeHtml(data.name)}</td>
      </tr>
      <tr>
        <td style="padding:12px 18px;background-color:#f8fafc;font-family:${FONT};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#94a3b8;font-weight:700;border-top:1px solid #eef2f7;">Email</td>
        <td style="padding:12px 18px;font-family:${FONT};font-size:14px;border-bottom:1px solid #eef2f7;border-top:1px solid #eef2f7;"><a href="mailto:${escapeHtml(data.email)}" style="color:#00B383;text-decoration:none;">${escapeHtml(data.email)}</a></td>
      </tr>
      ${data.company ? `<tr>
        <td style="padding:12px 18px;background-color:#f8fafc;font-family:${FONT};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#94a3b8;font-weight:700;border-top:1px solid #eef2f7;">Company</td>
        <td style="padding:12px 18px;font-family:${FONT};font-size:14px;color:${INK};border-top:1px solid #eef2f7;">${escapeHtml(data.company)}</td>
      </tr>` : ''}
    </table>
    <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#94a3b8;font-weight:700;">Message</p>
    <div style="background-color:#f8fafc;border-left:3px solid ${MINT};border-radius:0 8px 8px 0;padding:14px 18px;">
      <p style="margin:0;font-family:${FONT};font-size:14px;color:#334155;line-height:1.65;white-space:pre-line;">${escapeHtml(data.message)}</p>
    </div>
    <p style="margin:20px 0 0;font-family:${FONT};font-size:12px;color:#94a3b8;line-height:1.6;">Reply directly to ${escapeHtml(data.name)} at <a href="mailto:${escapeHtml(data.email)}" style="color:#00B383;text-decoration:none;">${escapeHtml(data.email)}</a>.</p>
  `,
  });
  const text = `New contact form submission

Name: ${data.name}
Email: ${data.email}${data.company ? `\nCompany: ${data.company}` : ''}

Message:
${data.message}`;
  return { subject, html, text };
}

/** Confirmation sent back to the person who submitted the contact form. */
export function contactConfirmationEmail(data: ContactData): { subject: string; html: string; text: string } {
  const subject = 'We received your message — Insurigence';
  const html = layout({
    title: 'Thanks for reaching out',
    preheader: "We've received your message and will get back to you shortly.",
    body: `
    <p style="margin:0 0 14px;font-family:${FONT};font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(data.name)},
    </p>
    <p style="margin:0 0 22px;font-family:${FONT};font-size:15px;color:#334155;line-height:1.65;">
      Thanks for contacting Insurigence — we've received your message and a member of our team will get back to you shortly.
    </p>
    <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#94a3b8;font-weight:700;">Your message</p>
    <div style="background-color:#f8fafc;border-left:3px solid ${MINT};border-radius:0 8px 8px 0;padding:14px 18px;">
      <p style="margin:0;font-family:${FONT};font-size:14px;color:#64748b;line-height:1.65;white-space:pre-line;">${escapeHtml(data.message)}</p>
    </div>
  `,
  });
  const text = `Hi ${data.name},

Thanks for contacting Insurigence — we've received your message and will get back to you shortly.

Your message:
${data.message}`;
  return { subject, html, text };
}
