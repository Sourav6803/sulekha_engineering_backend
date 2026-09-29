// tests/signedDocumentNotice.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import config from '../src/config/env.js';
import { startTestEnv, API_PREFIX } from './helpers/testSetup.js';
import Application from '../src/models/Application.js';
import { Notification, User } from '../src/models/index.js';
import {
  SIGNED_DOCUMENT_LABELS,
  buildSignedDocumentNotice,
  signedKindsOnFile,
  signedSetLabel,
} from '../src/data/signedDocumentNotice.js';
import { documentLabelBn } from '../src/data/applicationChecklist.js';
import { buildSignedDocumentFiledEmail } from '../src/services/email.service.js';
import { notifyAgentOfSignedDocument } from '../src/services/signedDocumentNotice.service.js';

/**
 * The agent is told, in the app and by email, when the office files the
 * consumer's signed quotation or agreement.
 *
 * Three things are worth guarding, and only the first is about the furniture:
 * the notice is addressed to one agent (another agent must not see it, or their
 * co-worker's consumer shows up in their bell), it never claims the paperwork is
 * "done" while only one of the two documents has come back, and neither channel
 * may fail the office's upload.
 */

const COMPANY = {
  name: 'Sulekha Engineering',
  addressLines: ['Station Road, Bardhaman', 'West Bengal 713301'],
  phone: '9876543210',
  email: 'office@sulekha.test',
  gstn: '19ABCDE1234F1Z5',
  discom: 'WBSEDCL',
};

// ===========================================================================
// The wording
// ===========================================================================

test('notice: the names match the checklist the agents carry', () => {
  assert.equal(documentLabelBn('signedQuotation'), SIGNED_DOCUMENT_LABELS.signedQuotation);
  assert.equal(documentLabelBn('signedAgreement'), SIGNED_DOCUMENT_LABELS.signedAgreement);
});

test('notice: with both signed documents on file the pair reads as done', () => {
  const notice = buildSignedDocumentNotice({
    consumerName: 'Raj Kumar Dawn',
    applicationNo: 'SE/APP/2026/0001',
    kinds: ['signedQuotation', 'signedAgreement'],
  });

  assert.equal(notice.complete, true);
  assert.equal(notice.title, 'স্বাক্ষরিত কোটেশন ও চুক্তিপত্র সম্পন্ন হয়েছে');
  assert.match(notice.message, /Raj Kumar Dawn/);
  assert.match(notice.message, /সফলভাবে সম্পন্ন হয়েছে এবং আপলোড করা হয়েছে/);
  assert.match(notice.message, /ডাউনলোড করে গ্রাহকের সাথে শেয়ার করতে পারেন/);
  assert.match(notice.message, /SE\/APP\/2026\/0001/);
});

test('notice: one signed document alone never claims the paperwork is done', () => {
  const notice = buildSignedDocumentNotice({
    consumerName: 'Raj Kumar Dawn',
    applicationNo: 'SE/APP/2026/0001',
    kinds: ['signedQuotation'],
  });

  assert.equal(notice.complete, false);
  assert.equal(notice.title, 'স্বাক্ষরিত কোটেশন আপলোড হয়েছে');
  assert.match(notice.message, /স্বাক্ষরিত কোটেশন/);
  // Naming the agreement, or saying "done", before it has come back is how an
  // agent ends up promising a consumer a document the file cannot back up.
  assert.ok(!notice.message.includes('চুক্তিপত্র'), notice.message);
  assert.ok(!notice.message.includes('সম্পন্ন'), notice.message);
});

test('notice: which kinds are on file, in workflow order', () => {
  assert.deepEqual(signedKindsOnFile([]), []);
  assert.deepEqual(signedKindsOnFile([{ kind: 'aadhaar' }]), []);
  assert.deepEqual(signedKindsOnFile([{ kind: 'signedAgreement' }]), ['signedAgreement']);
  assert.deepEqual(
    signedKindsOnFile([{ kind: 'signedAgreement' }, { kind: 'aadhaar' }, { kind: 'signedQuotation' }]),
    ['signedQuotation', 'signedAgreement']
  );

  assert.equal(signedSetLabel([]), '');
  assert.equal(signedSetLabel(['signedAgreement']), 'স্বাক্ষরিত চুক্তিপত্র');
  assert.equal(signedSetLabel(['signedQuotation', 'signedAgreement']), SIGNED_DOCUMENT_LABELS.both);
});

// ===========================================================================
// The email
// ===========================================================================

