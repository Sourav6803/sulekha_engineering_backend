// tests/quotationContract.test.js
/**
 * Frontend contract test.
 *
 * The client reads exact paths out of the API envelope (`body.data`,
 * `body.pagination`, `body.message`, `body.data.quotation`, ...). Those paths
 * cannot be checked by the frontend build, so they are pinned here: if the
 * backend response shape ever changes, this file fails instead of a page
 * silently rendering nothing.
 *
 * The envelope is `{ success, message, data, pagination? }` - the array lives in
 * `data` and `pagination` is a SIBLING, never nested under `data.items`.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestEnv, resetQuotations, API_PREFIX } from './helpers/testSetup.js';

let env;
const base = `${API_PREFIX}/quotations`;
const asAdmin = (req) => req.set({ Authorization: `Bearer ${env.adminToken}` });

/** The payload shape the client's QuotationForm sends. */
const clientPayload = (overrides = {}) => ({
  customerName: 'Souvik Ghosh',
  consumerId: '502178060',
  phoneNo: '9432665126',
  addressLine1: 'Birpur, Gurap',
  district: 'Hooghly',
  pincode: '712303',
  systemSizeKW: 3,
  panelWp: 610,
  panelQty: 6,
  panelBrand: 'Waaree/Adani',
  inverterCapacityKW: 3,
  inverterBrand: 'Deye/any',
  structureType: 'high_rise',
  issueDate: new Date().toISOString().slice(0, 10),
  validityDays: 7,
  amount: 195000,
  amountIncludesGST: true,
  status: 'draft',
  schemeCode: 'PMSGY',
  ...overrides,
});

before(async () => {
  env = await startTestEnv();
});

after(async () => {
  await env.stop();
});

beforeEach(async () => {
  await resetQuotations();
});

test('contract: the list envelope is { data: [], pagination } - not data.items', async () => {
  await asAdmin(request(env.app).post(base)).send(clientPayload());

  const res = await asAdmin(request(env.app).get(`${base}?page=1&limit=20`));

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data), 'body.data must be the array');

  const [row] = res.body.data;
  assert.equal(typeof row.quotationNo, 'string');
  assert.equal(typeof row.customerName, 'string');
  assert.equal(typeof row.amount, 'number');
  assert.equal(typeof row.status, 'string');

  // pagination is a sibling of data
  assert.deepEqual(Object.keys(res.body.pagination).sort(), ['limit', 'page', 'pages', 'total']);
  assert.equal(typeof res.body.pagination.pages, 'number');
});

test('contract: create returns the new quotation in data plus a human message', async () => {
  const res = await asAdmin(request(env.app).post(base)).send(clientPayload());

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.match(res.body.message, /Quotation created: SE\/PMSGY\//);
  assert.equal(typeof res.body.data._id, 'string');
  assert.equal(res.body.data.quotationNo, 'SE/PMSGY/2026-27/1');
  assert.equal(res.body.data.customerName, 'Souvik Ghosh');
});

test('contract: defaults feeds the form its fixed terms and options', async () => {
  const res = await asAdmin(request(env.app).get(`${base}/defaults`));

  assert.equal(res.status, 200);
  const defaults = res.body.data;

  assert.equal(defaults.terms.length, 8);
  assert.match(defaults.terms[0].text, /The cost includes design, supply, installing and commissioning/);
  assert.equal(defaults.paymentTerms.length, 1);
  assert.equal(typeof defaults.quotationItemLimit, 'number');
  assert.equal(defaults.defaultPanelWp, 610);
  assert.equal(typeof defaults.panelSizingFactor, 'number');
  assert.equal(typeof defaults.validityDays, 'number');
  assert.ok(Array.isArray(defaults.schemes) && defaults.schemes.some((scheme) => scheme.code === 'PMSGY'));
  assert.ok(Array.isArray(defaults.structures) && defaults.structures.length >= 3);
});

test('contract: next-number returns the preview the form shows', async () => {
  const res = await asAdmin(request(env.app).get(`${base}/next-number`));

  assert.equal(res.status, 200);
  for (const key of ['quotationNo', 'quotationSeq', 'financialYear', 'schemeCode']) {
    assert.ok(key in res.body.data, `missing ${key}`);
  }
  assert.equal(res.body.data.quotationNo, 'SE/PMSGY/2026-27/1');
});

test('contract: the register returns slNo / details / date rows', async () => {
  await asAdmin(request(env.app).post(base)).send(clientPayload());

  const res = await asAdmin(request(env.app).get(`${base}/register?limit=50`));

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  const [row] = res.body.data;
  assert.equal(row.slNo, 1);
  assert.equal(typeof row.id, 'string');
  assert.equal(row.details, 'Souvik Ghosh');
  assert.ok('date' in row);
  assert.equal(typeof res.body.pagination.total, 'number');
});

test('contract: the detail carries everything the detail page renders', async () => {
  const created = await asAdmin(request(env.app).post(base)).send(clientPayload());
  const id = created.body.data._id;

  const res = await asAdmin(request(env.app).get(`${base}/${id}`));

  assert.equal(res.status, 200);
  const quotation = res.body.data;

  assert.ok(Array.isArray(quotation.items) && quotation.items.length === 8);
  assert.ok(Array.isArray(quotation.terms) && quotation.terms.length === 8);
  assert.ok(Array.isArray(quotation.paymentTerms) && quotation.paymentTerms.length === 1);
  assert.ok(Array.isArray(quotation.attachments));
  assert.ok(Array.isArray(quotation.revisions));
  assert.equal(quotation.companySnapshot.bankName, 'HDFC BANK');
  assert.equal(quotation.companySnapshot.stateCode, '19');
  assert.equal(typeof quotation.amountInWords, 'string');
  assert.equal(quotation.formattedAmount, '195000.00');
  assert.equal(quotation.isComplete, true);
});

test('contract: update returns { quotation, changedFields, warnings }', async () => {
  const created = await asAdmin(request(env.app).post(base)).send(clientPayload());
  const id = created.body.data._id;

  const res = await asAdmin(request(env.app).put(`${base}/${id}`)).send({ amount: 210000 });

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.message, 'string');
  assert.equal(res.body.data.quotation.amount, 210000);
  assert.ok(Array.isArray(res.body.data.changedFields));
  assert.ok(res.body.data.changedFields.includes('amount'));
  assert.deepEqual(res.body.data.warnings, []);
});

