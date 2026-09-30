// src/services/email.service.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { DEFAULT_PROFILE } from '../models/CompanyProfile.js';

/**
 * Outgoing email.
 *
 * Every send is best-effort: creating an agent must succeed even when SMTP is
 * misconfigured, disabled or momentarily down, otherwise the admin is left with
 * no agent and no explanation. A failed send returns `{ sent: false, reason }`
 * and the caller decides what to tell the operator — in the agent-invite flow
 * the password is handed back in the API response so it can be shared manually.
 */

const { dirname: dirOf } = path;
const HERE = dirOf(fileURLToPath(import.meta.url));

/**
 * The company logo lives beside the app rather than on a CDN, so it is attached
 * inline (Content-ID) instead of linked. A linked image would be blocked by
 * Gmail until the recipient clicks "show images", and the header would land as a
 * broken icon — the first thing a new agent sees.
 */
const LOGO_PATH = path.resolve(HERE, '../../assets/sulekha-logo.jpeg');
const LOGO_CID = 'sulekha-logo';

/**
 * How long a send may take before it is given up on.
 *
 * A host that blocks outbound mail ports does not *refuse* the connection, it
 * drops it — so these values, not the mail server, decide how long the operator
 * waits. Nodemailer's own defaults are 30s for DNS, 2 minutes for the connection,
 * 30s for the greeting and 10 minutes for an idle socket; that is how "Create
 * agent" turned into a two-minute hang that ended with no email and no clue.
 * Long enough for a real relay to answer, short enough to fail while the admin is
 * still looking at the screen.
 */
const EMAIL_TIMEOUTS = {
  dns: 10 * 1000,
  connection: 10 * 1000,
  greeting: 10 * 1000,
  socket: 20 * 1000,
};

/**
 * The errno codes an unreachable or filtered mail port produces.
 */
const SMTP_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPROTOCOL',
]);

/**
 * "connect ETIMEDOUT 142.250.192.109:465" tells an operator nothing about what to
 * do next, and this is the failure they will actually see: a host that blocks
 * outbound SMTP accepts no connection and the send dies on the timeout. The
 * original message is kept — it is the evidence — and the likely cause is added
 * after it.
 *
 * @param {Error} error
 * @returns {String} a reason fit to show the operator
 */
export const explainSendFailure = (error) => {
  const message = (error && error.message) || 'unknown error';
  const code = error && error.code;
  if (!SMTP_NETWORK_CODES.has(code)) return message;

  const parts = [message];

  // Nodemailer resolves both families and keeps the unused one as a fallback, so
  // this code describes the *last* attempt rather than the first: the IPv4 attempt
  // before it is what timed out. Saying so avoids a hunt for an IPv6
  // misconfiguration that is not why the mail cannot leave.
  //
  // The message is checked as well as the code because nodemailer reports its own
  // wrapper code — a live failure arrived as `ESOCKET` carrying
  // `connect ENETUNREACH 2607:...:465`.
  if (code === 'ENETUNREACH' || /ENETUNREACH/.test(message)) {
    parts.push(
      'That address is IPv6 and this host has no route to it; the IPv4 attempt before it was ' +
        'dropped or timed out.'
    );
  }

  parts.push(
    'Outbound SMTP (ports 25/465/587) is commonly blocked on managed hosts — send through an ' +
      'HTTPS email API, or through a relay that also listens on port 2525.'
  );

  return parts.join(' ');
};

let transporter = null;
let transporterConfigKey = null;

/** True when we have enough configuration to attempt a send. */
export const isEmailConfigured = () =>
  Boolean(config.SMTP_HOST && config.SMTP_PORT && config.SMTP_USER && config.SMTP_PASSWORD);

/** True when sends are switched on *and* configured. */
export const isEmailEnabled = () => config.EMAIL_ENABLED === true && isEmailConfigured();

/** `https://x.vercel.app/` and `https://x.vercel.app` are the same place to link to. */
const stripTrailingSlash = (value) => String(value ?? '').replace(/\/+$/, '');

const isLocalhost = (value) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(value ?? '').trim());