test('email: the signed-copy mail is branded, Bengali, and points at the application', () => {
  const notice = buildSignedDocumentNotice({
    consumerName: 'Raj Kumar Dawn',
    applicationNo: 'SE/APP/2026/0001',
    kinds: ['signedQuotation', 'signedAgreement'],
  });

  const { subject, html, text } = buildSignedDocumentFiledEmail({
    notice,
    consumerName: 'Raj Kumar Dawn',
    applicationNo: 'SE/APP/2026/0001',
    agentName: 'Sourav Bhukta',
    filedAt: new Date('2026-09-28T10:00:00Z'),
    applicationUrl: 'http://localhost:3000/applications/6ab7f555376b7d422e21f502',
    company: COMPANY,
  });

  assert.match(subject, /Raj Kumar Dawn/);
  assert.match(subject, /কোটেশন ও চুক্তিপত্র/);

  // Greeting by first name only, and the branded header logo travels inline.
  assert.match(html, /প্রিয় Sourav,/);
  assert.match(html, /cid:sulekha-logo|Sulekha Engineering/);
  assert.match(html, /স্বাক্ষরিত কোটেশন ও চুক্তিপত্র/);
  assert.match(html, /SE\/APP\/2026\/0001/);
  assert.match(html, /http:\/\/localhost:3000\/applications\/6ab7f555376b7d422e21f502/);

  // Asserted against the same formatter rather than a literal: this runtime
  // falls back to en-US for the en-IN pattern, so the day and the month swap
  // places depending on the ICU the node binary shipped with.
  const filedOn = new Date('2026-09-28T10:00:00Z').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  assert.ok(html.includes(filedOn), `the filing date ${filedOn} is not in the mail`);
  // The footer carries the real company details, not a placeholder.
  assert.match(html, /9876543210/);
  assert.ok(!html.includes('${'), 'a template placeholder survived into the mail');
  assert.ok(!html.includes('undefined'), 'an unset value leaked into the mail');

  // The plain-text alternative is a real fallback, not the HTML stripped.
  assert.match(text, /আবেদন নম্বর: SE\/APP\/2026\/0001/);
  assert.match(text, /1\. /);
  assert.match(text, /Sulekha Engineering/);
  assert.ok(!text.includes('<strong>'), 'HTML leaked into the text part');
});

// ===========================================================================
// The API
// ===========================================================================

let env;
let agent;
let agent2;
let agentToken;
let agent2Token;
let adminToken;
let applicationId;
let applicationNo;

/**
 * The developer's `.env.local` switches real email ON (`EMAIL_ENABLED=true`),
 * overriding the `false` in `.env`. Left alone, "filing a document" in this file
 * would put mail through the real Gmail account on every upload — and it did,
 * once, before the transport was pinned here. So the whole file runs with the
 * transport pointed at a dead port on this machine, and the two tests that
 * exercise a live transport switch it on *still at that dead port*. Nothing in
 * this file can reach a mail server.
 */
const EMAIL_KEYS = [
  'EMAIL_ENABLED',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_SECURE',
  'SMTP_SERVICE',
];
const ORIGINAL_EMAIL = {};

const pinEmailToDeadPort = () => {
  EMAIL_KEYS.forEach((key) => {
    ORIGINAL_EMAIL[key] = config[key];
  });
  config.EMAIL_ENABLED = false;
  config.SMTP_HOST = '127.0.0.1';
  config.SMTP_PORT = 1;
  config.SMTP_USER = 'notice-tests@example.invalid';
  config.SMTP_PASSWORD = 'not-a-real-password';
  config.SMTP_SECURE = false;
  config.SMTP_SERVICE = '';
};

const restoreEmail = () => {
  EMAIL_KEYS.forEach((key) => {
    config[key] = ORIGINAL_EMAIL[key];
  });
};

const validBody = () => ({
  consumerName: 'Raj Kumar Dawn',
  phone: '9832261761',
  aadhaarNumber: '1234 5678 9012',
  panNumber: 'abcde1234f',
  email: 'raj@example.com',
  address: {
    street: 'Station Road',
    village: 'Dhuluk',
    block: 'Jamalpur',
    panchayat: 'Dhuluk GP',
    district: 'Purba Bardhaman',
    landmark: 'Near the temple',
    pincode: '713301',
  },
  siteType: 'tin_shed',
  deal: { systemSizeKW: 3, proposalAmount: 180000 },
  loan: { asked: true, hasExistingLoan: false, consumerInformed: true },
});