test('contract: delete returns numberFreed and a message the UI shows verbatim', async () => {
  const created = await asAdmin(request(env.app).post(base)).send(clientPayload());
  const id = created.body.data._id;

  const res = await asAdmin(request(env.app).delete(`${base}/${id}`).send({ reason: 'test' }));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.numberFreed, true);
  assert.equal(res.body.data.deletedSequence, 1);
  assert.equal(res.body.data.nextSequence, 1);
  assert.match(res.body.message, /free again/);
  assert.equal(res.body.data.quotation.isActive, false);
});

test('contract: status change and restore return the shapes the buttons expect', async () => {
  const created = await asAdmin(request(env.app).post(base)).send(clientPayload());
  const id = created.body.data._id;

  const status = await asAdmin(request(env.app).patch(`${base}/${id}/status`)).send({ status: 'sent' });
  assert.equal(status.status, 200);
  assert.equal(status.body.data.status, 'sent');

  await asAdmin(request(env.app).delete(`${base}/${id}`));
  const restored = await asAdmin(request(env.app).post(`${base}/${id}/restore`)).send({});

  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.reassigned, false);
  assert.equal(restored.body.data.quotation.isActive, true);
});

test('contract: stats provides the numbers the summary cards render', async () => {
  await asAdmin(request(env.app).post(base)).send(clientPayload());

  const res = await asAdmin(request(env.app).get(`${base}/stats`));

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.data.totalQuotations, 'number');
  assert.equal(typeof res.body.data.totalAmount, 'number');
  assert.equal(typeof res.body.data.byStatus.draft, 'number');
  assert.equal(typeof res.body.data.nextNumber, 'string');
  assert.equal(typeof res.body.data.financialYear, 'string');
});

test('contract: the document endpoints answer what the preview frame expects', async () => {
  const created = await asAdmin(request(env.app).post(base)).send(clientPayload());
  const id = created.body.data._id;

  const pdf = await asAdmin(request(env.app).get(`${base}/${id}/pdf?inline=1`).buffer(true));
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
  assert.equal(pdf.headers['x-document-pages'], '1');

  const print = await asAdmin(request(env.app).get(`${base}/${id}/print`));
  assert.equal(print.status, 200);
  assert.match(print.headers['content-type'], /text\/html/);
  assert.match(print.text, /SE\/PMSGY\/2026-27\/1/);
});

test('contract: validation errors carry the field map the form surfaces', async () => {
  const res = await asAdmin(request(env.app).post(base)).send({ customerName: 'Someone' });

  assert.equal(res.status, 422);
  assert.equal(res.body.success, false);
  assert.equal(typeof res.body.error.message, 'string');
  assert.ok(res.body.error.details, 'details must carry the field errors');
});