/**
 * Where the "log in here" link in an email should point.
 *
 * `CLIENT_URL` first, then the first `CORS_ORIGIN` entry that is not localhost,
 * then localhost as the last resort.
 *
 * The middle step is the point. `CORS_ORIGIN` is a list whose first entry is
 * `http://localhost:3000`, because that is what development needs — so taking `[0]`
 * put a link to a developer's own machine into every welcome email an agent
 * received, which is useless from a phone. A deployed instance had exactly that:
 * `CLIENT_URL` unset and `CORS_ORIGIN` starting with localhost.
 */
const resolveAppUrl = () => {
  const explicit = config.CLIENT_URL || config.FRONTEND_URL || config.APP_URL;
  if (explicit) return stripTrailingSlash(explicit);

  const origins = (Array.isArray(config.CORS_ORIGIN) ? config.CORS_ORIGIN : [config.CORS_ORIGIN])
    .map((value) => String(value ?? '').trim())
    // A wildcard origin is useless in a link.
    .filter((value) => value && value !== '*');

  const reachable = origins.find((origin) => !isLocalhost(origin));

  return stripTrailingSlash(reachable || origins[0] || '') || 'http://localhost:3000';
};

export const getAppUrl = resolveAppUrl;

/**
 * Build (and cache) the SMTP transport.
 *
 * The cache key includes host/port/user so a changed .env does not keep reusing
 * a transport pointed at the old server — which is exactly what happens when
 * someone flips from a test account to the real one and reloads.
 */
const getTransporter = () => {
  if (!isEmailConfigured()) return null;

  const key = [config.SMTP_HOST, config.SMTP_PORT, config.SMTP_USER, config.SMTP_SECURE].join('|');
  if (transporter && transporterConfigKey === key) return transporter;

  const options = {
    host: config.SMTP_HOST,
    port: Number(config.SMTP_PORT) || 587,
    // 465 is implicit TLS, 587 is STARTTLS. SMTP_SECURE in .env wins; otherwise
    // infer from the port so a missing flag cannot silently downgrade to plain.
    secure: config.SMTP_SECURE === true || Number(config.SMTP_PORT) === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASSWORD,
    },
  };

  options.dnsTimeout = EMAIL_TIMEOUTS.dns;
  options.connectionTimeout = EMAIL_TIMEOUTS.connection;
  options.greetingTimeout = EMAIL_TIMEOUTS.greeting;
  options.socketTimeout = EMAIL_TIMEOUTS.socket;

  if (config.SMTP_SERVICE) options.service = config.SMTP_SERVICE;

  transporter = nodemailer.createTransport(options);
  transporterConfigKey = key;

  logger.info(
    { host: options.host, port: options.port, secure: options.secure, service: options.service },
    'Email transport configured'
  );

  return transporter;
};

/**
 * Send one message.
 *
 * @returns {Promise<{sent: boolean, messageId?: string, reason?: string, skipped?: boolean}>}
 */
export const sendMail = async ({ to, subject, html, text, replyTo, cc, bcc, attachments } = {}) => {
  if (!to) return { sent: false, reason: 'no-recipient' };

  if (!isEmailEnabled()) {
    const reason = config.EMAIL_ENABLED !== true ? 'email-disabled' : 'email-not-configured';
    logger.warn({ to, subject, reason }, 'Email not sent');
    return { sent: false, reason, skipped: true };
  }

  try {
    const info = await getTransporter().sendMail({
      from: config.SMTP_FROM || config.SMTP_USER,
      to,
      cc,
      bcc,
      replyTo: replyTo || config.SMTP_FROM,
      subject,
      text,
      html,
      attachments,
    });

    logger.info({ to, subject, messageId: info.messageId }, 'Email sent');

    return { sent: true, messageId: info.messageId };
  } catch (error) {
    // Never rethrow: a bounced welcome email must not roll back an agent that
    // the database has already created.
    logger.error({ to, subject, code: error.code, err: error.message }, 'Email send failed');
    return { sent: false, reason: explainSendFailure(error) };
  }
};

/**
 * Check the SMTP credentials without sending anything. Useful from a health or
 * setup screen; deliberately not called during boot so a slow mail server cannot
 * delay startup.
 */
export const verifyEmailTransport = async () => {
  if (!isEmailConfigured()) {
    return { ok: false, reason: config.EMAIL_ENABLED !== true ? 'email-disabled' : 'email-not-configured' };
  }

  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: explainSendFailure(error) };
  }
};

// ============================================================
// COMPANY DETAILS
// ============================================================