const pdf = (name) =>
  Buffer.from(`%PDF-1.4 signed scan of ${name}`, 'utf8');

const fileSigned = (kind, filename) =>
  request(env.app)
    .post(`${API_PREFIX}/applications/${applicationId}/signed-document`)
    .set('Authorization', `Bearer ${adminToken}`)
    .field('kind', kind)
    .attach('file', pdf(filename), { filename, contentType: 'application/pdf' });

const listFor = (token) =>
  request(env.app).get(`${API_PREFIX}/notifications`).set('Authorization', `Bearer ${token}`);

const unreadFor = (token) =>
  request(env.app)
    .get(`${API_PREFIX}/notifications/unread-count`)
    .set('Authorization', `Bearer ${token}`);

before(async () => {
  // Keep the uploads off the network and out of the repo — same reasoning as
  // application.test.js: the developer's .env holds live Cloudinary keys.
  config.CLOUDINARY_CLOUD_NAME = '';
  config.CLOUDINARY_API_KEY = '';
  config.CLOUDINARY_API_SECRET = '';
  config.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sulekha-notice-uploads-'));

  pinEmailToDeadPort();

  env = await startTestEnv();
  await Application.init();
  await Notification.init();

  agent = await User.createUser({
    name: 'Sourav Bhukta',
    email: 'sourav.agent@test.local',
    password: 'Test@12345',
    role: 'agent',
    status: 'active',
  });

  agent2 = await User.createUser({
    name: 'Other Agent',
    email: 'other.agent@test.local',
    password: 'Test@12345',
    role: 'agent',
    status: 'active',
  });

  const tokenFor = (user) =>
    jwt.sign(
      { id: user._id, email: user.email, role: user.role, permissions: user.permissions || [] },
      config.JWT_SECRET,
      { expiresIn: '1h', algorithm: config.JWT_ALGORITHM }
    );

  agentToken = tokenFor(agent);
  agent2Token = tokenFor(agent2);
  adminToken = env.adminToken;

  const created = await request(env.app)
    .post(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send(validBody());

  assert.equal(created.status, 201, JSON.stringify(created.body));
  applicationId = created.body.data._id;
  applicationNo = created.body.data.applicationNo;
});

after(async () => {
  restoreEmail();
  await env.stop();
  fs.rmSync(config.UPLOAD_DIR, { recursive: true, force: true });
});

test('api: filing the signed quotation notifies the agent who owns the file', async () => {
  const res = await fileSigned('signedQuotation', 'signed-quotation.pdf');

  assert.equal(res.status, 201, JSON.stringify(res.body));

  const stored = await Notification.findOne({ type: 'document' });
  assert.ok(stored, 'no notification was created for the agent');
  assert.equal(String(stored.recipient), String(agent._id));
  assert.equal(stored.link, `/applications/${applicationId}`);
  assert.equal(stored.source, 'internal');
  assert.equal(stored.isRead, false);
  assert.equal(stored.metadata.applicationNo, applicationNo);
  assert.deepEqual(stored.metadata.kinds, ['signedQuotation']);
  assert.equal(stored.title, 'স্বাক্ষরিত কোটেশন আপলোড হয়েছে');
});

test('api: the owning agent sees the notice, another agent does not', async () => {
  const mine = await listFor(agentToken);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.data.length, 1);
  assert.equal(mine.body.data[0].type, 'document');

  const theirs = await listFor(agent2Token);
  assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
  assert.equal(theirs.body.data.length, 0, 'another agent was shown the notice');
});

test('api: the unread badge counts only the caller’s own notifications', async () => {
  const mine = await unreadFor(agentToken);
  assert.equal(mine.body.data.unreadCount, 1);

  const theirs = await unreadFor(agent2Token);
  assert.equal(theirs.body.data.unreadCount, 0);
});

