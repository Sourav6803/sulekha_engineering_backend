// tests/application.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import config from '../src/config/env.js';
import { startTestEnv, API_PREFIX } from './helpers/testSetup.js';
import Application from '../src/models/Application.js';
import { User } from '../src/models/index.js';
import { collectSubmitIssues } from '../src/services/application.service.js';
import { checkNameMatch } from '../src/utils/nameMatch.js';
import {
  readDimensions,
  checkImageQuality,
} from '../src/services/imageQuality.service.js';
import {
  BILL_PORTAL_URL,
  buildBillPortalUrl,
  isTrustedBillPortalUrl,
  canTransition,
} from '../src/data/applicationChecklist.js';

// ===========================================================================
// Test image helpers
//
// The clarity gate is the part most likely to regress silently — an agent would
// only find out at the consumer's house — so it is exercised against real,
// byte-valid PNGs rather than a mock.
// ===========================================================================

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
};

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
};

/**
 * Build a real PNG.
 *
 * `noise` makes the pixels incompressible so the file comes out large, like a
 * genuine photo. A flat fill compresses to a few KB, which is what a re-shared
 * WhatsApp copy looks like — `level` controls that.
 */
const makePng = (width, height, { noise = false, level = 6 } = {}) => {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width * 3; x += 1) {
      raw[y * stride + 1 + x] = noise ? (y * 31 + x * 17 + (x * y) % 251) % 256 : 128;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

/**
 * A JPEG header — APP0 followed by SOF0, which is all the dimension reader
 * walks. The APP0 segment is there because real files have one and it keeps the
 * buffer past the reader's minimum length.
 */
const makeJpegHeader = (width, height) => {
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2); // segment length
  app0.write('JFIF\0', 4, 'ascii');

  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2); // segment length
  sof[4] = 8; // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3; // components

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
};

// ===========================================================================
// Image dimensions
// ===========================================================================

test('readDimensions: reads PNG width and height from the IHDR chunk', () => {
  const dims = readDimensions(makePng(1234, 567));

  assert.equal(dims.format, 'png');
  assert.equal(dims.width, 1234);
  assert.equal(dims.height, 567);
});

test('readDimensions: reads JPEG width and height from the SOF0 marker', () => {
  const dims = readDimensions(makeJpegHeader(1600, 1200));

  assert.equal(dims.format, 'jpeg');
  assert.equal(dims.width, 1600);
  assert.equal(dims.height, 1200);
});

test('readDimensions: returns null for something that is not an image', () => {
  assert.equal(readDimensions(Buffer.from('this is plainly not an image, it is text')), null);
});

// ===========================================================================
// The clarity gate
// ===========================================================================

test('quality: a thumbnail-sized photo is rejected as too small', async () => {
  const result = await checkImageQuality({
    buffer: makePng(320, 240),
    mimeType: 'image/png',
  });

  assert.equal(result.verdict, 'fail');
  assert.ok(result.reasons.includes('tooSmall'), JSON.stringify(result));
  assert.match(result.message, /too small/i);
});

test('quality: a full-size, incompressible photo passes', async () => {
  const result = await checkImageQuality({
    buffer: makePng(1000, 800, { noise: true }),
    mimeType: 'image/png',
  });

  assert.equal(result.verdict, 'pass', JSON.stringify(result));
  assert.equal(result.reasons.length, 0);
  assert.equal(result.score, 100);
});

test('quality: an over-compressed photo is rejected for its byte size', async () => {
  // Large canvas, but a flat colour compresses to a few KB — exactly what a
  // re-shared WhatsApp copy looks like.
  const result = await checkImageQuality({
    buffer: makePng(2000, 1500),
    mimeType: 'image/png',
  });

  assert.equal(result.verdict, 'fail');
  assert.ok(result.reasons.includes('tooFewBytes'), JSON.stringify(result));
});

test('quality: a PDF scan is skipped, not failed', async () => {
  const result = await checkImageQuality({
    buffer: Buffer.from('%PDF-1.4 not really a pdf'),
    mimeType: 'application/pdf',
  });

  assert.equal(result.verdict, 'skipped');
  assert.equal(result.score, 100);
});

test('quality: rejects a wildly cropped strip', async () => {
  const result = await checkImageQuality({
    buffer: makePng(4000, 700, { noise: true }),
    mimeType: 'image/png',
  });

  assert.equal(result.verdict, 'fail');
  assert.ok(result.reasons.includes('oddShape'), JSON.stringify(result));
});

