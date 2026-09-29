// tests/quotationNumberOverride.test.js
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestEnv, resetQuotations, API_PREFIX } from './helpers/testSetup.js';
import { Quotation } from '../src/models/index.js';

/**
 * The admin may type the quotation number instead of taking the next one, and a
 * number that is already on a live quotation is reported before the save.
 *
 * What the tests are really pinning down is that "taken" has two meanings here.
 * The sequence is global across schemes by design, so SE/PMSGY/2026-27/45 and
 * SE/BOB/2026-27/45 are the same serial 45: a number that has never been printed
 * can still be refused, and the answer has to say who holds the serial rather
 * than leaving the admin to guess. The other half of the promise is the one the
 * office cares about — a number that *is* free gets used exactly as typed, even
 * when it names a scheme the drop-down does not offer (BOB for a solar-partner
 * quotation), because the bank's printed copy already carries it.
 */

let env;
const base = `${API_PREFIX}/quotations`;

const asAdmin = (req) => req.set({ Authorization: `Bearer ${env.adminToken}` });

const validBody = (overrides = {}) => ({
  customerName: 'Souvik Ghosh',
  consumerId: '502178060',
  phoneNo: '9432665126',
  addressLine1: 'Birpur, Gurap',
  district: 'Hooghly',
  pincode: '712303',
  systemSizeKW: 3,
  panelWp: 610,
  panelBrand: 'Waaree/Adani',
  inverterCapacityKW: 3,
  inverterBrand: 'Deye/any',
  structureType: 'high_rise',
  amount: 195000,
  ...overrides,
});

const createQuotation = (overrides = {}) =>
  asAdmin(request(env.app).post(base)).send(validBody(overrides));

const checkNumber = (quotationNo, extraQuery = '') =>
  asAdmin(
    request(env.app).get(`${base}/check-number?quotationNo=${encodeURIComponent(quotationNo)}${extraQuery}`)
  );

const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  env = await startTestEnv();
});

after(async () => {
  await env.stop();
});

beforeEach(async () => {
  await resetQuotations();
});

// ===========================================================================
// The availability check
// ===========================================================================

test('check-number: a number nobody has used is free', async () => {
  const res = await checkNumber('SE/PMSGY/2026-27/45');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.available, true);
  assert.equal(res.body.data.quotationSeq, 45);
  assert.equal(res.body.data.financialYear, '2026-27');
  assert.equal(res.body.data.schemeCode, 'PMSGY');
  // Nothing is reserved by asking — the save still has to win the race.
  assert.equal(await Quotation.countDocuments({}), 0);
});

test('check-number: a number already saved says so, and names the consumer', async () => {
  const created = await createQuotation({ quotationNo: 'SE/BOB/2026-27/45' });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const res = await checkNumber('SE/BOB/2026-27/45');

  assert.equal(res.body.data.available, false);
  assert.equal(res.body.data.reason, 'duplicate');
  assert.match(res.body.data.message, /already saved/);
  assert.match(res.body.data.message, /another quotation number/i);
  assert.match(res.body.data.message, /Souvik Ghosh/);
});

test('check-number: a free-looking number is refused when another scheme holds that serial', async () => {
  await createQuotation({ quotationNo: 'SE/PMSGY/2026-27/45' });

  // Never printed, but serial 45 of 2026-27 is taken — the sequence is shared.
  const res = await checkNumber('SE/BOB/2026-27/45');

  assert.equal(res.body.data.available, false);
  assert.equal(res.body.data.reason, 'sequence_taken');
  assert.match(res.body.data.message, /Serial 45 of 2026-27/);
  assert.match(res.body.data.message, /SE\/PMSGY\/2026-27\/45/);
  assert.match(res.body.data.message, /another quotation number/i);
});

test('check-number: a malformed number is a format problem, not a clash', async () => {
  const res = await checkNumber('SE-2026-45');

  assert.equal(res.body.data.available, false);
  assert.equal(res.body.data.reason, 'format');
  assert.match(res.body.data.message, /SE\/PMSGY\/2026-27\/45/);
});

test('check-number: a serial from another financial year is refused against the issue date', async () => {
  const res = await checkNumber('SE/PMSGY/2025-26/7', `&issueDate=${today()}`);

  assert.equal(res.body.data.available, false);
  assert.equal(res.body.data.reason, 'financial_year');
  assert.match(res.body.data.message, /2025-26/);
  assert.match(res.body.data.message, /2026-27/);
});