/**
 * Footer details. Read from the CompanyProfile singleton — the same source the
 * quotation and agreement PDFs use — so a phone number or address changed in
 * settings does not stay stale in every outgoing email. Falls back to the
 * seeded defaults when the database is unreachable, because an email that goes
 * out with a slightly old address beats one that fails to send at all.
 */
const getCompany = async () => {
  try {
    const { default: CompanyProfile } = await import('../models/CompanyProfile.js');
    const profile = await CompanyProfile.getProfile();
    return {
      name: profile?.name || DEFAULT_PROFILE.name,
      addressLines: profile?.addressLines?.length ? profile.addressLines : DEFAULT_PROFILE.addressLines,
      phone: profile?.phone || DEFAULT_PROFILE.phone,
      email: profile?.email || DEFAULT_PROFILE.email,
      gstn: profile?.gstn || DEFAULT_PROFILE.gstn,
      discom: profile?.discom || '',
    };
  } catch (error) {
    logger.warn({ err: error.message }, 'Company profile unavailable, using defaults for the email footer');
    return {
      name: DEFAULT_PROFILE.name,
      addressLines: DEFAULT_PROFILE.addressLines,
      phone: DEFAULT_PROFILE.phone,
      email: DEFAULT_PROFILE.email,
      gstn: DEFAULT_PROFILE.gstn,
      discom: '',
    };
  }
};

const TAGLINE = 'Powering a greener tomorrow';

// ============================================================
// TEMPLATES
// ============================================================

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** True when the logo file is present, so the header degrades to text if not. */
export const hasLogoAsset = () => {
  try {
    return fs.existsSync(LOGO_PATH);
  } catch {
    return false;
  }
};

/** The inline logo attachment, or an empty list when the file is missing. */
const logoAttachment = () =>
  hasLogoAsset()
    ? [
        {
          filename: 'sulekha-engineering-logo.jpeg',
          path: LOGO_PATH,
          cid: LOGO_CID,
          contentDisposition: 'inline',
        },
      ]
    : [];

/**
 * Shared shell: branded header with the logo, the body, and a footer carrying
 * the real company details.
 *
 * Written with tables and inline styles because that is the only layout model
 * Outlook and Gmail agree on — a flexbox header collapses in Outlook.
 */
const layout = ({ company, heading, bodyHtml, preheader = '' }) => {
  const addressLine = (company.addressLines || []).join(', ');
  const logo = hasLogoAsset();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F5EFE4;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2E2013;">
    <!-- Inbox preview line, hidden in the body -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#FFFFFF;border:1px solid #E8DCC8;border-radius:18px;overflow:hidden;">

            <!-- ===== HEADER ===== -->
            <tr>
              <td style="background:#12203A;padding:22px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    ${
                      logo
                        ? `<td width="58" valign="middle" style="padding-right:14px;">
                             <img src="cid:${LOGO_CID}" alt="${escapeHtml(company.name)}" width="52" height="52"
                                  style="display:block;width:52px;height:52px;border-radius:10px;background:#FFFFFF;" />
                           </td>`
                        : ''
                    }
                    <td valign="middle">
                      <div style="font-size:19px;font-weight:700;color:#FFFFFF;letter-spacing:0.3px;line-height:1.25;">
                        ${escapeHtml(company.name)}
                      </div>
                      <div style="font-size:11px;color:#AFC0DA;margin-top:5px;letter-spacing:1.1px;text-transform:uppercase;">
                        PM Surya Ghar &mdash; Authorised Vendor
                      </div>
                      <div style="font-size:11px;color:#7E93B5;margin-top:3px;letter-spacing:0.7px;text-transform:uppercase;">
                        ${escapeHtml(TAGLINE)}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Sunrise rule under the header -->
            <tr>
              <td style="height:4px;background:#EA8A3B;line-height:4px;font-size:0;">&nbsp;</td>
            </tr>

            <!-- ===== BODY ===== -->
            <tr>
              <td style="padding:30px 30px 26px;">
                <h1 style="margin:0 0 18px;font-size:21px;line-height:1.35;color:#12203A;font-weight:700;">
                  ${escapeHtml(heading)}
                </h1>
                ${bodyHtml}
              </td>
            </tr>

            <!-- ===== FOOTER ===== -->
            <tr>
              <td style="background:#FBF6EC;border-top:1px solid #E8DCC8;padding:20px 30px 22px;">
                <div style="font-size:13px;font-weight:700;color:#12203A;letter-spacing:0.4px;">
                  ${escapeHtml(company.name)}
                </div>
                <div style="font-size:12px;color:#7A6A56;line-height:1.7;margin-top:6px;">
                  ${escapeHtml(addressLine)}<br />
                  Phone: ${escapeHtml(company.phone)} &nbsp;&middot;&nbsp;
                  <a href="mailto:${escapeHtml(company.email)}" style="color:#C96F22;text-decoration:none;">${escapeHtml(company.email)}</a>
                  ${company.gstn ? `<br />GSTN: ${escapeHtml(company.gstn)}` : ''}
                  ${company.discom ? ` &nbsp;&middot;&nbsp; DISCOM: ${escapeHtml(company.discom)}` : ''}
                </div>
                <div style="margin-top:14px;padding-top:12px;border-top:1px solid #EFE4D2;font-size:11px;color:#9A8B78;line-height:1.6;">
                  PM Surya Ghar Muft Bijli Yojana &mdash; Authorised Vendor<br />
                  This is an automated message from the Sulekha Engineering portal; please do not reply to it.
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

