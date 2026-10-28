// tests/agentSignedCopy.test.js
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
import Customer from '../src/models/Customer.js';
import { Notification, User } from '../src/models/index.js';

/**
 * The field agent may file the consumer-signed quotation/agreement themselves.
 *
 * They are the ones standing in the house, and they work up to 100 km away —
 * carrying every signed sheet back so an admin could upload it meant a second
 * visit per signature. The trade-off is that the paper now enters the file
 * without the office having seen it, so this file guards the terms of that trade:
 *
 *   1. an agent's upload is stored but NOT approved — `review.status = 'pending'`;
 *   2. the office is told, by notification, that a verdict is waiting;
 *   3. the agent is not told about their own upload (the notice follows the
 *      paper, not the person);
 *   4. once accepted, the agent cannot replace or delete it;
 *   5. the verdict — accepted or sent back with a reason — reaches the agent.
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

/** Never reach a mail server: the developer's .env.local has mail switched on. */
const pinEmailToDeadPort = () => {
  EMAIL_KEYS.forEach((key) => {
    ORIGINAL_EMAIL[key] = config[key];
  });
  config.EMAIL_ENABLED = false;
  config.SMTP_HOST = '127.0.0.1';
  config.SMTP_PORT = 1;
  config.SMTP_USER = 'signed-copy-tests@example.invalid';
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

const pdf = (name) => Buffer.from(`%PDF-1.4 signed scan of ${name}`, 'utf8');

let env;
let agent;
let agent2;
let agentToken;
let agent2Token;
let applicationId;

const fileSigned = (kind, filename, { token = agentToken, fields = {} } = {}) => {
  let call = request(env.app)
    .post(`${API_PREFIX}/applications/${applicationId}/signed-document`)
    .set('Authorization', `Bearer ${token}`)
    .field('kind', kind);

  Object.entries(fields).forEach(([key, value]) => {
    call = call.field(key, value);
  });

  return call.attach('file', pdf(filename), { filename, contentType: 'application/pdf' });
};

const reviewDocument = (documentId, body, token = env.adminToken) =>
  request(env.app)
    .patch(`${API_PREFIX}/applications/${applicationId}/documents/${documentId}/review`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const documentsFor = (token) =>
  request(env.app)
    .get(`${API_PREFIX}/notifications`)
    .set('Authorization', `Bearer ${token}`)
    .then((res) => (res.body.data || []).filter((row) => row.type === 'document'));

before(async () => {
  config.CLOUDINARY_CLOUD_NAME = '';
  config.CLOUDINARY_API_KEY = '';
  config.CLOUDINARY_API_SECRET = '';
  config.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sulekha-agentsigned-uploads-'));

  pinEmailToDeadPort();

  env = await startTestEnv();
  await Application.init();
  await Notification.init();

  agent = await User.createUser({
    name: 'Sourav Bhukta',
    email: 'agent.one@test.local',
    password: 'Test@12345',
    role: 'agent',
    status: 'active',
  });

  agent2 = await User.createUser({
    name: 'Other Agent',
    email: 'agent.two@test.local',
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

  /*
   * The application is filed by the office from a verified customer — that is
   * the flow this repo now has (POST /applications is office-only). The customer
   * belongs to the agent, so the agent of record on the application is the agent
   * under test, which is what gives them access to it at all.
   */
  const customer = await Customer.create({
    customerId: 'CUS-900001',
    name: 'Raj Kumar Dawn',
    phone: '9832261761',
    address: 'Station Road, Dhuluk',
    village: 'Dhuluk',
    block: 'Jamalpur',
    district: 'Purba Bardhaman',
    city: 'Bardhaman',
    state: 'West Bengal',
    pincode: '713301',
    systemSizeKW: 3,
    roofType: 'tin_shed',
    status: 'active',
    ownerAgent: agent._id,
    verification: { status: 'verified', by: env.admin._id, at: new Date() },
  });

  const created = await request(env.app)
    .post(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ customer: String(customer._id), ...validBody() });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  applicationId = created.body.data._id;

  const filed = await Application.findById(applicationId).lean();
  assert.equal(String(filed.agent), String(agent._id), 'the agent of record was not carried over');
});

after(async () => {
  restoreEmail();
  await env.stop();
  fs.rmSync(config.UPLOAD_DIR, { recursive: true, force: true });
});

test('api: an agent may file the signed quotation, but it lands pending — not approved', async () => {
  const res = await fileSigned('signedQuotation', 'signed-quotation.pdf', {
    fields: { note: 'Consumer signed at the house', signedOn: '2026-10-20' },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.kind, 'signedQuotation');
  assert.equal(res.body.data.review.status, 'pending');
  assert.equal(String(res.body.data.uploadedBy), String(agent._id));
  assert.ok(res.body.data.signedOn, 'the signed date was not kept');
  assert.equal(res.body.data.note, 'Consumer signed at the house');

  const stored = await Application.findById(applicationId);
  const doc = stored.documents.find((entry) => entry.kind === 'signedQuotation');
  assert.equal(doc.review.status, 'pending');
  assert.equal(doc.review.reviewedBy, undefined, 'an agent upload must not arrive pre-approved');
});

test('api: the office is told a verdict is waiting, addressed to the office only', async () => {
  const office = await Notification.find({ type: 'document', recipient: env.admin._id });
  assert.equal(office.length, 1, 'the admin was not told about the pending signed copy');
  assert.equal(office[0].title, 'স্বাক্ষরিত কোটেশন অনুমোদনের অপেক্ষায়');
  assert.equal(office[0].priority, 'high');
  assert.equal(office[0].metadata.kind, 'signedQuotation');
  assert.equal(office[0].link, `/applications/${applicationId}`);

  // The notice follows the paper, not the person: the agent who just uploaded
  // knows what they did, and their bell must stay clear.
  const own = await documentsFor(agentToken);
  assert.equal(own.length, 0, 'the agent was told about their own upload');
});

test('api: another agent cannot file a signed copy on someone else’s application', async () => {
  const res = await fileSigned('signedQuotation', 'not-yours.pdf', { token: agent2Token });
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test('api: a signed date in the future is refused', async () => {
  const res = await fileSigned('signedAgreement', 'future.pdf', {
    fields: { signedOn: '2099-01-01' },
  });

  assert.equal(res.status, 422, JSON.stringify(res.body));
});

test('api: accepting the scan tells the agent, once, with the verdict', async () => {
  const stored = await Application.findById(applicationId);
  const document = stored.documents.find((entry) => entry.kind === 'signedQuotation');

  const res = await reviewDocument(document._id, { status: 'accepted' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const own = await documentsFor(agentToken);
  assert.equal(own.length, 1, 'the agent was not told the verdict');
  assert.equal(own[0].title, 'স্বাক্ষরিত কোটেশন অনুমোদিত হয়েছে');
  assert.equal(own[0].metadata.verdict, 'accepted');
});

test('api: an approved signed copy cannot be replaced by the agent', async () => {
  const res = await fileSigned('signedQuotation', 'second-try.pdf');
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.match(String(res.body.error?.message), /already approved/i);
});

test('api: an approved signed copy cannot be deleted by the agent', async () => {
  const stored = await Application.findById(applicationId);
  const document = stored.documents.find((entry) => entry.kind === 'signedQuotation');

  const res = await request(env.app)
    .delete(`${API_PREFIX}/applications/${applicationId}/documents/${document._id}`)
    .set('Authorization', `Bearer ${agentToken}`);

  assert.equal(res.status, 403, JSON.stringify(res.body));

  const after = await Application.findById(applicationId);
  assert.ok(
    after.documents.some((entry) => entry.kind === 'signedQuotation'),
    'the approved copy was removed'
  );
});

test('api: a rejection reaches the agent with the office’s reason', async () => {
  // The office files the agreement itself, then sends it back — the same path an
  // agent upload takes through review, exercised from the other side.
  const filed = await fileSigned('signedAgreement', 'agreement.pdf', { token: env.adminToken });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));
  // An office upload is accepted on arrival: the reviewer is the uploader.
  assert.equal(filed.body.data.review.status, 'accepted');

  const res = await reviewDocument(filed.body.data._id, {
    status: 'rejected',
    reason: 'Agreement page 4 is blank',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const own = await documentsFor(agentToken);
  const verdict = own.find((row) => row.metadata.kind === 'signedAgreement');
  assert.ok(verdict, 'the agent was not told the agreement was sent back');
  assert.equal(verdict.title, 'স্বাক্ষরিত চুক্তিপত্র ফেরত পাঠানো হয়েছে');
  assert.match(verdict.message, /Agreement page 4 is blank/);
});

test('api: the office still files with no verdict to wait for, and the agent is told', async () => {
  const before = (await documentsFor(agentToken)).length;

  const res = await fileSigned('signedQuotation', 'office-copy.pdf', { token: env.adminToken });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.review.status, 'accepted');

  const after = await documentsFor(agentToken);
  assert.equal(after.length, before + 1, 'the agent was not told the office filed a signed copy');
  assert.match(after[after.length - 1].title, /স্বাক্ষরিত/);
});