test('check-number: a number left behind by a deleted quotation is free again', async () => {
  const created = await createQuotation({ quotationNo: 'SE/BOB/2026-27/45' });

  const removed = await asAdmin(
    request(env.app)
      .delete(`${base}/${created.body.data._id}`)
      .send({ reason: 'duplicate entry' })
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const res = await checkNumber('SE/BOB/2026-27/45');
  assert.equal(res.body.data.available, true);
});

test('check-number: the register is not open to a viewer', async () => {
  const res = await request(env.app)
    .get(`${base}/check-number?quotationNo=SE%2FPMSGY%2F2026-27%2F45`)
    .set({ Authorization: `Bearer ${env.viewerToken}` });

  assert.equal(res.status, 403, JSON.stringify(res.body));
});

// ===========================================================================
// Saving with a typed number
// ===========================================================================

test('create: a typed number is used exactly as given, and names the scheme', async () => {
  const res = await createQuotation({
    quotationNo: 'se/bob/2026-27/45', // lower case and sloppy spacing are tolerated
    schemeCode: 'PMSGY', // the number wins: it is what the printed copy says
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.quotationNo, 'SE/BOB/2026-27/45');
  assert.equal(res.body.data.schemeCode, 'BOB');
  assert.equal(res.body.data.quotationSeq, 45);
  assert.equal(res.body.data.financialYear, '2026-27');
});

test('create: a typed number that is already saved is refused, and nothing is written', async () => {
  await createQuotation({ quotationNo: 'SE/BOB/2026-27/45' });
  const before = await Quotation.countDocuments({});

  const res = await createQuotation({ quotationNo: 'SE/BOB/2026-27/45' });

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(JSON.stringify(res.body), /already saved/);
  assert.match(JSON.stringify(res.body), /another quotation number/i);
  // No silent fallback to a different number: the office asked for that one.
  assert.equal(await Quotation.countDocuments({}), before);
  assert.equal(await Quotation.countDocuments({ quotationNo: 'SE/BOB/2026-27/1' }), 0);
});

test('create: a typed number whose serial is taken is refused, naming the holder', async () => {
  await createQuotation({ quotationNo: 'SE/PMSGY/2026-27/45' });

  const res = await createQuotation({ quotationNo: 'SE/BOB/2026-27/45' });

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(JSON.stringify(res.body), /Serial 45 of 2026-27/);
  assert.equal(await Quotation.countDocuments({}), 1);
});

test('create: a malformed typed number is a validation error', async () => {
  const res = await createQuotation({ quotationNo: 'QUOTE-45' });

  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(await Quotation.countDocuments({}), 0);
});

test('create: a typed number from another financial year is refused', async () => {
  const res = await createQuotation({ quotationNo: 'SE/PMSGY/2025-26/7' });

  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.match(JSON.stringify(res.body), /2025-26/);
});

test('create: without a typed number the next free serial is still allocated', async () => {
  const first = await createQuotation();
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.quotationNo, 'SE/PMSGY/2026-27/1');

  const second = await createQuotation({
    customerName: 'Another Consumer',
    consumerId: '502178061',
    phoneNo: '9432665127',
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.data.quotationNo, 'SE/PMSGY/2026-27/2');
});

test('create: a typed number and an allocated one share the same series', async () => {
  // A hand-typed serial 9 then lets the allocator continue from 10 — a typed
  // number is a real entry in the register, not a side channel.
  const typed = await createQuotation({ quotationNo: 'SE/BOB/2026-27/9' });
  assert.equal(typed.status, 201, JSON.stringify(typed.body));

  const allocated = await createQuotation({
    customerName: 'Another Consumer',
    consumerId: '502178061',
    phoneNo: '9432665127',
  });

  assert.equal(allocated.body.data.quotationNo, 'SE/PMSGY/2026-27/10');
  assert.equal(allocated.body.data.quotationSeq, 10);
});

test('api: the check endpoint requires the number', async () => {
  const res = await asAdmin(request(env.app).get(`${base}/check-number`));
  assert.equal(res.status, 422, JSON.stringify(res.body));
});
