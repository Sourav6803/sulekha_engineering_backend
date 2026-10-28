// tests/issueDocuments.test.js
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
import { Agreement, Notification, Quotation, User } from '../src/models/index.js';
import { quotationPdfService } from '../src/services/quotationPdf.service.js';
import { agreementPdfService } from '../src/services/agreementPdf.service.js';

/**
 * Issuing the unsigned quotation and the agreement from the application.
 *
 * This is the half that removes the second trip: the office generates the paper
 * from the application, the PDF is filed on the application itself, and the agent
 * — who cannot open the quotations module at all — is told it is ready to print.
 *
 * The PDF renderers need a headless browser, which the suite has no business
 * downloading (and no business waiting on), so both are stubbed here: what is
 * under test is the record, the link, the attachment and the notice, not Chrome.
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
  config.SMTP_USER = 'issue-tests@example.invalid';
  config.SMTP_PASSWORD = 'not-a-real-password';
  config.SMTP_SECURE = false;
  config.SMTP_SERVICE = '';
};

const restoreEmail = () => {
  EMAIL_KEYS.forEach((key) => {
    config[key] = ORIGINAL_EMAIL[key];
  });
};

const PDF_BYTES = Buffer.from('%PDF-1.4 stubbed quotation body', 'utf8');

let env;
let agent;
let agentToken;
let applicationId;

const originalRenderQuotation = quotationPdfService.renderQuotationPdf;
const originalRenderAgreement = agreementPdfService.renderAgreementPdf;

const issue = (which, body = {}, token = env?.adminToken) =>
  request(env.app)
    .post(`${API_PREFIX}/applications/${applicationId}/issue-${which}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const noticesFor = (token) =>
  request(env.app)
    .get(`${API_PREFIX}/notifications`)
    .set('Authorization', `Bearer ${token}`)
    .then((res) => (res.body.data || []).filter((row) => row.type === 'document'));

before(async () => {
  config.CLOUDINARY_CLOUD_NAME = '';
  config.CLOUDINARY_API_KEY = '';
  config.CLOUDINARY_API_SECRET = '';
  config.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sulekha-issue-uploads-'));

  pinEmailToDeadPort();

  quotationPdfService.renderQuotationPdf = async () => ({
    buffer: PDF_BYTES,
    fontSize: 8,
    contentHeightPx: 500,
  });
  agreementPdfService.renderAgreementPdf = async () => ({
    buffer: PDF_BYTES,
    fontSize: 11,
    pages: 4,
  });

  env = await startTestEnv();
  await Application.init();
  await Notification.init();

  agent = await User.createUser({
    name: 'Sourav Bhukta',
    email: 'agent.issue@test.local',
    password: 'Test@12345',
    role: 'agent',
    status: 'active',
  });

  agentToken = jwt.sign(
    { id: agent._id, email: agent.email, role: agent.role, permissions: agent.permissions || [] },
    config.JWT_SECRET,
    { expiresIn: '1h', algorithm: config.JWT_ALGORITHM }
  );

  const customer = await Customer.create({
    customerId: 'CUS-910001',
    name: 'Raj Kumar Dawn',
    phone: '9832261761',
    address: 'Station Road, Dhuluk',
    street: 'Station Road',
    village: 'Dhuluk',
    block: 'Jamalpur',
    district: 'Purba Bardhaman',
    city: 'Bardhaman',
    state: 'West Bengal',
    pincode: '713301',
    systemSizeKW: 3,
    roofType: 'tin_shed',
    status: 'active',
    // The consumer ID is printed on both documents and the issue endpoint refuses
    // to produce either without one.
    electricBill: { consumerId: '1234567890', installationNo: 'INS-778899' },
    ownerAgent: agent._id,
    verification: { status: 'verified', by: env.admin._id, at: new Date() },
  });

  const created = await request(env.app)
    .post(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({
      customer: String(customer._id),
      deal: { systemSizeKW: 3, proposalAmount: 180000 },
      loan: { asked: false },
    });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  applicationId = created.body.data._id;
});

after(async () => {
  quotationPdfService.renderQuotationPdf = originalRenderQuotation;
  agreementPdfService.renderAgreementPdf = originalRenderAgreement;
  restoreEmail();
  await env.stop();
  fs.rmSync(config.UPLOAD_DIR, { recursive: true, force: true });
});

test('api: issuing the quotation builds it from the application, files the PDF and links it', async () => {
  const res = await issue('quotation', { amount: 185000 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.data.quotationNo, /^SE\//);

  const stored = await Application.findById(applicationId);
  assert.ok(stored.quotation, 'the application.quotation link was never written');
  assert.ok(stored.agreement === undefined || stored.agreement === null);

  const filed = stored.documents.filter((doc) => doc.kind === 'issuedQuotation');
  assert.equal(filed.length, 1, 'the issued quotation PDF was not filed on the application');
  assert.equal(filed[0].mimeType, 'application/pdf');
  assert.ok(filed[0].url, 'the filed PDF has no url the agent could open');
  assert.equal(filed[0].fileName.endsWith('.pdf'), true);

  const quotation = await Quotation.findById(stored.quotation).lean();
  assert.equal(quotation.amount, 185000);
  assert.equal(quotation.customerName, 'Raj Kumar Dawn');
  assert.equal(quotation.systemSizeKW, 3);
  assert.equal(String(quotation.customer), String(stored.customer));
});

test('api: the agent is told the paper is ready — with the number in the notice', async () => {
  const own = await noticesFor(agentToken);
  assert.equal(own.length, 1, 'the agent was not told the quotation was issued');
  assert.equal(own[0].title, 'কোটেশন প্রস্তুত');
  assert.match(own[0].message, /SE\//);
  assert.equal(own[0].link, `/applications/${applicationId}`);
});

test('api: only the office may issue paper', async () => {
  const res = await issue('quotation', {}, agentToken);
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('api: re-issuing re-renders the same quotation instead of creating a second one', async () => {
  const before = await Quotation.countDocuments({ customerName: 'Raj Kumar Dawn' });
  const res = await issue('quotation');
  assert.equal(res.status, 201, JSON.stringify(res.body));

  assert.equal(
    await Quotation.countDocuments({ customerName: 'Raj Kumar Dawn' }),
    before,
    'a second quotation was created'
  );

  const stored = await Application.findById(applicationId);
  assert.equal(
    stored.documents.filter((doc) => doc.kind === 'issuedQuotation').length,
    1,
    'the old PDF was left beside the new one'
  );
});

test('api: the agreement is built from the quotation and filed the same way', async () => {
  const res = await issue('agreement');
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const stored = await Application.findById(applicationId);
  assert.ok(stored.agreement, 'the application.agreement link was never written');

  const agreement = await Agreement.findById(stored.agreement).lean();
  assert.equal(agreement.consumerName, 'Raj Kumar Dawn');
  assert.equal(agreement.amount, 185000, 'the agreement did not take the quotation amount');
  assert.equal(String(agreement.quotation), String(stored.quotation));
  assert.match(agreement.address, /Dhuluk/);

  const filed = stored.documents.filter((doc) => doc.kind === 'issuedAgreement');
  assert.equal(filed.length, 1, 'the issued agreement PDF was not filed');
  assert.equal(filed[0].mimeType, 'application/pdf');
});

test('api: with both on file the notice names the pair', async () => {
  const own = await noticesFor(agentToken);
  const latest = own[0];
  assert.equal(latest.title, 'কোটেশন ও চুক্তিপত্র প্রস্তুত');
  assert.match(latest.message, /প্রিন্ট/);
});

test('api: the agent can see both PDFs on their own application — the print path', async () => {
  const res = await request(env.app)
    .get(`${API_PREFIX}/applications/${applicationId}`)
    .set('Authorization', `Bearer ${agentToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));

  const documents = res.body.data.application.documents ?? [];
  const kinds = documents.map((doc) => doc.kind);
  assert.ok(kinds.includes('issuedQuotation'), 'the agent cannot reach the quotation PDF');
  assert.ok(kinds.includes('issuedAgreement'), 'the agent cannot reach the agreement PDF');

  const quotationDoc = documents.find((doc) => doc.kind === 'issuedQuotation');
  assert.ok(quotationDoc.url, 'the document has no url to download');
});

test('api: a quotation written in the editor is linked as-is — BOQ untouched', async () => {
  const created = await request(env.app)
    .post(`${API_PREFIX}/quotations`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({
      customerName: 'Raj Kumar Dawn',
      systemSizeKW: 3,
      quotationType: 'consumer',
      amount: 190000,
      items: [
        {
          description: 'Solar Modules Bifacial TOPcon Panel (580 wp)',
          qty: 6,
          unit: 'Nos',
          rate: 12000,
        },
      ],
    });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  const quotationId = created.body.data._id;

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${applicationId}/issue-quotation`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ quotationId });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.quotationNo, created.body.data.quotationNo);

  const stored = await Application.findById(applicationId).lean();
  assert.equal(String(stored.quotation), String(quotationId), 'the editor quotation was not linked');

  // The whole point of going through the editor: the edited line is what prints.
  const quotation = await Quotation.findById(quotationId).lean();
  assert.equal(quotation.items[0].description, 'Solar Modules Bifacial TOPcon Panel (580 wp)');
  assert.equal(quotation.amount, 190000);
});

test('api: a quotation from another customer is refused', async () => {
  const otherCustomer = await Customer.create({
    customerId: 'CUS-910009',
    name: 'Someone Else',
    phone: '9832269999',
    address: 'Elsewhere',
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

  const otherApp = await request(env.app)
    .post(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ customer: String(otherCustomer._id), deal: { systemSizeKW: 3, proposalAmount: 150000 } });

  assert.equal(otherApp.status, 201, JSON.stringify(otherApp.body));

  const quotation = await Quotation.findOne({ customerName: 'Raj Kumar Dawn' }).lean();

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${otherApp.body.data._id}/issue-quotation`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ quotationId: String(quotation._id) });

  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.match(res.body.error.message, /different customer/i);

  const untouched = await Application.findById(otherApp.body.data._id).lean();
  assert.equal(untouched.quotation, undefined, 'a refused issue still linked the quotation');
});

test('api: an agreement written in the agreements screen is linked and filed', async () => {
  const customer = await Customer.create({
    customerId: 'CUS-910010',
    name: 'Editor Agreement',
    phone: '9832261770',
    address: 'Somewhere',
    district: 'Purba Bardhaman',
    city: 'Bardhaman',
    state: 'West Bengal',
    pincode: '713301',
    systemSizeKW: 3,
    roofType: 'tin_shed',
    status: 'active',
    ownerAgent: agent._id,
    electricBill: { consumerId: '4455667788', installationNo: 'INS-202020' },
    verification: { status: 'verified', by: env.admin._id, at: new Date() },
  });

  const filed = await request(env.app)
    .post(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ customer: String(customer._id), deal: { systemSizeKW: 3, proposalAmount: 160000 } });

  assert.equal(filed.status, 201, JSON.stringify(filed.body));
  const appId = filed.body.data._id;

  // The office writes it in the agreements form first — date, notes, amount.
  const written = await request(env.app)
    .post(`${API_PREFIX}/agreements`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({
      consumerName: 'Editor Agreement',
      consumerId: '4455667788',
      address: 'Somewhere, Purba Bardhaman, Pin- 713301',
      agreementDate: '2026-10-26',
      amount: 165000,
      notes: 'Written by hand in the editor',
    });

  assert.equal(written.status, 201, JSON.stringify(written.body));
  const agreementId = written.body.data._id;

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${appId}/issue-agreement`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ agreementId });

  assert.equal(res.status, 201, JSON.stringify(res.body));

  const stored = await Application.findById(appId).lean();
  assert.equal(String(stored.agreement), String(agreementId), 'the editor agreement was not linked');

  const filedPdf = stored.documents.filter((doc) => doc.kind === 'issuedAgreement');
  assert.equal(filedPdf.length, 1, 'the issued agreement PDF was not filed');
  assert.equal(filedPdf[0].mimeType, 'application/pdf');

  // The edited amount is what the paper carries — not the deal's.
  const agreement = await Agreement.findById(agreementId).lean();
  assert.equal(agreement.amount, 165000);
  assert.equal(agreement.notes, 'Written by hand in the editor');
});

test('api: an agreement already on another application is refused', async () => {
  const agreement = await Agreement.findOne({ consumerName: 'Editor Agreement' }).lean();
  assert.ok(agreement, 'the fixture agreement is missing');

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${applicationId}/issue-agreement`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ agreementId: String(agreement._id) });

  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.match(res.body.error.message, /already on/i);
});

test('api: an amount that is not a number is refused before anything is written', async () => {
  const before = await Quotation.countDocuments({ customerName: 'Raj Kumar Dawn' });

  const res = await issue('quotation', { amount: -5 });
  assert.equal(res.status, 422, JSON.stringify(res.body));

  assert.equal(
    await Quotation.countDocuments({ customerName: 'Raj Kumar Dawn' }),
    before,
    'a refused amount still created a record'
  );
});