/** A credential row, rendered as a label + monospace value. */
const credentialRow = (label, value) => `
  <tr>
    <td style="padding:9px 0;font-size:12px;color:#7A6A56;width:150px;vertical-align:top;letter-spacing:0.3px;">${escapeHtml(label)}</td>
    <td style="padding:9px 0;font-size:15px;font-weight:700;color:#12203A;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;">${escapeHtml(value)}</td>
  </tr>`;

/** Left-accented quote block used for the motivational line. */
const motivationBlock = (quote, attribution) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;background:#FFF7EA;border-left:4px solid #EA8A3B;border-radius:0 12px 12px 0;">
    <tr>
      <td style="padding:16px 20px;">
        <div style="font-size:14px;line-height:1.7;color:#4A3A28;font-style:italic;">${escapeHtml(quote)}</div>
        <div style="font-size:11px;color:#9A8B74;margin-top:9px;letter-spacing:0.4px;">${escapeHtml(attribution)}</div>
      </td>
    </tr>
  </table>`;

/** A label/value line in a details box, in the normal (not monospace) face. */
const detailRow = (label, value) => `
  <tr>
    <td style="padding:8px 0;font-size:12px;color:#7A6A56;width:150px;vertical-align:top;letter-spacing:0.3px;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;font-size:14px;font-weight:700;color:#12203A;">${escapeHtml(value)}</td>
  </tr>`;

/** Numbered "what happens next" list. */
const stepsBlock = (steps) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
    ${steps
      .map(
        (step, index) => `
      <tr>
        <td width="26" valign="top" style="padding:5px 0;font-size:13px;font-weight:700;color:#EA8A3B;">${index + 1}.</td>
        <td style="padding:5px 0;font-size:13px;line-height:1.65;color:#4A3A28;">${step}</td>
      </tr>`
      )
      .join('')}
  </table>`;

const ctaButton = (url, label) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
    <tr>
      <td style="border-radius:11px;background:#EA8A3B;">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 26px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.2px;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;

/**
 * The welcome mail an agent receives when an admin creates their account.
 * Carries the login credentials and tells them to change the password.
 */