test('api: the unified feed — what the notifications page reads — is scoped too', async () => {
  // The PM Surya Ghar feed would otherwise make a live request from the test
  // suite; a stub keeps the run offline and the assertions about our own notice.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => '<html><body><h1>Rooftop solar subsidy</h1></body></html>',
  });

  try {
    const mine = await request(env.app)
      .get(`${API_PREFIX}/notifications/unified`)
      .set('Authorization', `Bearer ${agentToken}`);
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.equal(mine.body.data.filter((n) => n.type === 'document').length, 1);

    const theirs = await request(env.app)
      .get(`${API_PREFIX}/notifications/unified`)
      .set('Authorization', `Bearer ${agent2Token}`);
    assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
    assert.equal(theirs.body.data.filter((n) => n.type === 'document').length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('api: the agreement completes the set and the notice says so', async () => {
  const res = await fileSigned('signedAgreement', 'signed-agreement.pdf');
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const notices = await Notification.find({ recipient: agent._id, type: 'document' }).sort({
    createdAt: -1,
  });

  assert.equal(notices.length, 2, 'each filing tells the agent once');
  assert.equal(notices[0].title, 'স্বাক্ষরিত কোটেশন ও চুক্তিপত্র সম্পন্ন হয়েছে');
  assert.match(notices[0].message, /সফলভাবে সম্পন্ন হয়েছে এবং আপলোড করা হয়েছে/);
  assert.match(notices[0].message, /ডাউনলোড করে গ্রাহকের সাথে শেয়ার করতে পারেন/);
  assert.deepEqual(notices[0].metadata.kinds, ['signedQuotation', 'signedAgreement']);
});

test('api: the agent’s own uploads never raise a notice', async () => {
  const before = await Notification.countDocuments({ type: 'document' });

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${applicationId}/documents`)
    .set('Authorization', `Bearer ${agentToken}`)
    .field('kind', 'aadhaar')
    .attach('file', pdf('aadhaar'), { filename: 'aadhaar.pdf', contentType: 'application/pdf' });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(await Notification.countDocuments({ type: 'document' }), before);
});

test('api: a notification addressed to someone else cannot be read or marked read', async () => {
  const notice = await Notification.findOne({ recipient: agent._id, type: 'document' });

  const refused = await request(env.app)
    .put(`${API_PREFIX}/notifications/${notice._id}/read`)
    .set('Authorization', `Bearer ${agent2Token}`);

  assert.equal(refused.status, 404, JSON.stringify(refused.body));
  assert.equal((await Notification.findById(notice._id)).isRead, false);

  const allowed = await request(env.app)
    .put(`${API_PREFIX}/notifications/${notice._id}/read`)
    .set('Authorization', `Bearer ${agentToken}`);

  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.equal((await Notification.findById(notice._id)).isRead, true);
});

test('api: “read all” clears only the caller’s unread notices', async () => {
  await request(env.app)
    .put(`${API_PREFIX}/notifications/read-all`)
    .set('Authorization', `Bearer ${agent2Token}`);

  const stillUnread = await Notification.countDocuments({
    recipient: agent._id,
    type: 'document',
    isRead: false,
  });
  assert.equal(stillUnread, 1, 'another agent cleared this agent’s unread notice');
});

// ===========================================================================
// Delivery, when it cannot be delivered
// ===========================================================================

test('email: with email switched off the send is skipped, and the filing still succeeds', async () => {
  const application = await Application.findById(applicationId);
  const result = await notifyAgentOfSignedDocument(application, { actor: env.admin });

  assert.ok(result, 'the notice helper gave up entirely');
  assert.equal(result.email.sent, false);
  assert.equal(result.email.reason, 'email-disabled');
  // The in-app half is not collateral damage of a disabled mailbox.
  assert.ok(result.notification);
});

test('email: an unreachable SMTP server is reported, never thrown — the upload stands', async () => {
  // Switched on, but the transport is already pinned to a dead local port by
  // this file's setup — so this genuinely attempts a connection and genuinely
  // fails, without a mail server anywhere near it.
  config.EMAIL_ENABLED = true;

  try {
    const application = await Application.findById(applicationId);
    const result = await notifyAgentOfSignedDocument(application, { actor: env.admin });

    assert.ok(result, 'a dead mail server must not lose the notice');
    assert.equal(result.email.sent, false);
    // It really did reach for the transport — not a config short-circuit.
    assert.notEqual(result.email.reason, 'email-disabled');
    assert.notEqual(result.email.reason, 'email-not-configured');
    assert.match(String(result.email.reason), /ECONNREFUSED|ECONNRESET|ETIMEDOUT|connect/i);
    assert.ok(result.notification, 'the in-app notice still landed');
  } finally {
    config.EMAIL_ENABLED = false;
  }
});

test('email: the filing endpoint survives a mail server that refuses to connect', async () => {
  config.EMAIL_ENABLED = true;

  try {
    const res = await fileSigned('signedQuotation', 'signed-quotation-again.pdf');
    assert.equal(res.status, 201, JSON.stringify(res.body));
  } finally {
    config.EMAIL_ENABLED = false;
  }
});
