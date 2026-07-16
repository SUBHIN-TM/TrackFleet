import nodemailer from 'nodemailer';

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
  MAIL_FROM, MAIL_FROM_NAME, ADMIN_PORTAL_URL,
} = process.env;

const FROM = `"${MAIL_FROM_NAME || 'TrackFleet'}" <${MAIL_FROM || 'no-reply@trackfleet.local'}>`;
const PORTAL = ADMIN_PORTAL_URL || 'http://localhost:5174';

// Deep-link into the login page with the org id and email prefilled, so the
// admin only types the temporary password. The password is deliberately NOT in
// the link — a URL ends up in browser history and server logs, and a live
// credential must never leak there.
const signInLink = (loginId, email) => {
  const q = new URLSearchParams({ org: loginId, email });
  return `${PORTAL}/login?${q.toString()}`;
};

// Without SMTP_HOST we log instead of sending, so the app still runs for anyone
// who clones it without credentials. Never silently swallow a real send failure.
const enabled = Boolean(SMTP_HOST);

const transport = enabled
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      // 587 is STARTTLS: connect in plaintext, then upgrade. Only port 465 is
      // implicit TLS from the first byte.
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

async function send({ to, subject, text, html }) {
  if (!enabled) {
    console.log(`\n--- EMAIL (SMTP not configured, not sent) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--- end ---\n`);
    return { mocked: true };
  }
  return transport.sendMail({ from: FROM, to, subject, text, html });
}

// Verifies credentials/connectivity at boot so a bad key surfaces on startup
// rather than on a user's first invite.
export async function verifyMailer() {
  if (!enabled) return { ok: false, reason: 'SMTP_HOST not set — emails will be logged to the console' };
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

const shell = (heading, body) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f4f4f8;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:32px">
    <div style="font-size:20px;font-weight:800;color:#1f9d4e;margin-bottom:20px">🚌 TrackFleet</div>
    <h1 style="font-size:20px;margin:0 0 16px">${heading}</h1>
    ${body}
    <p style="color:#8a8a9e;font-size:12px;margin-top:28px;border-top:1px solid #eee;padding-top:16px">
      If you weren’t expecting this email you can ignore it.
    </p>
  </div>
</div>`;

const codeBox = (code) =>
  `<div style="font-size:30px;font-weight:800;letter-spacing:7px;background:#f4f4f8;border-radius:10px;padding:16px;text-align:center;margin:20px 0">${code}</div>`;

// Sent once, when the super admin creates the organization.
export function sendAdminInvite({ to, orgName, loginId, tempPassword }) {
  const link = signInLink(loginId, to);
  return send({
    to,
    subject: `Your TrackFleet login for ${orgName}`,
    text: [
      `${orgName} has been set up on TrackFleet and you have been made an administrator.`,
      ``,
      `Sign in here (your Organization ID and email are filled in for you):`,
      link,
      ``,
      `Organization ID: ${loginId}`,
      `Email: ${to}`,
      `Temporary password: ${tempPassword}`,
      ``,
      `The first time you sign in we'll email you a 6-digit code to confirm this address,`,
      `then you'll choose your own password. This temporary one stops working after that.`,
    ].join('\n'),
    html: shell(`You’ve been added to ${orgName}`, `
      <p style="color:#4a4a5e;line-height:1.6">
        ${orgName} has been set up on TrackFleet and you’ve been made an administrator.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
        <tr><td style="padding:9px 0;color:#8a8a9e">Organization ID</td>
            <td style="padding:9px 0;text-align:right;font-family:ui-monospace,monospace;font-weight:700">${loginId}</td></tr>
        <tr><td style="padding:9px 0;color:#8a8a9e;border-top:1px solid #eee">Email</td>
            <td style="padding:9px 0;text-align:right;border-top:1px solid #eee">${to}</td></tr>
        <tr><td style="padding:9px 0;color:#8a8a9e;border-top:1px solid #eee">Temporary password</td>
            <td style="padding:9px 0;text-align:right;font-family:ui-monospace,monospace;font-weight:700;border-top:1px solid #eee">${tempPassword}</td></tr>
      </table>
      <a href="${link}" style="display:inline-block;background:#1f9d4e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:700">Sign in</a>
      <p style="color:#8a8a9e;font-size:13px;line-height:1.6;margin-top:22px">
        The first time you sign in we’ll email a 6-digit code to confirm this address, then you’ll
        choose your own password. This temporary one stops working after that.
      </p>`),
  });
}

export function sendOtp({ to, code, purpose, minutes }) {
  const reset = purpose === 'RESET_PASSWORD';
  const heading = reset ? 'Reset your password' : 'Confirm your email address';
  const line = reset
    ? 'Use this code to reset your TrackFleet password.'
    : 'Use this code to confirm your email address and finish signing in.';
  return send({
    to,
    subject: `${code} is your TrackFleet ${reset ? 'password reset' : 'verification'} code`,
    text: `${line}\n\nCode: ${code}\n\nIt expires in ${minutes} minutes. If you didn't request it, ignore this email.`,
    html: shell(heading, `
      <p style="color:#4a4a5e;line-height:1.6">${line}</p>
      ${codeBox(code)}
      <p style="color:#8a8a9e;font-size:13px">This code expires in ${minutes} minutes.</p>`),
  });
}
