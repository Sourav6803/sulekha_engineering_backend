// tests/quotationApi.test.js
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestEnv, resetQuotations, API_PREFIX } from './helpers/testSetup.js';
import { Quotation } from '../src/models/index.js';
import { LEGACY_REGISTER_ROWS } from '../src/data/legacyQuotationRegister.js';

let env;
const base = `${API_PREFIX}/quotations`;

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const asAdmin = (req) => req.set(auth(env.adminToken));

before(async () => {
  env = await startTestEnv();
});

after(async () => {
  await env.stop();
});

beforeEach(async () => {
  await resetQuotations();
});

/** Import the 24 rows of the legacy register (commit, not dry run). */
const seedRegister = async () => {
  const res = await asAdmin(request(env.app).post(`${base}/import/register`)).send({
    useLegacy: true,
    dryRun: false,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
};

const createQuotation = async (overrides = {}) => {
  const res = await asAdmin(request(env.app).post(base)).send({
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
  return res;
};

// ===========================================================================
// next number / numbering
// ===========================================================================

test('next-number: on an empty register the first number is 1', async () => {
  const res = await asAdmin(request(env.app).get(`${base}/next-number`));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.quotationNo, 'SE/PMSGY/2026-27/1');
  assert.equal(res.body.data.quotationSeq, 1);
});

test('next-number: previewing does not consume the number', async () => {
  const first = await asAdmin(request(env.app).get(`${base}/next-number`));
  const second = await asAdmin(request(env.app).get(`${base}/next-number`));

  assert.equal(first.body.data.quotationNo, second.body.data.quotationNo);
  assert.equal((await Quotation.countDocuments({})), 0);
});

test('next-number: an invalid scheme is rejected', async () => {
  const res = await asAdmin(request(env.app).get(`${base}/next-number?schemeCode=P`));
  assert.equal(res.status, 422);
});

// ===========================================================================
// register import
// ===========================================================================

test('import: a dry run reports the plan and writes nothing', async () => {
  const res = await asAdmin(request(env.app).post(`${base}/import/register`)).send({ useLegacy: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.dryRun, true);
  assert.equal(res.body.data.summary.valid, 24);
  assert.equal(res.body.data.summary.created, 0);
  assert.equal(res.body.data.nextNumberAfterImport.nextNumber, 'SE/PMSGY/2026-27/39');

  assert.equal(await Quotation.countDocuments({}), 0);

  const register = await asAdmin(request(env.app).get(`${base}/register`));
  assert.equal(register.body.pagination.total, 0);
});

test('import: committing creates the 24 rows and the next number becomes 39', async () => {
  const result = await seedRegister();

  assert.equal(result.summary.created, 24);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.nextNumberAfterImport.nextNumber, 'SE/PMSGY/2026-27/39');

  const next = await asAdmin(request(env.app).get(`${base}/next-number`));
  assert.equal(next.body.data.quotationNo, 'SE/PMSGY/2026-27/39');

  const stored = await Quotation.find({}).lean();
  assert.equal(stored.length, 24);
  assert.ok(stored.every((doc) => doc.isHistorical === true));
  assert.ok(stored.every((doc) => doc.status === 'sent'));
  assert.ok(stored.every((doc) => doc.items.length === 0));
});

test('import: number and financial year are taken verbatim from the sheet', async () => {
  await seedRegister();

  const rows = await Quotation.find({}).sort({ quotationSeq: 1 }).lean();
  const numbers = rows.map((row) => row.quotationNo);
  const sequences = rows.map((row) => row.quotationSeq);

  assert.equal(numbers[0], 'SE/GP/2026-27/10');
  assert.equal(numbers[1], 'SE/SOLAR/2026-27/11');
  assert.equal(numbers[numbers.length - 1], 'SE/PMSGY/2026-27/38');
  assert.equal(sequences[0], 10);
  assert.equal(sequences[sequences.length - 1], 38);

  // the two leading-space entries were cleaned
  assert.ok(numbers.includes('SE/PMSGY/2026-27/17'));
  assert.ok(numbers.includes('SE/PMSGY/2026-27/19'));

  // dates that were missing stay missing
  const kanchan = rows.find((row) => row.customerName === 'Kanchan Ghosh');
  assert.equal(kanchan.issueDate, null);
});

test('import: running it twice creates nothing new and reports the skips', async () => {
  await seedRegister();
  const second = await seedRegister();

  assert.equal(second.summary.created, 0);
  assert.equal(second.summary.skipped, 24);
  assert.equal(await Quotation.countDocuments({}), 24);
});

test('import: rows supplied directly are accepted and validated', async () => {
  const res = await asAdmin(request(env.app).post(`${base}/import/register`)).send({
    dryRun: true,
    rows: [
      { slNo: 1, quotationNo: 'SE/PMSGY/2026-27/5', details: 'Valid Person', date: '01.05.2026' },
      { slNo: 2, quotationNo: 'SE/PMSGY/2026-27/5', details: 'Duplicate Person' },
      { slNo: 3, quotationNo: 'not-a-number', details: 'Broken Person' },
    ],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.summary.valid, 1);
  assert.equal(res.body.data.summary.duplicates, 1);
  assert.equal(res.body.data.summary.invalid, 1);
});

test('import: an empty request is rejected with a clear message', async () => {
  const res = await asAdmin(request(env.app).post(`${base}/import/register`)).send({});

  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /Nothing to import/);
});

// ===========================================================================
// register view
// ===========================================================================

test('register: reproduces the sheet order with recomputed SL numbers', async () => {
  await seedRegister();

  const res = await asAdmin(request(env.app).get(`${base}/register?limit=50`));

  assert.equal(res.status, 200);
  assert.equal(res.body.pagination.total, 24);
  assert.equal(res.body.data.length, 24);

  const [first, second] = res.body.data;
  assert.equal(first.slNo, 1);
  assert.equal(first.quotationNo, 'SE/GP/2026-27/10');
  assert.equal(first.details, 'HARAL GP');
  assert.equal(second.slNo, 2);
  assert.equal(second.quotationNo, 'SE/SOLAR/2026-27/11');

  const last = res.body.data[23];
  assert.equal(last.slNo, 24);
  assert.equal(last.quotationNo, 'SE/PMSGY/2026-27/38');
  assert.equal(last.details, 'Souvik Ghosh');
  assert.equal(last.isHistorical, true);

  // the register reports the original sheet SL number for reference
  assert.equal(first.importedSlNo, 3);
});

test('register: searching by name and by number works', async () => {
  await seedRegister();

  const byName = await asAdmin(request(env.app).get(`${base}/register?search=Arindam`));
  assert.equal(byName.body.pagination.total, 1);
  assert.equal(byName.body.data[0].quotationNo, 'SE/PMSGY/2026-27/26');

  const byNumber = await asAdmin(request(env.app).get(`${base}/register?search=2026-27/27`));
  assert.equal(byNumber.body.pagination.total, 1);
  assert.equal(byNumber.body.data[0].details, 'Kurmitar');
});

test('register: regex metacharacters in the search are escaped, not executed', async () => {
  await seedRegister();

  const res = await asAdmin(request(env.app).get(`${base}/register?search=(a%2B)%2B%24`));
  assert.equal(res.status, 200);
  assert.equal(res.body.pagination.total, 0);
});

// ===========================================================================
// create
// ===========================================================================

test('create: after the register the next quotation is 39', async () => {
  await seedRegister();

  const res = await createQuotation();
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.quotationNo, 'SE/PMSGY/2026-27/39');
  assert.equal(res.body.data.quotationSeq, 39);
  assert.equal(res.body.data.financialYear, '2026-27');
  assert.equal(res.body.data.status, 'draft');
  assert.equal(res.body.data.isHistorical, false);
});

test('create: the response carries the company snapshot and derived fields', async () => {
  const res = await createQuotation();
  const quotation = res.body.data;

  assert.equal(quotation.companySnapshot.name, 'SULEKHA ENGINEERING');
  assert.equal(quotation.companySnapshot.gstn, '19ADXFS9993G1ZW');
  assert.equal(quotation.companySnapshot.stateCode, '19');
  assert.equal(quotation.companySnapshot.bankName, 'HDFC BANK');
  assert.match(quotation.companySnapshot.quotationTitle, /PM Surya Ghar/);

  assert.equal(quotation.amountInWords, 'One Lakh Ninety Five Thousand Rupees Only');
  assert.equal(quotation.formattedAmount, '195000.00');
  assert.equal(quotation.validityDays, 7);
  assert.ok(quotation.validUntil);
});

test('create: the BOQ template is pre-filled and sized from the system', async () => {
  const res = await createQuotation();
  const { items, panelQty } = res.body.data;

  // 3 kW, 610 Wp, DC oversizing 1.2 -> 6 panels (matches the manual quotation)
  assert.equal(panelQty, 6);
  assert.equal(items.length, 8);
  assert.equal(items[0].qty, 6);
  assert.equal(items[0].brandModel, 'Waaree/Adani');
  assert.match(items[0].description, /610 wp/);
  assert.match(items[1].description, /Capacity: 3KW/);
  assert.equal(items[2].description, 'solar roof top high-rise GI structures, SS nut bolt');
  assert.equal(items[2].unit, 'lot');
  // two lines of the template genuinely have no unit
  assert.equal(items[3].unit, null);
  assert.equal(items[4].unit, null);

  assert.match(res.body.data.systemOverview, /3 kw solar panel system with 3 kw ongrid inverter/);
  assert.match(res.body.data.systemOverview, /solar roof top high rise structures/);
  assert.equal(res.body.data.terms.length, 8);
  assert.equal(res.body.data.paymentTerms.length, 1);
});

test('terms: a client cannot override the fixed terms or payment terms', async () => {
  const res = await createQuotation({
    terms: [{ text: 'Our own special term' }],
    paymentTerms: [{ text: '100% cash upfront' }],
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));

  // the fixed company wording won, in the stored copy and on the document
  assert.equal(res.body.data.terms.length, 8);
  assert.equal(res.body.data.paymentTerms.length, 1);
  assert.ok(res.body.data.terms.every((term) => !term.text.includes('Our own special term')));
  assert.equal(res.body.data.paymentTerms[0].text.includes('100% cash upfront'), false);

  const print = await asAdmin(request(env.app).get(`${base}/${res.body.data._id}/print`));
  assert.doesNotMatch(print.text, /Our own special term/);
  assert.match(print.text, /No warranty on physical damage\./);
});

test('terms: an update cannot change them either', async () => {
  const created = await createQuotation();
  const id = created.body.data._id;

  const res = await asAdmin(request(env.app).put(`${base}/${id}`)).send({
    notes: 'legitimate change',
    terms: [{ text: 'replaced' }],
    paymentTerms: [{ text: 'replaced' }],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.quotation.terms.length, 8);
  assert.equal(res.body.data.quotation.paymentTerms.length, 1);
  assert.match(res.body.data.quotation.paymentTerms[0].text, /50% advance with order/);
});

test('terms: a register-only record still prints the fixed terms', async () => {
  // Imported rows carry no terms of their own; the document must not come out blank.
  const register = await asAdmin(request(env.app).post(`${base}/import/register`)).send({
    useLegacy: true,
    dryRun: false,
  });
  assert.equal(register.status, 200);

  const list = await asAdmin(request(env.app).get(`${base}/register?limit=1`));
  const row = list.body.data[0];
  assert.equal(row.details, 'HARAL GP');

  const print = await asAdmin(request(env.app).get(`${base}/${row.id}/print`));
  assert.equal(print.status, 200);
  assert.match(print.text, /Terms &amp; Condition:/);
  assert.match(print.text, /No warranty on physical damage\./);
  assert.match(print.text, /50% advance with order/);
});

test('create: tin shed wording replaces the structure line', async () => {
  const res = await createQuotation({ structureType: 'tin_shed' });
  assert.match(res.body.data.items[2].description, /tin shed/i);
  assert.match(res.body.data.systemOverview, /tin shed structures/);
});

test('create: amount follows the BOQ line amounts when no total is given', async () => {
  const res = await createQuotation({
    amount: undefined,
    items: [
      { description: 'Panel', qty: 6, unit: 'nos', amount: 120000 },
      { description: 'Inverter', qty: 1, unit: 'nos', amount: 75000 },
    ],
  });

  assert.equal(res.body.data.amount, 195000);
  assert.equal(res.body.data.amountInWords, 'One Lakh Ninety Five Thousand Rupees Only');
});

test('create: a caller supplied total wins over the line amounts', async () => {
  const res = await createQuotation({
    amount: 150000,
    items: [{ description: 'Panel', qty: 6, unit: 'nos', amount: 120000 }],
  });

  assert.equal(res.body.data.amount, 150000);
});

test('create: numbers increase one at a time (39, 40, 41)', async () => {
  await seedRegister();

  const first = await createQuotation();
  const second = await createQuotation({ customerName: 'Amarnath Daw' });
  const third = await createQuotation({ customerName: 'Raj Kumar Dawn' });

  assert.equal(first.body.data.quotationNo, 'SE/PMSGY/2026-27/39');
  assert.equal(second.body.data.quotationNo, 'SE/PMSGY/2026-27/40');
  assert.equal(third.body.data.quotationNo, 'SE/PMSGY/2026-27/41');
});

test('create: a different scheme changes the prefix but not the sequence', async () => {
  await seedRegister();

  const res = await createQuotation({ schemeCode: 'GP' });
  assert.equal(res.body.data.quotationNo, 'SE/GP/2026-27/39');
  assert.equal(res.body.data.quotationSeq, 39);
});

test('create: server-owned fields in the body are ignored', async () => {
  // `quotationNo` is not in this list on purpose: since the office may type the
  // number itself, the body value is honoured rather than ignored. That path has
  // its own tests in quotationNumberOverride.test.js. Everything the server
  // still owns stays ignored.
  const res = await createQuotation({
    quotationSeq: 999,
    financialYear: '2099-00',
    isActive: false,
    isHistorical: true,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.quotationNo, 'SE/PMSGY/2026-27/1');
  assert.equal(res.body.data.quotationSeq, 1);
  assert.equal(res.body.data.financialYear, '2026-27');
  assert.equal(res.body.data.isActive, true);
  assert.equal(res.body.data.isHistorical, false);
});

test('create: rejects more BOQ lines than fit on one page', async () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ description: `Line ${i + 1}`, qty: 1, unit: 'nos' }));
  const res = await createQuotation({ items });

  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'QUOTATION_OVERFLOW');
  assert.equal(res.body.error.details.itemLimit, 14);
  assert.equal(res.body.error.details.received, 15);
});