export const sendAgentWelcomeEmail = async ({ name, email, password, employeeId } = {}) => {
  const company = await getCompany();
  const appUrl = resolveAppUrl();
  const loginUrl = `${appUrl}/login`;
  const firstName = String(name || 'Agent').trim().split(/\s+/)[0];

  const bodyHtml = `
    <p style="margin:0 0 15px;font-size:14px;line-height:1.7;">Dear ${escapeHtml(firstName)},</p>

    <p style="margin:0 0 15px;font-size:14px;line-height:1.7;">
      <strong>Congratulations!</strong> You have successfully been onboarded as an
      <strong>Agent</strong> at ${escapeHtml(company.name)}.
    </p>

    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;">
      Your agent dashboard is ready. From here you will manage the consumers you sign up,
      file their PM Surya Ghar applications and collect the documents at their doorstep.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EC;border:1px solid #E8DCC8;border-radius:13px;">
      <tr>
        <td style="padding:10px 22px 14px;">
          <div style="font-size:11px;letter-spacing:1.1px;text-transform:uppercase;color:#9A8B74;padding:8px 0 2px;">Your login details</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${credentialRow('Login email', email)}
            ${credentialRow('Temporary password', password)}
            ${employeeId ? credentialRow('Employee ID', employeeId) : ''}
          </table>
        </td>
      </tr>
    </table>

    ${ctaButton(loginUrl, 'Sign in to your dashboard')}

    ${stepsBlock([
      'Sign in with the email and temporary password above.',
      'Open <strong>Change password</strong> and set a password only you know.',
      'Start filing consumer applications from the agent dashboard.',
    ])}

    ${motivationBlock(
      'Every rooftop you sign up is clean power that a family will use for the next 25 years. PM Surya Ghar is aiming for one crore homes — and each consumer you bring on board is one more step towards it.',
      `Welcome to the team. — ${company.name}`
    )}

    <p style="margin:22px 0 8px;font-size:13px;line-height:1.7;color:#7A6A56;">
      <strong style="color:#12203A;">For your security</strong> &mdash; this is a temporary password.
      Please change it right after your first sign-in and do not share it with anyone.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.7;color:#9A8B78;">
      Button not working? Open this link:<br />
      <a href="${escapeHtml(loginUrl)}" style="color:#C96F22;">${escapeHtml(loginUrl)}</a>
    </p>
  `;

  const text = [
    `Dear ${firstName},`,
    '',
    `Congratulations! You have successfully been onboarded as an Agent at ${company.name}.`,
    '',
    'Your login details:',
    `  Login email: ${email}`,
    `  Temporary password: ${password}`,
    employeeId ? `  Employee ID: ${employeeId}` : '',
    '',
    `Sign in here: ${loginUrl}`,
    '',
    'Next steps:',
    '  1. Sign in with the details above.',
    '  2. Open "Change password" and set a password only you know.',
    '  3. Start filing consumer applications from the agent dashboard.',
    '',
    'Every rooftop you sign up is clean power a family will use for the next 25 years.',
    'PM Surya Ghar is aiming for one crore homes - each consumer you bring on board is one more step towards it.',
    '',
    `-- ${company.name}`,
    (company.addressLines || []).join(', '),
    `Phone: ${company.phone} | ${company.email}`,
    company.gstn ? `GSTN: ${company.gstn}` : '',
    '',
    'This is an automated message; please do not reply.',
  ]
    .filter(Boolean)
    .join('\n');

  return sendMail({
    to: email,
    subject: `Congratulations ${firstName} — your ${company.name} agent account is ready`,
    html: layout({
      company,
      heading: 'Welcome aboard, Agent',
      bodyHtml,
      preheader: `Your agent dashboard is ready. Login email and temporary password inside.`,
    }),
    text,
    attachments: logoAttachment(),
  });
};

/**
 * Sent when an admin resets an agent's password from the office.
 */
export const sendAgentPasswordResetEmail = async ({ name, email, password } = {}) => {
  const company = await getCompany();
  const loginUrl = `${resolveAppUrl()}/login`;
  const firstName = String(name || 'Agent').trim().split(/\s+/)[0];

  const bodyHtml = `
    <p style="margin:0 0 15px;font-size:14px;line-height:1.7;">Dear ${escapeHtml(firstName)},</p>

    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;">
      Your ${escapeHtml(company.name)} agent password has been reset by the office.
      Use the new temporary password below to sign in, then set your own.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EC;border:1px solid #E8DCC8;border-radius:13px;">
      <tr>
        <td style="padding:10px 22px 14px;">
          <div style="font-size:11px;letter-spacing:1.1px;text-transform:uppercase;color:#9A8B74;padding:8px 0 2px;">Your new login details</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${credentialRow('Login email', email)}
            ${credentialRow('New temporary password', password)}
          </table>
        </td>
      </tr>
    </table>

    ${ctaButton(loginUrl, 'Sign in and set your password')}

    <p style="margin:22px 0 8px;font-size:13px;line-height:1.7;color:#7A6A56;">
      If you did not ask for this, contact the office on ${escapeHtml(company.phone)} immediately.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.7;color:#9A8B78;">
      Button not working? Open this link:<br />
      <a href="${escapeHtml(loginUrl)}" style="color:#C96F22;">${escapeHtml(loginUrl)}</a>
    </p>
  `;

  const text = [
    `Dear ${firstName},`,
    '',
    'Your agent password has been reset by the office.',
    '',
    `  Login email: ${email}`,
    `  New temporary password: ${password}`,
    '',
    `Sign in here: ${loginUrl}`,
    '',
    `If you did not ask for this, contact the office on ${company.phone} immediately.`,
    '',
    `-- ${company.name}`,
    'This is an automated message; please do not reply.',
  ].join('\n');

  return sendMail({
    to: email,
    subject: `Your ${company.name} password has been reset`,
    html: layout({
      company,
      heading: 'Password reset',
      bodyHtml,
      preheader: 'Your new temporary password is inside.',
    }),
    text,
    attachments: logoAttachment(),
  });
};