// ===========================================================================
// Name agreement across the three documents
// ===========================================================================

test('nameMatch: identical names pass', () => {
  const result = checkNameMatch({
    consumerName: 'Raj Kumar Dawn',
    aadhaarName: 'Raj Kumar Dawn',
    passbookName: 'Raj Kumar Dawn',
    electricBillName: 'Raj Kumar Dawn',
  });

  assert.equal(result.verdict, 'match');
  assert.equal(result.passed, true);
  assert.equal(result.mismatched.length, 0);
});

test('nameMatch: case and punctuation differences are not a mismatch', () => {
  const result = checkNameMatch({
    consumerName: 'Raj Kumar Dawn',
    aadhaarName: 'RAJ KUMAR DAWN',
    passbookName: 'raj kumar  dawn',
    electricBillName: 'Raj Kumar Dawn.',
  });

  assert.equal(result.verdict, 'match');
  assert.equal(result.passed, true);
});

test('nameMatch: honorifics are folded away', () => {
  const result = checkNameMatch({
    consumerName: 'Sri Raj Kumar Dawn',
    aadhaarName: 'Raj Kumar Dawn',
    passbookName: 'Mr. Raj Kumar Dawn',
    electricBillName: 'RAJ KUMAR DAWN',
  });

  assert.equal(result.verdict, 'match', result.message);
});

test('nameMatch: a genuinely different name is a mismatch', () => {
  const result = checkNameMatch({
    consumerName: 'Raj Kumar Dawn',
    aadhaarName: 'Sourav Bhukta',
    passbookName: 'Raj Kumar Dawn',
    electricBillName: 'Raj Kumar Dawn',
  });

  assert.equal(result.verdict, 'mismatch');
  assert.equal(result.passed, false);
  assert.ok(result.mismatched.length > 0);
});

test('nameMatch: a missing document name is incomplete, not a pass', () => {
  const result = checkNameMatch({
    consumerName: 'Raj Kumar Dawn',
    aadhaarName: 'Raj Kumar Dawn',
    passbookName: '',
    electricBillName: 'Raj Kumar Dawn',
  });

  assert.equal(result.verdict, 'incomplete');
  assert.equal(result.passed, null);
  assert.match(result.message, /passbookName/);
});

test('nameMatch: an extra middle name is near_match, never a clean pass', () => {
  const result = checkNameMatch({
    consumerName: 'Raj Kumar Dawn',
    aadhaarName: 'Raj Kumar Dawn',
    passbookName: 'Raj Kumar Chandra Dawn',
    electricBillName: 'Raj Kumar Dawn',
  });

  assert.equal(result.verdict, 'near_match');
  assert.equal(result.passed, false);
});

// ===========================================================================
// Bill portal link
// ===========================================================================