test('create: invalid input returns a field level validation error', async () => {
  const missingSize = await asAdmin(request(env.app).post(base)).send({ customerName: 'Someone' });
  assert.equal(missingSize.status, 422);
  assert.ok(missingSize.body.error.details.systemSizeKW);

  const badUnit = await createQuotation({ items: [{ description: 'x', qty: 1, unit: 'piece' }] });
  assert.equal(badUnit.status, 422);
});

test('create: a customer name is required even when no customer is linked', async () => {
  const res = await asAdmin(request(env.app).post(base)).send({ systemSizeKW: 3, customerName: '  ' });
  assert.equal(res.status, 422);
});

test('create: a quotation can be back-dated into an earlier financial year', async () => {
  await seedRegister();
  await createQuotation(); // 39 in 2026-27

  const res = await createQuotation({ issueDate: '2025-06-10' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.financialYear, '2025-26');
  // that year's own sequence starts from 1 and is independent
  assert.equal(res.body.data.quotationNo, 'SE/PMSGY/2025-26/1');
});

test('create: a date more than 30 days in the future is refused', async () => {
  const res = await createQuotation({ issueDate: '2027-04-05' });
  assert.equal(res.status, 422);
  assert.ok(res.body.error.details.issueDate);
});

// ===========================================================================
// read / list
// ===========================================================================

test('list: pagination, ordering and filters', async () => {
  await seedRegister();
  await createQuotation({ customerName: 'Test One' });
  await createQuotation({ customerName: 'Test Two' });

  const all = await asAdmin(request(env.app).get(`${base}?limit=100`));
  assert.equal(all.body.pagination.total, 26);
  assert.equal(all.body.pagination.pages, 1);

  // default sort: highest sequence first
  assert.equal(all.body.data[0].quotationSeq, 40);

  const paged = await asAdmin(request(env.app).get(`${base}?page=2&limit=10`));
  assert.equal(paged.body.data.length, 10);
  assert.equal(paged.body.pagination.pages, 3);

  const search = await asAdmin(request(env.app).get(`${base}?search=Test One`));
  assert.equal(search.body.pagination.total, 1);

  const byScheme = await asAdmin(request(env.app).get(`${base}?schemeCode=MBECL`));
  assert.equal(byScheme.body.pagination.total, 1);
  assert.equal(byScheme.body.data[0].details ?? byScheme.body.data[0].customerName, 'Kurmitar');

  const historical = await asAdmin(request(env.app).get(`${base}?isHistorical=false`));
  assert.equal(historical.body.pagination.total, 2);
});

test('get by id: 404 for a well formed unknown id, 400 for a malformed one', async () => {
  const unknown = await asAdmin(request(env.app).get(`${base}/60d5ec49f1b2c8a1e4f1a111`));
  assert.equal(unknown.status, 404);

  const malformed = await asAdmin(request(env.app).get(`${base}/not-an-id`));
  assert.equal(malformed.status, 422);
});

// ===========================================================================
// update
// ===========================================================================

test('update: saves changes, records a revision and recomputes the words', async () => {
  const created = await createQuotation();
  const id = created.body.data._id;

  const res = await asAdmin(request(env.app).put(`${base}/${id}`)).send({
    amount: 210000,
    addressLine2: 'Near the temple',
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.changedFields.sort(), ['addressLine2', 'amount', 'amountInWords']);
  assert.equal(res.body.data.quotation.amount, 210000);
  assert.equal(res.body.data.quotation.amountInWords, 'Two Lakh Ten Thousand Rupees Only');
  assert.equal(res.body.data.warnings.length, 0);

  const stored = await Quotation.findById(id).lean();
  assert.equal(stored.revisions.length, 1);
  assert.equal(stored.revisions[0].action, 'update');
  assert.equal(stored.revisions[0].previousValues.amount, 195000);
});

test('update: refuses to change the scheme (the number embeds it)', async () => {
  const created = await createQuotation();
  const res = await asAdmin(request(env.app).put(`${base}/${created.body.data._id}`)).send({ schemeCode: 'GP' });

  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /scheme cannot be changed/);
});

test('update: cannot forge the number, sequence or soft delete state', async () => {
  const created = await createQuotation();
  const id = created.body.data._id;

  const res = await asAdmin(request(env.app).put(`${base}/${id}`)).send({
    notes: 'trying to forge the number',
    quotationNo: 'SE/PMSGY/2026-27/999',
    quotationSeq: 999,
    financialYear: '2099-00',
    isActive: false,
    isHistorical: true,
    attachments: [{ url: 'https://evil.example.com/fake.pdf', kind: 'other' }],
    revisions: [{ action: 'update' }],
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const stored = await Quotation.findById(id).lean();
  assert.equal(stored.quotationNo, 'SE/PMSGY/2026-27/1');
  assert.equal(stored.quotationSeq, 1);
  assert.equal(stored.financialYear, '2026-27');
  assert.equal(stored.isActive, true);
  assert.equal(stored.isHistorical, false);
  assert.equal(stored.attachments.length, 0);
  assert.equal(stored.notes, 'trying to forge the number');
});

test('update: status changes are logged', async () => {
  const created = await createQuotation();
  const id = created.body.data._id;

  const res = await asAdmin(request(env.app).patch(`${base}/${id}/status`)).send({ status: 'accepted' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'accepted');

  const again = await asAdmin(request(env.app).patch(`${base}/${id}/status`)).send({ status: 'accepted' });
  assert.equal(again.status, 200);
  assert.match(again.body.message, /already accepted/);
});

// ===========================================================================
// soft delete / number reuse  (the core requirement)
// ===========================================================================

test('delete: removes the quotation from BOTH the register and the list', async () => {
  await seedRegister();
  const created = await createQuotation({ customerName: 'Delete Me' });
  const id = created.body.data._id;

  const before = await asAdmin(request(env.app).get(`${base}/register?limit=100`));
  assert.equal(before.body.pagination.total, 25);

  const del = await asAdmin(request(env.app).delete(`${base}/${id}`)).send({ reason: 'Duplicate entry' });
  assert.equal(del.status, 200);
  assert.equal(del.body.data.numberFreed, true);

  const registerAfter = await asAdmin(request(env.app).get(`${base}/register?limit=100`));
  assert.equal(registerAfter.body.pagination.total, 24);

  const listAfter = await asAdmin(request(env.app).get(`${base}?limit=100`));
  assert.equal(listAfter.body.pagination.total, 24);

  const stored = await Quotation.findById(id).lean();
  assert.equal(stored.isActive, false);
  assert.equal(stored.deleteReason, 'Duplicate entry');
  assert.ok(stored.deletedAt);
});

test('delete: deleting the LAST quotation frees its number for the next one', async () => {
  await seedRegister();

  const first = await createQuotation({ customerName: 'Souvik Ghosh' });
  assert.equal(first.body.data.quotationNo, 'SE/PMSGY/2026-27/39');

  const del = await asAdmin(request(env.app).delete(`${base}/${first.body.data._id}`));
  assert.equal(del.status, 200);
  assert.equal(del.body.data.numberFreed, true);
  assert.equal(del.body.data.nextSequence, 39);
  assert.match(del.body.message, /free again/);

  const next = await asAdmin(request(env.app).get(`${base}/next-number`));
  assert.equal(next.body.data.quotationNo, 'SE/PMSGY/2026-27/39');

  const recreated = await createQuotation({ customerName: 'Another Person' });
  assert.equal(recreated.body.data.quotationNo, 'SE/PMSGY/2026-27/39');
});

test('delete: deleting a number in the middle keeps the gap', async () => {
  await seedRegister();

  const a = await createQuotation({ customerName: 'Alpha Kumar' }); // 39
  const b = await createQuotation({ customerName: 'Bravo Das' }); // 40
  const c = await createQuotation({ customerName: 'Charlie Ray' }); // 41
  [a, b, c].forEach((res) => assert.equal(res.status, 201, JSON.stringify(res.body)));

  const del = await asAdmin(request(env.app).delete(`${base}/${b.body.data._id}`));
  assert.equal(del.body.data.numberFreed, false);
  assert.equal(del.body.data.nextSequence, 42);
  assert.match(del.body.message, /highest number in use/);

  // 39 and 41 survive, 40 is gone, and the next is still 42
  const register = await asAdmin(request(env.app).get(`${base}/register?limit=100`));
  const numbers = register.body.data.map((row) => row.quotationNo);
  assert.ok(numbers.includes('SE/PMSGY/2026-27/39'));
  assert.ok(numbers.includes('SE/PMSGY/2026-27/41'));
  assert.ok(!numbers.includes('SE/PMSGY/2026-27/40'));

  const next = await asAdmin(request(env.app).get(`${base}/next-number`));
  assert.equal(next.body.data.quotationNo, 'SE/PMSGY/2026-27/42');

  assert.ok(a.body.data.quotationNo && c.body.data.quotationNo);
});

test('delete: a deleted quotation can be restored while its number is free', async () => {
  const created = await createQuotation({ customerName: 'Restore Me' });
  const id = created.body.data._id;

  await asAdmin(request(env.app).delete(`${base}/${id}`));

  const restored = await asAdmin(request(env.app).post(`${base}/${id}/restore`)).send({});
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.reassigned, false);
  assert.equal(restored.body.data.quotation.quotationNo, 'SE/PMSGY/2026-27/1');
  assert.equal(restored.body.data.quotation.isActive, true);
});

test('restore: blocked when the number has been reissued, then possible with a new number', async () => {
  const original = await createQuotation({ customerName: 'Original' }); // 1
  const originalId = original.body.data._id;

  await asAdmin(request(env.app).delete(`${base}/${originalId}`));
  const replacement = await createQuotation({ customerName: 'Replacement' });
  assert.equal(replacement.body.data.quotationNo, 'SE/PMSGY/2026-27/1');

  const conflict = await asAdmin(request(env.app).post(`${base}/${originalId}/restore`)).send({});
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'QUOTATION_NUMBER_IN_USE');
  assert.equal(conflict.body.error.details.conflictingQuotationNo, 'SE/PMSGY/2026-27/1');

  const reassigned = await asAdmin(request(env.app).post(`${base}/${originalId}/restore`)).send({ assignNewNumber: true });
  assert.equal(reassigned.status, 200);
  assert.equal(reassigned.body.data.reassigned, true);
  assert.equal(reassigned.body.data.previousNumber, 'SE/PMSGY/2026-27/1');
  assert.equal(reassigned.body.data.quotation.quotationNo, 'SE/PMSGY/2026-27/2');
});

test('delete: restoring something that is not deleted is rejected', async () => {
  const created = await createQuotation();
  const res = await asAdmin(request(env.app).post(`${base}/${created.body.data._id}/restore`)).send({});
  assert.equal(res.status, 409);
});

test('delete: deleting twice is rejected', async () => {
  const created = await createQuotation();
  const id = created.body.data._id;

  assert.equal((await asAdmin(request(env.app).delete(`${base}/${id}`))).status, 200);
  const second = await asAdmin(request(env.app).delete(`${base}/${id}`));
  assert.equal(second.status, 409);
});

// ===========================================================================
// concurrency
// ===========================================================================

test('concurrency: four simultaneous creates get four different numbers', async () => {
  await seedRegister();

  const responses = await Promise.all([
    createQuotation({ customerName: 'Race One' }),
    createQuotation({ customerName: 'Race Two' }),
    createQuotation({ customerName: 'Race Three' }),
    createQuotation({ customerName: 'Race Four' }),
  ]);

  responses.forEach((res) => assert.equal(res.status, 201, JSON.stringify(res.body)));

  const numbers = responses.map((res) => res.body.data.quotationNo);
  assert.equal(new Set(numbers).size, 4, `duplicate numbers issued: ${numbers.join(', ')}`);
  assert.deepEqual(numbers.slice().sort(), [
    'SE/PMSGY/2026-27/39',
    'SE/PMSGY/2026-27/40',
    'SE/PMSGY/2026-27/41',
    'SE/PMSGY/2026-27/42',
  ]);

  assert.equal(await Quotation.countDocuments({ isActive: true }), 28);
});

test('concurrency: a duplicate number is impossible at the database level', async () => {
  const created = await createQuotation();

  // Bypass the service and try to insert the same live number again.
  await assert.rejects(
    () =>
      Quotation.create({
        quotationNo: created.body.data.quotationNo,
        quotationSeq: created.body.data.quotationSeq,
        financialYear: created.body.data.financialYear,
        schemeCode: 'PMSGY',
        customerName: 'Sneaky',
        systemSizeKW: 3,
      }),
    (error) => error.code === 11000
  );
});

test('concurrency: after a soft delete the number may legitimately be reused', async () => {
  const created = await createQuotation();
  await asAdmin(request(env.app).delete(`${base}/${created.body.data._id}`));

  const reused = await createQuotation({ customerName: 'Reuse' });
  assert.equal(reused.status, 201);
  assert.equal(reused.body.data.quotationNo, 'SE/PMSGY/2026-27/1');

  const total = await Quotation.countDocuments({});
  assert.equal(total, 2); // one deleted, one live
});

// ===========================================================================
// access control
// ===========================================================================

test('access: an anonymous request is rejected', async () => {
  const res = await request(env.app).get(`${base}`);
  assert.equal(res.status, 401);
});

test('access: a viewer can read but not create, update or delete', async () => {
  const created = await createQuotation();

  const read = await request(env.app).get(`${base}`).set(auth(env.viewerToken));
  assert.equal(read.status, 200);

  const create = await request(env.app).post(base).set(auth(env.viewerToken)).send({ systemSizeKW: 3 });
  assert.equal(create.status, 403);

  const update = await request(env.app)
    .put(`${base}/${created.body.data._id}`)
    .set(auth(env.viewerToken))
    .send({ amount: 1 });
  assert.equal(update.status, 403);

  const del = await request(env.app).delete(`${base}/${created.body.data._id}`).set(auth(env.viewerToken));
  assert.equal(del.status, 403);

  const importAttempt = await request(env.app)
    .post(`${base}/import/register`)
    .set(auth(env.viewerToken))
    .send({ useLegacy: true });
  assert.equal(importAttempt.status, 403);
});

test('access: the register and stats views are reachable by any signed in user', async () => {
  await seedRegister();

  const register = await request(env.app).get(`${base}/register`).set(auth(env.viewerToken));
  assert.equal(register.status, 200);

  const stats = await request(env.app).get(`${base}/stats`).set(auth(env.viewerToken));
  assert.equal(stats.status, 200);
  assert.equal(stats.body.data.totalQuotations, 24);
  assert.equal(stats.body.data.byStatus.sent, 24);
  assert.equal(stats.body.data.maxSequence, 38);
  assert.equal(stats.body.data.nextNumber, 'SE/PMSGY/2026-27/39');
});

// ===========================================================================
// stats
// ===========================================================================

test('stats: totals follow the financial year', async () => {
  await seedRegister();
  await createQuotation({ customerName: 'This Year', amount: 195000 });
  await createQuotation({ customerName: 'Last Year', issueDate: '2025-06-10', amount: 100000 });

  const current = await asAdmin(request(env.app).get(`${base}/stats?financialYear=2026-27`));
  assert.equal(current.body.data.totalQuotations, 25);
  assert.equal(current.body.data.totalAmount, 195000);
  assert.equal(current.body.data.historical, 24);

  const earlier = await asAdmin(request(env.app).get(`${base}/stats?financialYear=2025-26`));
  assert.equal(earlier.body.data.totalQuotations, 1);
  assert.equal(earlier.body.data.totalAmount, 100000);
  assert.equal(earlier.body.data.nextNumber, 'SE/PMSGY/2025-26/2');
});

test('legacy data integrity: the built-in rows match the sheet', () => {
  assert.equal(LEGACY_REGISTER_ROWS.length, 24);
  assert.equal(LEGACY_REGISTER_ROWS[0].quotationNo, 'SE/GP/2026-27/10');
  assert.equal(LEGACY_REGISTER_ROWS[23].quotationNo, 'SE/PMSGY/2026-27/38');
});

// ===========================================================================
// document endpoints (PDF + print)
// ===========================================================================

test('document: the pdf endpoint returns a one page pdf', async () => {
  const created = await createQuotation();
  const id = created.body.data._id;

  const res = await asAdmin(request(env.app).get(`${base}/${id}/pdf`).buffer(true));

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.equal(res.headers['x-document-pages'], '1');
  assert.equal(res.headers['x-document-font-size'], '8');
  assert.match(res.headers['content-disposition'], /attachment; filename="SE-PMSGY-2026-27-1-Souvik Ghosh\.pdf"/);

  const buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body || '');
  if (buffer.length > 0) {
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  }
});

test('document: inline=1 previews the pdf in the browser', async () => {
  const created = await createQuotation();
  const res = await asAdmin(request(env.app).get(`${base}/${created.body.data._id}/pdf?inline=1`).buffer(true));

  assert.equal(res.status, 200);
  assert.match(res.headers['content-disposition'], /^inline; filename=/);
});

test('document: the print endpoint returns the same markup as the pdf', async () => {
  const created = await createQuotation();

  const res = await asAdmin(request(env.app).get(`${base}/${created.body.data._id}/print`));

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /Quote No: SE\/PMSGY\/2026-27\/1/);
  assert.match(res.text, /Souvik Ghosh/);
  assert.match(res.text, /class="doc-toolbar no-print"/);
  assert.match(res.text, /@page \{ size: A4 portrait; margin: 8mm; \}/);
});

test('document: a viewer may print but not download the pdf', async () => {
  const created = await createQuotation();
  const id = created.body.data._id;

  const print = await request(env.app).get(`${base}/${id}/print`).set(auth(env.viewerToken));
  assert.equal(print.status, 200);

  const pdf = await request(env.app).get(`${base}/${id}/pdf`).set(auth(env.viewerToken));
  assert.equal(pdf.status, 403);
});

test('document: a deleted quotation still renders (its number is kept for reprints)', async () => {
  const created = await createQuotation();
  const id = created.body.data._id;

  await asAdmin(request(env.app).delete(`${base}/${id}`));

  const res = await asAdmin(request(env.app).get(`${base}/${id}/print`));
  assert.equal(res.status, 200);
  assert.match(res.text, /SE\/PMSGY\/2026-27\/1/);
});