/**
 * The mail an agent gets when the office files the consumer's signed quotation
 * or agreement.
 *
 * Bengali throughout — the wording comes from `data/signedDocumentNotice.js`, so
 * the email and the in-app notification cannot drift apart. Split from the send
 * itself (`build…` vs `send…`) so the rendered result can be asserted in tests
 * and previewed without an SMTP round trip.
 */
export const buildSignedDocumentFiledEmail = ({
  notice,
  consumerName,
  applicationNo,
  agentName,
  filedAt,
  applicationUrl,
  company,
} = {}) => {
  const firstName = String(agentName || 'Agent').trim().split(/\s+/)[0];
  const when = filedAt ? new Date(filedAt) : new Date();
  const filedOn = when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const subject = notice?.emailSubject || `${consumerName} — স্বাক্ষরিত নথি আপলোড হয়েছে`;

  const bodyHtml = `
    <p style="margin:0 0 15px;font-size:14px;line-height:1.85;">প্রিয় ${escapeHtml(firstName)},</p>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.85;">${notice.emailIntro}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EC;border:1px solid #E8DCC8;border-radius:13px;">
      <tr>
        <td style="padding:10px 22px 14px;">
          <div style="font-size:11px;letter-spacing:1.1px;text-transform:uppercase;color:#9A8B74;padding:8px 0 2px;">আবেদনের বিবরণ</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${detailRow('গ্রাহকের নাম', consumerName || '—')}
            ${detailRow('আবেদন নম্বর', applicationNo || '—')}
            ${detailRow('আপলোড করা নথি', notice.label || 'স্বাক্ষরিত নথি')}
            ${detailRow('আপলোডের তারিখ', filedOn)}
          </table>
        </td>
      </tr>
    </table>

    ${ctaButton(applicationUrl, 'আবেদনটি খুলে ডাউনলোড করুন')}

    ${stepsBlock(notice.steps)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;background:#FFF7EA;border-left:4px solid #EA8A3B;border-radius:0 12px 12px 0;">
      <tr>
        <td style="padding:16px 20px;">
          <div style="font-size:13px;line-height:1.85;color:#4A3A28;">
            শেয়ার করার আগে ফাইলটি একবার দেখে নিন &mdash; গ্রাহকের নাম, সিস্টেমের সাইজ এবং টাকার অঙ্ক ঠিক আছে কি না।
          </div>
        </td>
      </tr>
    </table>

    <p style="margin:22px 0 8px;font-size:13px;line-height:1.85;color:#7A6A56;">
      ডাউনলোড করা না গেলে অফিসে জানান &mdash; ${escapeHtml(company?.phone || '')}
    </p>
    <p style="margin:0;font-size:12px;line-height:1.85;color:#9A8B78;">
      বোতাম কাজ না করলে এই লিঙ্কটি খুলুন:<br />
      <a href="${escapeHtml(applicationUrl)}" style="color:#C96F22;word-break:break-all;">${escapeHtml(applicationUrl)}</a>
    </p>
  `;

  const text = [
    `প্রিয় ${firstName},`,
    '',
    notice.emailIntroText,
    '',
    `গ্রাহকের নাম: ${consumerName || '-'}`,
    `আবেদন নম্বর: ${applicationNo || '-'}`,
    `আপলোড করা নথি: ${notice.label || 'স্বাক্ষরিত নথি'}`,
    `আপলোডের তারিখ: ${filedOn}`,
    '',
    `আবেদনটি খুলুন: ${applicationUrl}`,
    '',
    'পরের কাজ:',
    ...notice.stepsText.map((step, index) => `  ${index + 1}. ${step}`),
    '',
    'শেয়ার করার আগে ফাইলটি একবার দেখে নিন - গ্রাহকের নাম, সিস্টেমের সাইজ এবং টাকার অঙ্ক ঠিক আছে কি না।',
    '',
    `-- ${company?.name || ''}`,
    (company?.addressLines || []).join(', '),
    company?.phone ? `ফোন: ${company.phone} | ${company.email}` : '',
    '',
    'এটি একটি স্বয়ংক্রিয় বার্তা; উত্তর দেওয়ার প্রয়োজন নেই।',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    html: layout({
      company,
      heading: notice.emailHeading,
      bodyHtml,
      preheader: `গ্রাহক ${consumerName} — ${notice.label} আপলোড হয়েছে। এখনই ডাউনলোড করুন।`,
    }),
    text,
  };
};

