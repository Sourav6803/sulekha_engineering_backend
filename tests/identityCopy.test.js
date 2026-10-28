// tests/identityCopy.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import config from '../src/config/env.js';
import { startTestEnv, API_PREFIX } from './helpers/testSetup.js';
import Application from '../src/models/Application.js';
import Customer from '../src/models/Customer.js';
import { Quotation, User } from '../src/models/index.js';
import { quotationPdfService } from '../src/services/quotationPdf.service.js';
import { agreementPdfService } from '../src/services/agreementPdf.service.js';

/**
 * The identity an application copies from its customer.
 *
 * Three fields went missing on real files and the office was left retyping what
 * the household had already given:
 *
 *   - the landmark (never copied at all),
 *   - the consumer ID and installation number (an empty `electricBill` in the
 *     create payload won over the customer's values),
 *
 * and with the consumer ID blank the quotation and the agreement printed a line
 * the DISCOM hands back. So this file guards the copy, the read-time fill for
 * files already on disk, and the refusal to issue paper without a number.
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
  config.SMTP_USER = 'identity-tests@example.invalid';
  config.SMTP_PASSWORD = 'not-a-real-password';
  config.SMTP_SECURE = false;
  config.SMTP_SERVICE = '';
};

const restoreEmail = () => {
  EMAIL_KEYS.forEach((key) => {
    config[key] = ORIGINAL_EMAIL[key];
  });
};

let env;
let agent;
let customerWithIds;
let customerWithoutIds;
let applicationWithIds;
let applicationWithoutIds;

const originalRenderQuotation = quotationPdfService.renderQuotationPdf;
const originalRenderAgreement = agreementPdfService.renderAgreementPdf;

const makeCustomer = (customerId, phone, overrides = {}) =>
  Customer.create({
    customerId,
    name: 'Raj Kumar Dawn',
    phone,
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
    ownerAgent: agent._id,
    verification: { status: 'verified', by: env.admin._id, at: new Date() },
    ...overrides,
  });

const fileApplication = (customer, body = {}) =>
  request(env.app)
    .post(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ customer: String(customer._id), deal: { systemSizeKW: 3, proposalAmount: 180000 }, ...body });

before(async () => {
  config.CLOUDINARY_CLOUD_NAME = '';
  config.CLOUDINARY_API_KEY = '';
  config.CLOUDINARY_API_SECRET = '';
  config.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sulekha-identity-uploads-'));

  pinEmailToDeadPort();

  quotationPdfService.renderQuotationPdf = async () => ({
    buffer: Buffer.from('%PDF-1.4 quotation', 'utf8'),
    fontSize: 8,
    contentHeightPx: 500,
  });
  agreementPdfService.renderAgreementPdf = async () => ({
    buffer: Buffer.from('%PDF-1.4 agreement', 'utf8'),
    fontSize: 11,
    pages: 4,
  });

  env = await startTestEnv();
  await Application.init();

  agent = await User.createUser({
    name: 'Sourav Bhukta',
    email: 'agent.identity@test.local',
    password: 'Test@12345',
    role: 'agent',
    status: 'active',
  });

  customerWithIds = await makeCustomer('CUS-920001', '9832261761', {
    landmark: 'Beside the Shitala temple',
    electricBill: { consumerId: '1234567890', installationNo: 'INS-778899', verified: true },
  });

  customerWithoutIds = await makeCustomer('CUS-920002', '9832261762', {
    landmark: 'Behind the bus stand',
    electricBill: { consumerId: '', installationNo: '' },
  });

  const first = await fileApplication(customerWithIds);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  applicationWithIds = first.body.data._id;

  const second = await fileApplication(customerWithoutIds, {
    // The wizard sends `{}` often enough that this used to win over the customer.
    electricBill: {},
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  applicationWithoutIds = second.body.data._id;
});

after(async () => {
  quotationPdfService.renderQuotationPdf = originalRenderQuotation;
  agreementPdfService.renderAgreementPdf = originalRenderAgreement;
  restoreEmail();
  await env.stop();
  fs.rmSync(config.UPLOAD_DIR, { recursive: true, force: true });
});

test('api: the landmark travels with the application', async () => {
  const stored = await Application.findById(applicationWithIds).lean();
  assert.equal(stored.address.landmark, 'Beside the Shitala temple');
});

test('api: the consumer id and installation number are copied — with no verdict attached', async () => {
  const stored = await Application.findById(applicationWithIds).lean();
  assert.equal(stored.electricBill.consumerId, '1234567890');
  assert.equal(stored.electricBill.installationNo, 'INS-778899');
  assert.equal(
    stored.electricBill.verified,
    false,
    "the customer's verification must not travel to a new application"
  );
});

test('api: an empty electricBill in the payload does not wipe the customer’s ids', async () => {
  const stored = await Application.findById(applicationWithoutIds).lean();
  // The customer has no ids, so there is nothing to copy — but the field must be
  // empty, not "undefined because {} won".
  assert.equal(stored.electricBill?.consumerId ?? '', '');

  const withIds = await Application.findById(applicationWithIds).lean();
  assert.equal(withIds.electricBill.consumerId, '1234567890');
});

test('api: a file that predates the copy shows the customer’s landmark and ids anyway', async () => {
  // Simulate an application filed before any of this was copied.
  await Application.updateOne(
    { _id: applicationWithIds },
    { $unset: { 'address.landmark': 1, 'electricBill.consumerId': 1, 'electricBill.installationNo': 1 } }
  );

  const res = await request(env.app)
    .get(`${API_PREFIX}/applications/${applicationWithIds}`)
    .set('Authorization', `Bearer ${env.adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.application.address.landmark, 'Beside the Shitala temple');
  assert.equal(res.body.data.application.electricBill.consumerId, '1234567890');
  assert.equal(res.body.data.application.electricBill.installationNo, 'INS-778899');

  // Read-time only: the stored record is left as it was.
  const stored = await Application.findById(applicationWithIds).lean();
  assert.equal(stored.electricBill?.consumerId ?? '', '');
});

test('api: the bill the agent photographed comes over as the bill file', async () => {
  const withBill = await makeCustomer('CUS-920004', '9832261764', {
    electricBill: { consumerId: '5556667778', installationNo: 'INS-444555' },
    documents: [
      {
        type: 'electricBill',
        url: '/uploads/customers/bill-920004.pdf',
        fileName: 'bill-920004.pdf',
        fileType: 'pdf',
        uploadedAt: new Date(),
      },
    ],
  });

  const filed = await fileApplication(withBill);
  assert.equal(filed.status, 201, JSON.stringify(filed.body));

  const stored = await Application.findById(filed.body.data._id).lean();
  assert.equal(stored.electricBill.fileUrl, '/uploads/customers/bill-920004.pdf');
  assert.equal(stored.electricBill.fileName, 'bill-920004.pdf');
  assert.equal(stored.electricBill.consumerId, '5556667778');
});

test('api: uploading the bill adopts the ids, so “Mark verified” is not refused', async () => {
  // An old file: ids only on the customer, nothing on the application.
  const oldFile = await makeCustomer('CUS-920005', '9832261765', {
    electricBill: { consumerId: '1112223334', installationNo: 'INS-909090' },
  });
  const filed = await fileApplication(oldFile);
  assert.equal(filed.status, 201, JSON.stringify(filed.body));

  const id = filed.body.data._id;
  await Application.updateOne(
    { _id: id },
    { $unset: { 'electricBill.consumerId': 1, 'electricBill.installationNo': 1 } }
  );

  const upload = await request(env.app)
    .post(`${API_PREFIX}/applications/${id}/documents`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .field('kind', 'electricBill')
    .attach('file', Buffer.from('%PDF-1.4 bill', 'utf8'), {
      filename: 'bill.pdf',
      contentType: 'application/pdf',
    });

  assert.equal(upload.status, 201, JSON.stringify(upload.body));

  const afterUpload = await Application.findById(id).lean();
  assert.equal(afterUpload.electricBill.fileUrl.length > 0, true, 'the bill file was not recorded');
  assert.equal(afterUpload.electricBill.consumerId, '1112223334');

  const verify = await request(env.app)
    .patch(`${API_PREFIX}/applications/${id}/electric-bill/verify`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ verified: true });

  assert.equal(verify.status, 200, JSON.stringify(verify.body));

  const stored = await Application.findById(id).lean();
  assert.equal(stored.electricBill.verified, true);
  assert.equal(stored.electricBill.installationNo, 'INS-909090');
});

test('api: issuing a quotation without any consumer id is refused', async () => {
  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${applicationWithoutIds}/issue-quotation`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({});

  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.match(res.body.error.message, /consumer ID/i);
  assert.ok(res.body.error.details?.['electricBill.consumerId'], 'the field is not pointed at');

  assert.equal(
    await Quotation.countDocuments({ customer: { $exists: true } }),
    0,
    'a refused issue still created a quotation'
  );
});

test('api: with the id only on the customer, issuance copies it into the record and the paper', async () => {
  // The office records the id on the customer after the application was filed —
  // the exact order that left the real file blank.
  await Customer.updateOne(
    { _id: customerWithoutIds._id },
    { 'electricBill.consumerId': '9876543210', 'electricBill.installationNo': 'INS-112233' }
  );

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${applicationWithoutIds}/issue-quotation`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({});

  assert.equal(res.status, 201, JSON.stringify(res.body));

  const stored = await Application.findById(applicationWithoutIds).lean();
  assert.equal(
    stored.electricBill.consumerId,
    '9876543210',
    'the id was not written back onto the application'
  );

  const quotation = await Quotation.findById(stored.quotation).lean();
  assert.equal(quotation.consumerId, '9876543210');
  assert.equal(
    quotation.amount,
    180000,
    'the quotation did not take the deal amount'
  );
});

test('api: a consumer id that is not digits is refused for the agreement', async () => {
  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${applicationWithoutIds}/issue-agreement`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({});

  // 9876543210 is fine, so this one passes; the guard is exercised by the letter
  // case below on a separate customer.
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const lettered = await makeCustomer('CUS-920003', '9832261763', {
    electricBill: { consumerId: 'WB12345', installationNo: 'INS-9' },
  });
  const filed = await fileApplication(lettered);
  assert.equal(filed.status, 201, JSON.stringify(filed.body));

  const bad = await request(env.app)
    .post(`${API_PREFIX}/applications/${filed.body.data._id}/issue-agreement`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({});

  assert.equal(bad.status, 422, JSON.stringify(bad.body));
  assert.match(bad.body.error.message, /5 to 20 digits/);
});
