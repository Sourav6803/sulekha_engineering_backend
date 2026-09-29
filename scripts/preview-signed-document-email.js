// scripts/preview-signed-document-email.js
/**
 * Render the signed-copy email to a single HTML file, so the wording and the
 * decoration can be looked at in a browser without sending mail.
 *
 * The same builder the mailer uses is called here with sample data — nothing is
 * mocked, so what this shows is what an agent's inbox shows. The two cases are
 * both rendered: the pair complete, and the quotation on its own, because they
 * say different things on purpose.
 *
 * Usage: node scripts/preview-signed-document-email.js [outputFile]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSignedDocumentFiledEmail } from '../src/services/email.service.js';
import { buildSignedDocumentNotice } from '../src/data/signedDocumentNotice.js';
import { DEFAULT_PROFILE } from '../src/models/CompanyProfile.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');
const REPO = path.resolve(BACKEND, '..');
const LOGO = path.join(BACKEND, 'assets', 'sulekha-logo.jpeg');

const outFile = path.resolve(process.argv[2] || path.join(REPO, 'signed-document-email-preview.html'));

const SAMPLE = {
  consumerName: 'Raj Kumar Dawn',
  applicationNo: 'SE/APP/2026-0004',
  agentName: 'Sourav Bhukta',
  filedAt: new Date(),
  applicationUrl: 'http://localhost:3000/applications/6ab7f555376b7d422e21f502',
};

const CASES = [
  { title: 'Both on file — the office has finished the paperwork', kinds: ['signedQuotation', 'signedAgreement'] },
  { title: 'Quotation alone — the agreement is still to come', kinds: ['signedQuotation'] },
];

/** The email shell is a whole document; only its body belongs in the preview page. */
const bodyOf = (html) => html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;

/** Point the inline logo at the file on disk, which a browser can actually load. */
const withLogo = (html) => {
  const relative = path.relative(path.dirname(outFile), LOGO).replace(/\\/g, '/');
  return html.replace(/cid:sulekha-logo/g, relative);
};

const sections = CASES.map(({ title, kinds }) => {
  const notice = buildSignedDocumentNotice({ ...SAMPLE, kinds });
  const { subject, html, text } = buildSignedDocumentFiledEmail({
    notice,
    ...SAMPLE,
    company: DEFAULT_PROFILE,
  });

  return `
  <section style="margin:0 0 44px;">
    <p style="margin:0 0 6px;font:600 12px/1.5 ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A7A64;">${title}</p>
    <p style="margin:0 0 14px;font:600 14px/1.6 ui-sans-serif,system-ui,sans-serif;color:#12203A;">
      Subject: ${subject}
    </p>
    <div style="border:1px solid #E3D6C0;border-radius:14px;overflow:hidden;">
      ${withLogo(bodyOf(html)).replace(
        /<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:28px 12px;">/,
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE4;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#2E2013;">'
      )}
    </div>
    <details style="margin-top:10px;font:12px/1.6 ui-sans-serif,system-ui,sans-serif;color:#7A6A56;">
      <summary style="cursor:pointer;">Plain-text fallback (what a mail client without HTML shows)</summary>
      <pre style="white-space:pre-wrap;background:#FBF6EC;border:1px solid #E8DCC8;border-radius:10px;padding:14px 16px;margin:10px 0 0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;">${text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')}</pre>
    </details>
  </section>`;
}).join('');

const page = `<!doctype html>
<html lang="bn">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Signed-copy email — preview</title>
  </head>
  <body style="margin:0;background:#EFE6D8;padding:32px 16px;">
    <div style="max-width:700px;margin:0 auto;">
      <h1 style="margin:0 0 6px;font:700 20px/1.4 ui-sans-serif,system-ui,sans-serif;color:#12203A;">
        Signed-copy email &mdash; preview
      </h1>
      <p style="margin:0 0 30px;font:13px/1.7 ui-sans-serif,system-ui,sans-serif;color:#6B5B47;">
        Rendered by <code>scripts/preview-signed-document-email.js</code> from the same builder the
        mailer uses. Sample consumer, sample application number.
      </p>
      ${sections}
    </div>
  </body>
</html>`;

fs.writeFileSync(outFile, page, 'utf8');
console.log(`Preview written to ${outFile}`);