/**
 * Send the signed-copy mail to the agent who owns the application.
 *
 * Best-effort, exactly like the welcome mail: the office's upload has already
 * been stored by the time this runs, and a bounced mailbox must never make the
 * filing look like it failed.
 */
export const sendSignedDocumentFiledEmail = async ({ to, company, ...rest } = {}) => {
  const resolvedCompany = company ?? (await getCompany());
  const { subject, html, text } = buildSignedDocumentFiledEmail({ ...rest, company: resolvedCompany });

  return sendMail({
    to,
    subject,
    html,
    text,
    attachments: logoAttachment(),
  });
};

/**
 * The mail the office gets when a field agent files an application — either
 * opens a draft on one or submits a finished one.
 *
 * Bengali throughout, like the agent-facing signed-copy mail, and for the same
 * reason: the wording comes from `data/newApplicationNotice.js`, so the email and
 * the in-app notification cannot drift apart. Split from the send itself
 * (`build…` vs `send…`) so the rendered result can be asserted in tests and
 * previewed without an SMTP round trip.
 *
 * `stage` picks between the two shapes. A draft is a heads-up and says so — the
 * office was explicit that they did not want to be made to act on a half-filled
 * form. A submission is the one that asks for the work to be taken up quickly.
 */
export const buildNewApplicationEmail = ({
  notice,
  recipientName,
  consumerName,
  applicationNo,
  agentName,
  systemSizeKW,
  district,
  filedAt,
  applicationUrl,
  company,
} = {}) => {
  const firstName = String(recipientName || '').trim().split(/\s+/)[0];
  const when = filedAt ? new Date(filedAt) : new Date();
  const filedOn = when.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const isDraft = notice?.stage === 'started';
  const size = Number(systemSizeKW) > 0 ? `${Number(systemSizeKW)} কিলোওয়াট` : null;

  const bodyHtml = `
    <p style="margin:0 0 15px;font-size:14px;line-height:1.85;">প্রিয় ${escapeHtml(firstName || 'স্যার')},</p>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.85;">${notice.emailIntro}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EC;border:1px solid #E8DCC8;border-radius:13px;">
      <tr>
        <td style="padding:10px 22px 14px;">
          <div style="font-size:11px;letter-spacing:1.1px;text-transform:uppercase;color:#9A8B74;padding:8px 0 2px;">আবেদনের বিবরণ</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${detailRow('গ্রাহকের নাম', consumerName || '—')}
            ${detailRow('আবেদন নম্বর', applicationNo || '—')}
            ${detailRow('ফিল্ড এজেন্ট', agentName || '—')}
            ${size ? detailRow('সিস্টেম সাইজ', size) : ''}
            ${district ? detailRow('জেলা', district) : ''}
            ${detailRow(isDraft ? 'শুরু করার সময়' : 'জমা দেওয়ার সময়', filedOn)}
            ${detailRow('অবস্থা', isDraft ? 'ড্রাফট (এখনও জমা পড়েনি)' : 'জমা পড়েছে — যাচাইয়ের অপেক্ষায়')}
          </table>
        </td>
      </tr>
    </table>

    ${ctaButton(applicationUrl, 'আবেদনটি খুলুন')}

    ${stepsBlock(notice.steps)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;background:#FFF7EA;border-left:4px solid #EA8A3B;border-radius:0 12px 12px 0;">
      <tr>
        <td style="padding:16px 20px;">
          <div style="font-size:13px;line-height:1.85;color:#4A3A28;">
            ${
              isDraft
                ? 'এটি একটি প্রাথমিক বার্তা — আবেদনটি এখনও ড্রাফট। এজেন্ট চূড়ান্ত জমা দিলে আপনাকে আলাদা করে জানানো হবে।'
                : 'এই আবেদনটি যাচাইয়ের জন্য অপেক্ষা করছে &mdash; দ্রুত প্রক্রিয়া করলে গ্রাহকের পরের ধাপটি দেরি হবে না।'
            }
          </div>
        </td>
      </tr>
    </table>

    <p style="margin:22px 0 8px;font-size:13px;line-height:1.85;color:#7A6A56;">
      আবেদনটি খুলতে না পারলে অফিসে জানান &mdash; ${escapeHtml(company?.phone || '')}
    </p>
    <p style="margin:0;font-size:12px;line-height:1.85;color:#9A8B78;">
      বোতাম কাজ না করলে এই লিঙ্কটি খুলুন:<br />
      <a href="${escapeHtml(applicationUrl)}" style="color:#C96F22;word-break:break-all;">${escapeHtml(applicationUrl)}</a>
    </p>
  `;

  const text = [
    `প্রিয় ${firstName || 'স্যার'},`,
    '',
    notice.emailIntroText,
    '',
    `গ্রাহকের নাম: ${consumerName || '-'}`,
    `আবেদন নম্বর: ${applicationNo || '-'}`,
    `ফিল্ড এজেন্ট: ${agentName || '-'}`,
    size ? `সিস্টেম সাইজ: ${size}` : '',
    district ? `জেলা: ${district}` : '',
    `${isDraft ? 'শুরু করার সময়' : 'জমা দেওয়ার সময়'}: ${filedOn}`,
    `অবস্থা: ${isDraft ? 'ড্রাফট (এখনও জমা পড়েনি)' : 'জমা পড়েছে - যাচাইয়ের অপেক্ষায়'}`,
    '',
    `আবেদনটি খুলুন: ${applicationUrl}`,
    '',
    'পরের কাজ:',
    ...notice.stepsText.map((step, index) => `  ${index + 1}. ${step}`),
    '',
    isDraft
      ? 'এটি একটি প্রাথমিক বার্তা - আবেদনটি এখনও ড্রাফট। এজেন্ট চূড়ান্ত জমা দিলে আপনাকে আলাদা করে জানানো হবে।'
      : 'এই আবেদনটি যাচাইয়ের জন্য অপেক্ষা করছে - দ্রুত প্রক্রিয়া করলে গ্রাহকের পরের ধাপটি দেরি হবে না।',
    '',
    `-- ${company?.name || ''}`,
    (company?.addressLines || []).join(', '),
    company?.phone ? `ফোন: ${company.phone} | ${company.email}` : '',
    '',
    'এটি একটি স্বয়ংক্রিয় বার্তা; উত্তর দেওয়ার প্রয়োজন নেই।',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject: notice.emailSubject,
    html: layout({
      company,
      heading: notice.emailHeading,
      bodyHtml,
      preheader: isDraft
        ? `এজেন্ট ${agentName || ''} — গ্রাহক ${consumerName || ''}-এর আবেদন শুরু করেছেন (ড্রাফট)।`
        : `গ্রাহক ${consumerName || ''} — নতুন আবেদন জমা পড়েছে। এখনই যাচাই করে প্রক্রিয়া করুন।`,
    }),
    text,
  };
};

/**
 * Send the new-application mail to one office user.
 *
 * Best-effort, exactly like the other sends: the application has already been
 * created or submitted by the time this runs, and a bounced mailbox must never
 * make the agent's save look like it failed.
 */
export const sendNewApplicationEmail = async ({ to, company, ...rest } = {}) => {
  const resolvedCompany = company ?? (await getCompany());
  const { subject, html, text } = buildNewApplicationEmail({ ...rest, company: resolvedCompany });

  return sendMail({
    to,
    subject,
    html,
    text,
    attachments: logoAttachment(),
  });
};

export default {
  sendMail,
  sendAgentWelcomeEmail,
  sendAgentPasswordResetEmail,
  buildSignedDocumentFiledEmail,
  sendSignedDocumentFiledEmail,
  buildNewApplicationEmail,
  sendNewApplicationEmail,
  isEmailEnabled,
  isEmailConfigured,
  verifyEmailTransport,
  getAppUrl,
  hasLogoAsset,
};