test('bill portal: the bare link is the board page', () => {
  assert.equal(buildBillPortalUrl(), BILL_PORTAL_URL);
  assert.match(BILL_PORTAL_URL, /^https:\/\/portal\.wbsedcl\.in\//);
});

test('bill portal: ids are appended when asked for', () => {
  const url = buildBillPortalUrl({
    consumerId: '1234567890',
    installationNo: 'AB1234567',
    withIds: true,
  });

  assert.match(url, /^https:\/\/portal\.wbsedcl\.in\//);
  assert.match(url, /consumerId=1234567890/);
  assert.match(url, /installationNo=AB1234567/);
});

test('bill portal: a URL pointing anywhere else is refused', () => {
  assert.equal(isTrustedBillPortalUrl('https://evil.example.com/bill'), false);
  assert.equal(isTrustedBillPortalUrl('http://portal.wbsedcl.in/bill'), false, 'must be https');
  assert.equal(isTrustedBillPortalUrl(BILL_PORTAL_URL), true);
  assert.equal(isTrustedBillPortalUrl('not a url'), false);
});

// ===========================================================================
// Status machine
// ===========================================================================

test('status machine: rejects skipping steps', () => {
  assert.equal(canTransition('draft', 'submitted'), true);
  assert.equal(canTransition('draft', 'approved'), false, 'draft cannot jump to approved');
  assert.equal(canTransition('submitted', 'approved'), true);
  assert.equal(canTransition('completed', 'approved'), false, 'completed is terminal');
  assert.equal(canTransition('approved', 'quotation_issued'), true);
});

// ===========================================================================
// The submit checklist
// ===========================================================================

const completeApplication = () => ({
  consumerName: 'Raj Kumar Dawn',
  phone: '9832261761',
  aadhaarNumber: '123456789012',
  panNumber: 'ABCDE1234F',
  address: {
    street: 'Station Road',
    village: 'Dhuluk',
    block: 'Jamalpur',
    panchayat: 'Dhuluk GP',
    district: 'Purba Bardhaman',
    landmark: 'Near the temple',
    pincode: '713301',
  },
  siteType: 'rcc_rooftop',
  deal: { systemSizeKW: 3, proposalAmount: 180000 },
  loan: { asked: true, hasExistingLoan: false, consumerInformed: true },
  electricBill: { consumerId: '1234567890', installationNo: 'AB1234567', fileUrl: '/uploads/x.pdf' },
  documents: [
    { kind: 'aadhaar', qualityCheck: { verdict: 'pass' } },
    { kind: 'panCard', qualityCheck: { verdict: 'pass' } },
    { kind: 'electricBill', qualityCheck: { verdict: 'skipped' } },
    { kind: 'rooftopPhoto', qualityCheck: { verdict: 'pass' } },
    { kind: 'landRecord', qualityCheck: { verdict: 'pass' } },
    { kind: 'passbookOrCheque', qualityCheck: { verdict: 'pass' } },
  ],
  nameMatch: { verdict: 'match' },
});

test('submit checklist: a complete application has no issues', () => {
  assert.deepEqual(collectSubmitIssues(completeApplication()), []);
});

test('submit checklist: an empty draft reports every gap', () => {
  const issues = collectSubmitIssues({ address: {}, deal: {}, loan: {}, electricBill: {}, documents: [] });
  const fields = issues.map((issue) => issue.field);

  assert.ok(fields.includes('consumerName'));
  assert.ok(fields.includes('aadhaarNumber'));
  assert.ok(fields.includes('address.street'));
  assert.ok(fields.includes('address.district'));
  assert.ok(fields.includes('siteType'));
  assert.ok(fields.includes('deal.systemSizeKW'));
  assert.ok(fields.includes('loan.asked'));
  assert.ok(fields.includes('loan.hasExistingLoan'));
  assert.ok(fields.includes('electricBill.consumerId'));
  assert.ok(fields.includes('documents.aadhaar'));
  assert.ok(fields.includes('nameMatch'));
});

test('submit checklist: an unasked loan question blocks submission', () => {
  const application = completeApplication();
  application.loan = { asked: false, hasExistingLoan: false };
  const fields = collectSubmitIssues(application).map((issue) => issue.field);

  assert.ok(fields.includes('loan.asked'));
});

test('submit checklist: answering "yes, there is a loan" demands the lender', () => {
  const application = completeApplication();
  application.loan = { asked: true, hasExistingLoan: true };
  const fields = collectSubmitIssues(application).map((issue) => issue.field);

  assert.ok(fields.includes('loan.lenderName'));
});

test('submit checklist: a poor-quality verdict does NOT block submission', () => {
  // The quality metrics are advice for the office, not a gate on the agent. A
  // heuristic that misfires must never stop a document being filed — a reviewer
  // rejects it with a reason instead.
  const application = completeApplication();
  application.documents[0].qualityCheck = { verdict: 'fail', reasons: ['lowSharpness'] };
  const issues = collectSubmitIssues(application);

  assert.equal(
    issues.some((issue) => /not clear/i.test(issue.message)),
    false,
    JSON.stringify(issues)
  );
  assert.equal(issues.length, 0, JSON.stringify(issues));
});

test('submit checklist: a name mismatch blocks submission', () => {
  const application = completeApplication();
  application.nameMatch = { verdict: 'mismatch' };

  assert.ok(collectSubmitIssues(application).some((issue) => issue.field === 'nameMatch'));
});

// ===========================================================================
// API
// ===========================================================================

let env;
let agent;
let agent2;
let agentToken;
let agent2Token;
let adminToken;

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

before(async () => {
  // Keep uploads off the network and out of the repo.
  //
  // The developer's .env carries real Cloudinary keys, and the storage layer
  // uploads whenever they are present — so without this the tests would push
  // throwaway documents into the live account. With them cleared it falls back
  // to the local disk branch, which is what the file assertions below check.
  config.CLOUDINARY_CLOUD_NAME = '';
  config.CLOUDINARY_API_KEY = '';
  config.CLOUDINARY_API_SECRET = '';
  config.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sulekha-test-uploads-'));

  env = await startTestEnv();
  await Application.init();

  agent = await User.createUser({
    name: 'Fiel d Agent',
    email: 'agent@test.local',
    password: 'Test@12345',
    role: 'agent',
    status: 'active',
  });

  agent2 = await User.createUser({
    name: 'Second Agent',
    email: 'agent2@test.local',
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
});

after(async () => {
  await env.stop();
  fs.rmSync(config.UPLOAD_DIR, { recursive: true, force: true });
});

test('api: a field agent can open an application', async () => {
  const res = await request(env.app)
    .post(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send(validBody());

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.data.applicationNo, /^SE\/APP\/\d{4}\/\d{4}$/);
  assert.equal(res.body.data.status, 'draft');
  // Aadhaar is normalised to digits before it is stored.
  assert.equal(res.body.data.aadhaarNumber, '123456789012');
  assert.equal(res.body.data.panNumber, 'ABCDE1234F');
});

test('api: a second application for the same consumer is refused', async () => {
  const res = await request(env.app)
    .post(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send(validBody());

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'DUPLICATE_APPLICATION');
});

test('api: an agent sees only their own applications', async () => {
  const mine = await request(env.app)
    .get(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${agentToken}`);
  const theirs = await request(env.app)
    .get(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${agent2Token}`);
  const all = await request(env.app)
    .get(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(mine.status, 200);
  assert.equal(theirs.body.data.length, 0, 'the second agent must not see the first agent work');
  assert.equal(all.body.data.length, 1, 'the office sees everything');
});

test('api: one agent cannot open another agent application by id', async () => {
  const created = await Application.findOne({ agent: agent._id });

  const res = await request(env.app)
    .get(`${API_PREFIX}/applications/${created._id}`)
    .set('Authorization', `Bearer ${agent2Token}`);

  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test('api: submitting an incomplete application lists what is missing', async () => {
  const created = await Application.findOne({ agent: agent._id });

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${created._id}/submit`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send({ confirmNameMatch: true });

  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'APPLICATION_INCOMPLETE');
  assert.ok(Array.isArray(res.body.error.details.issues));
  assert.ok(res.body.error.details.issues.length > 0);
});

test('api: a poor-quality picture is still accepted, with its verdict recorded', async () => {
  const created = await Application.findOne({ agent: agent._id });

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${created._id}/documents`)
    .set('Authorization', `Bearer ${agentToken}`)
    .field('kind', 'aadhaar')
    .attach('file', makePng(320, 240), { filename: 'aadhaar.png', contentType: 'image/png' });

  // Deliberately NOT a 422 any more. An agent at the consumer's house has to be
  // able to file the document; the heuristic's opinion is stored so the office
  // can reject it with a reason if it really is unusable.
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.qualityCheck.verdict, 'fail');
  assert.ok(res.body.data.qualityCheck.reasons.includes('tooSmall'));
});

test('api: a 712x489 phone photo is accepted — the size the office actually gets', async () => {
  // Regression guard for the false positives that blocked real field work:
  // this resolution and a mostly-white document used to fail on `tooSmall` and
  // on the glare rule (white paper measured as 76% glare).
  const created = await Application.findOne({ agent: agent._id });

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${created._id}/documents`)
    .set('Authorization', `Bearer ${agentToken}`)
    .field('kind', 'electricBill')
    .attach('file', makePng(712, 489, { noise: true }), {
      filename: 'bill.png',
      contentType: 'image/png',
    });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.qualityCheck.verdict, 'pass', JSON.stringify(res.body.data.qualityCheck));
});

test('api: a clear picture is accepted and stored', async () => {
  const created = await Application.findOne({ agent: agent._id });

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${created._id}/documents`)
    .set('Authorization', `Bearer ${agentToken}`)
    .field('kind', 'aadhaar')
    .attach('file', makePng(1000, 800, { noise: true }), {
      filename: 'aadhaar.png',
      contentType: 'image/png',
    });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.document.kind, 'aadhaar');
  assert.equal(res.body.data.qualityCheck.verdict, 'pass');
  assert.ok(res.body.data.document.url);

  // Assert this document landed, not the total count — earlier tests in this
  // file upload against the same shared draft.
  const refreshed = await Application.findById(created._id);
  const stored = refreshed.documents.id(res.body.data.document._id);
  assert.ok(stored, 'the uploaded document should be on the application');
  assert.equal(stored.qualityCheck.verdict, 'pass');
});

test('api: the electricity bill link points at the board portal', async () => {
  const created = await Application.findOne({ agent: agent._id });

  const res = await request(env.app)
    .put(`${API_PREFIX}/applications/${created._id}/electric-bill`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send({ consumerId: '1234567890', installationNo: 'AB1234567' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.body.data.portalUrl, /^https:\/\/portal\.wbsedcl\.in\//);
  assert.equal(res.body.data.electricBill.consumerId, '1234567890');
  assert.equal(res.body.data.electricBill.verified, false);
});

test('api: approval is refused while the names have not been checked', async () => {
  const created = await Application.findOne({ agent: agent._id });
  created.status = 'submitted';
  await created.save();

  const res = await request(env.app)
    .patch(`${API_PREFIX}/applications/${created._id}/review`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'approved' });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error.message, /name/i);
});

test('api: an approved application needs a verified bill first', async () => {
  const created = await Application.findOne({ agent: agent._id });
  created.status = 'submitted';
  created.nameMatch = { verdict: 'match', passed: true };
  await created.save();

  const res = await request(env.app)
    .patch(`${API_PREFIX}/applications/${created._id}/review`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'approved' });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error.message, /verify the electricity bill/i);
});

test('api: approving needs every required document accepted, then succeeds', async () => {
  const created = await Application.findOne({ agent: agent._id });

  // Verify the bill, and accept the one document that was uploaded.
  created.electricBill.verified = true;
  created.electricBill.verifiedAt = new Date();
  created.documents.forEach((doc) => {
    doc.review = { status: 'accepted', reviewedAt: new Date() };
  });
  // The other required documents still exist only as far as this check is
  // concerned, so add the missing ones as accepted placeholders.
  for (const kind of ['panCard', 'electricBill', 'rooftopPhoto', 'landRecord', 'passbookOrCheque']) {
    if (!created.documents.some((doc) => doc.kind === kind)) {
      created.documents.push({
        kind,
        url: `/uploads/${kind}.png`,
        fileName: `${kind}.png`,
        review: { status: 'accepted', reviewedAt: new Date() },
        qualityCheck: { verdict: 'pass' },
      });
    }
  }
  await created.save();

  const res = await request(env.app)
    .patch(`${API_PREFIX}/applications/${created._id}/review`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'approved', remark: 'All documents in order.' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'approved');
  assert.equal(res.body.data.statusHistory.at(-1).status, 'approved');
});

test('api: the generated PDF is never overwritten when the signed copy comes back', async () => {
  const created = await Application.findOne({ agent: agent._id });

  const res = await request(env.app)
    .post(`${API_PREFIX}/applications/${created._id}/signed-document`)
    .set('Authorization', `Bearer ${adminToken}`)
    .field('kind', 'signedQuotation')
    .attach('file', Buffer.from('%PDF-1.4 signed scan'), {
      filename: 'signed-quotation.pdf',
      contentType: 'application/pdf',
    });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.kind, 'signedQuotation');

  const refreshed = await Application.findById(created._id);
  const signed = refreshed.documents.filter((doc) => doc.kind === 'signedQuotation');
  assert.equal(signed.length, 1, 'the signed copy is stored as its own document');
});

test('api: status cannot skip a step', async () => {
  const created = await Application.findOne({ agent: agent._id });
  created.status = 'draft';
  await created.save();

  const res = await request(env.app)
    .patch(`${API_PREFIX}/applications/${created._id}/status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'completed' });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error.message, /cannot move/i);
});

test('api: the checklist endpoint describes the form', async () => {
  const res = await request(env.app)
    .get(`${API_PREFIX}/applications/checklist`)
    .set('Authorization', `Bearer ${agentToken}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.data.documents.some((doc) => doc.kind === 'electricBill'));
  assert.ok(res.body.data.siteTypes.some((site) => site.value === 'high_rise_structure'));
  assert.equal(res.body.data.billPortalUrl, BILL_PORTAL_URL);
});

test('api: the dashboard stats are scoped to the agent', async () => {
  const mine = await request(env.app)
    .get(`${API_PREFIX}/applications/stats`)
    .set('Authorization', `Bearer ${agentToken}`);
  const theirs = await request(env.app)
    .get(`${API_PREFIX}/applications/stats`)
    .set('Authorization', `Bearer ${agent2Token}`);

  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.data.totalApplications, 1);
  assert.equal(mine.body.data.uniqueConsumers, 1);
  assert.equal(theirs.body.data.totalApplications, 0, 'the second agent has no consumers yet');
});

test('api: a viewer cannot reach the application module at all', async () => {
  const res = await request(env.app)
    .get(`${API_PREFIX}/applications`)
    .set('Authorization', `Bearer ${env.viewerToken}`);

  assert.equal(res.status, 403, JSON.stringify(res.body));
});
