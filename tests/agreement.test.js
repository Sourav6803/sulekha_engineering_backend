// tests/agreement.test.js
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestEnv, resetQuotations, API_PREFIX } from './helpers/testSetup.js';
import { Agreement, Quotation } from '../src/models/index.js';
import { buildAgreementSnapshot } from '../src/services/agreement.service.js';
import {
  buildAgreementHTML,
  buildFooterTemplate,
  renderAgreementPdf,
  measureAgreementLayout,
  countPdfPages,
  closeBrowser,
  STAMP_PAPER_GAP_MM,
} from '../src/services/agreementPdf.service.js';
import {
  buildPaymentSchedule,
  formatAgreementDateParts,
  formatRupeeSplit,
  formatRupeeTotal,
  composeConsumerLine,
} from '../src/utils/agreementText.js';
import { DEFAULT_REGISTERED_OFFICE } from '../src/data/agreementContent.js';
import { DEFAULT_PROFILE } from '../src/models/CompanyProfile.js';

// ===========================================================================
// helpers
// ===========================================================================

const baseAgreement = {
  consumerName: 'Aparna Pramanik',
  consumerId: '102370374',
  relationLine: 'W/o-dharanidhar Pramanick',
  address: 'Madaribar,gutinagori,shyampur,howrah, Pin- 711315',
  discom: 'WBSEDCL',
  agreementDate: new Date(2026, 8, 23),
  amount: 176000,
};

const fullAgreement = (overrides = {}) => ({
  ...baseAgreement,
  paymentSchedule: buildPaymentSchedule(baseAgreement.amount),
  companySnapshot: buildAgreementSnapshot({ ...DEFAULT_PROFILE }),
  ...overrides,
});

let env;
const base = `${API_PREFIX}/agreements`;
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const asAdmin = (req) => req.set(auth(env.adminToken));

before(async () => {
  env = await startTestEnv();
});

after(async () => {
  await closeBrowser();
  await env.stop();
});

beforeEach(async () => {
  await resetQuotations();
  await Agreement.deleteMany({});
});

// ===========================================================================
// date and money helpers
// ===========================================================================

test('date: printed as DD(Day) MM (Month) YYYY (Year)', () => {
  assert.deepEqual(formatAgreementDateParts(new Date(2026, 8, 23)), {
    day: '23',
    month: '09',
    year: '2026',
  });
  // single digits are zero padded, exactly like the original document
  assert.deepEqual(formatAgreementDateParts('2027-01-05T00:00:00'), {
    day: '05',
    month: '01',
    year: '2027',
  });
  assert.equal(formatAgreementDateParts('not a date'), null);
});

test('money: the total has no decimals when whole, the split always has two', () => {
  assert.equal(formatRupeeTotal(176000), '176000');
  assert.equal(formatRupeeTotal('176000'), '176000');
  assert.equal(formatRupeeTotal(176000.5), '176000.50');
  assert.equal(formatRupeeSplit(88000), '88000.00');
  assert.equal(formatRupeeSplit(17600), '17600.00');
});

test('split: 176000 becomes 88000.00 / 70400.00 / 17600.00', () => {
  const schedule = buildPaymentSchedule(176000);

  assert.equal(schedule.length, 3);
  assert.deepEqual(
    schedule.map((stage) => stage.percent),
    [50, 40, 10]
  );
  assert.deepEqual(
    schedule.map((stage) => stage.amountText),
    ['88000.00', '70400.00', '17600.00']
  );
  assert.equal(schedule[0].label, 'a)');
  assert.match(schedule[0].note, /An advance payment of 50% of the total project value/);
  assert.match(schedule[1].note, /prior to dispatch of materials/);
  assert.match(schedule[2].note, /testing and commissioning of the solar PV system/);
});

test('split: the three amounts always add up to the total, even for odd values', () => {
  for (const amount of [195001, 176000.33, 99999.99, 1, 0]) {
    const schedule = buildPaymentSchedule(amount);
    const sum = schedule.reduce((total, stage) => total + stage.amount, 0);
    assert.equal(
      Math.round(sum * 100) / 100,
      Math.round(amount * 100) / 100,
      `split of ${amount} did not add up (${sum})`
    );
  }
});

test('split: refuses a schedule whose percentages do not make 100', () => {
  assert.throws(
    () => buildPaymentSchedule(100000, [{ label: 'a)', percent: 60, note: '' }]),
    /must add up to 100/
  );
});

test('consumer line: relation prefix is optional', () => {
  assert.equal(
    composeConsumerLine({ relationLine: 'W/o-dharanidhar Pramanick', address: 'Madaribar, Pin- 711315' }),
    'W/o-dharanidhar Pramanick, Madaribar, Pin- 711315'
  );
  assert.equal(composeConsumerLine({ relationLine: '', address: 'Madaribar' }), 'Madaribar');
  assert.equal(composeConsumerLine({ relationLine: 'S/o-Ramesh', address: '' }), 'S/o-Ramesh');
});

// ===========================================================================
// the four page document
// ===========================================================================

test('html: page 1 carries the date field', () => {
  const html = buildAgreementHTML(fullAgreement());
  assert.match(html, /This agreement is executed on 23\(Day\) 09 \(Month\) 2026 \(Year\)/);
});

test('html: page 1 carries the consumer name, consumer id, discom and address', () => {
  const html = buildAgreementHTML(fullAgreement());

  assert.match(html, /Aparna Pramanik having a residential electricity connection with consumer id 102370374 From WBSEDCL \(DISCOM\) at W\/o-dharanidhar Pramanick, Madaribar,gutinagori,shyampur,howrah, Pin- 711315/);
  // vendor side is fixed company data, including the Jamalpur wording
  assert.match(html, /registered office at Uttarsura, Surekalna, Jamalpur, Purba Bardhaman, West Bengal-713408/);
});

test('html: page 4 carries the amount and the 50/40/10 split', () => {
  const html = buildAgreementHTML(fullAgreement());

  assert.match(html, /The cost of RTS system will be Rs\.176000\/\(to be decided mutually\)/);
  assert.match(html, /50%\(Rs\. 88000\.00\)/);
  assert.match(html, /40%\(Rs\. 70400\.00\)/);
  assert.match(html, /10%\(Rs\. 17600\.00\)/);
});

test('html: the first party signature repeats the consumer name and address from page 1', () => {
  const html = buildAgreementHTML(fullAgreement());
  const signatureBlock = html.slice(html.indexOf('First Party') - 200);

  assert.match(signatureBlock, /Name:- Aparna Pramanik/);
  assert.match(signatureBlock, /Address:- W\/o-dharanidhar Pramanick, Madaribar,gutinagori,shyampur,howrah, Pin- 711315/);
  assert.match(signatureBlock, /Name:- SULEKHA ENGINEERING/);
  assert.match(signatureBlock, /Address:- Uttarsura, Surekalna, Jamalpur, Purba Bardhaman, West Bengal-713408/);
});

test('html: signature dates are left blank for handwriting', () => {
  const html = buildAgreementHTML(fullAgreement());
  const signatureBlock = html.slice(html.indexOf('First Party') - 200);

  assert.equal((html.match(/Sign:-/g) || []).length, 2);
  assert.equal((html.match(/Date:-/g) || []).length, 2);
  // nothing printed after "Date:-", the signer fills it in by hand
  assert.doesNotMatch(html, /Date:- ?\d/);
});

test('html: every clause from the source document survives', () => {
  const html = buildAgreementHTML(fullAgreement());

  assert.match(html, /The First Party hereby undertakes to perform the following activities:/);
  assert.match(html, /Submission of online application at National Portal/);
  assert.match(html, /The Second Party hereby undertakes to perform the following activities:/);
  assert.match(html, /Performance Ratio \(PR\) of Plant must be 75%/);
  assert.match(html, /Mutually Agreed Terms of Payment:/);
  assert.match(html, /Disclaimer: This agreement is between vendor and consumer/);
  assert.match(html, /PM – Surya Ghar: Muft Bijli Yojana/);
});

test('html: page 1 keeps the stamp paper gap, before the title', () => {
  const html = buildAgreementHTML(fullAgreement());

  assert.match(html, /class="stamp-gap"/);
  assert.match(html, new RegExp(`height: ${STAMP_PAPER_GAP_MM}mm`));
  // the gap has to come first: the text starts on the stamp paper
  assert.ok(
    html.indexOf('stamp-gap') < html.indexOf('doc-title'),
    'the stamp paper gap must precede the title'
  );
});

test('html: four explicit pages, split the same way as the issued agreement', () => {
  const html = buildAgreementHTML(fullAgreement());

  assert.equal((html.match(/<section class="page"/g) || []).length, 4);

  const pages = html.split('<section class="page"');
  assert.equal(pages.length, 5, 'expected four page sections');

  // page 1 ends with "And whereas"; page 2 opens with the vendor's second pledge
  assert.match(pages[1], /And whereas/);
  assert.doesNotMatch(pages[1], /Second Party has verified/);
  assert.match(pages[2], /Second Party has verified/);
  assert.match(pages[2], /The Second Party hereby undertakes/);

  // page 3 holds vendor clauses 6..18 and nothing of the payment clause
  assert.match(pages[3], /18\. Performance of Plant/);
  assert.doesNotMatch(pages[3], /Mutually Agreed Terms of Payment/);

  // page 4 opens with clause 19
  assert.match(pages[4], /Mutually Agreed Terms of Payment/);
  assert.match(pages[4], /First Party/);
});

test('footer: only the guidelines and the page number, no printed vendor stamp', () => {
  const footer = buildFooterTemplate();

  assert.match(footer, /Guidelines for PM-Surya Ghar: Muft Bijli Yojana/);
  assert.match(footer, /Central Financial Assistance to Residential Consumers/);
  assert.match(footer, /class="pageNumber"/);

  // the pages are signed by hand on the company's own stamp paper after
  // printing, so nothing of the sort may be printed into the footer
  assert.doesNotMatch(footer, /SULEKHA ENGINEERING/);
  assert.doesNotMatch(footer, /Partner/);
  assert.doesNotMatch(footer, /Sign/);
});

test('html: the base font size follows the Word file', () => {
  const html = buildAgreementHTML(fullAgreement());
  assert.match(html, /font-size: 11pt/);
  // the CSS page margin must match the pdf() margin, otherwise Chrome uses the
  // CSS one and the text runs into the paper edge
  assert.match(html, /@page \{ size: A4 portrait; margin: 24mm 20mm 32mm 22\.5mm; \}/);
});

test('html: the two clause headings are underlined, as in the issued document', () => {
  const html = buildAgreementHTML(fullAgreement());
  assert.match(html, /class="heading">The First Party hereby undertakes/);
  assert.match(html, /class="heading" data-mark="second-party-heading">The Second Party hereby undertakes/);
  assert.match(html, /\.heading \{ font-weight: 700; text-decoration: underline;/);
});

test('html: template values are escaped', () => {
  const html = buildAgreementHTML(fullAgreement({ consumerName: '<script>alert(1)</script> Kishori' }));

  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('html: a long address still renders without pushing the font choice', () => {
  const longAddress = 'W/o-Prafulla Kumar Chakraborty, House No 42/1, Rabindra Sarani, Near Kali Bari, Ward 12, Panskura, Purba Medinipur, West Bengal, Pin- 721139';
  const html = buildAgreementHTML(fullAgreement({ relationLine: '', address: longAddress }));
  assert.match(html, /House No 42\/1/);
});

// ===========================================================================
// pdf
// ===========================================================================

test('layout: every block fits its page, and the content sits on the right page', async () => {
  const layout = await measureAgreementLayout(fullAgreement(), { fontSize: 11 });

  assert.equal(layout.blocks.length, 4);
  assert.ok(layout.fits, `a page overflows: ${JSON.stringify(layout.blocks)}`);

  assert.equal(layout.marks['stamp-gap-end'], 1);
  assert.equal(layout.marks['page-2-start'], 2);
  assert.equal(layout.marks['second-party-heading'], 2);
  assert.equal(layout.marks['page-3-end'], 3);
  assert.equal(layout.marks['clause-19'], 4);
  assert.equal(layout.marks['signature-block'], 4);
});

test('pdf: renders as exactly four A4 pages at 11 pt', async () => {
  const { buffer, fontSize, pages } = await renderAgreementPdf(fullAgreement());

  assert.ok(buffer.length > 5000, 'pdf looks too small');
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pages, 4);
  assert.equal(countPdfPages(buffer), 4);
  assert.equal(fontSize, 11, 'the agreement is tuned to the Word file font size');
});

// ===========================================================================
// api + contract
// ===========================================================================

test('api: defaults feed the form the fixed wording', async () => {
  const res = await asAdmin(request(env.app).get(`${base}/defaults`));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.discom, 'WBSEDCL');
  assert.equal(res.body.data.registeredOffice, DEFAULT_REGISTERED_OFFICE);
  assert.equal(res.body.data.paymentStages.length, 3);
  assert.deepEqual(
    res.body.data.paymentStages.map((stage) => stage.percent),
    [50, 40, 10]
  );
});

test('api: create stores the agreement and builds its own payment schedule', async () => {
  const res = await asAdmin(request(env.app).post(base)).send({
    consumerName: baseAgreement.consumerName,
    consumerId: baseAgreement.consumerId,
    relationLine: baseAgreement.relationLine,
    address: baseAgreement.address,
    agreementDate: '2026-09-23',
    amount: 176000,
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.consumerName, 'Aparna Pramanik');
  assert.equal(res.body.data.paymentSchedule.length, 3);
  assert.equal(res.body.data.paymentSchedule[0].amountText, '88000.00');
  assert.equal(res.body.data.paymentSchedule[2].amountText, '17600.00');
  assert.equal(res.body.data.discom, 'WBSEDCL');
  assert.equal(res.body.data.companySnapshot.registeredOffice, DEFAULT_REGISTERED_OFFICE);
  assert.match(res.body.message, /Agreement created for Aparna Pramanik/);

  const stored = await Agreement.findOne({ consumerName: 'Aparna Pramanik' }).lean();
  assert.equal(stored.paymentSchedule.length, 3);
  assert.equal(stored.isActive, true);
});

test('api: a quotation can prefill the consumer details and the amount', async () => {
  const quotationRes = await asAdmin(request(env.app).post(`${API_PREFIX}/quotations`)).send({
    customerName: 'Souvik Ghosh',
    consumerId: '502178060',
    addressLine1: 'Birpur, Gurap',
    addressLine2: 'Hooghly',
    pincode: '712303',
    systemSizeKW: 3,
    amount: 195000,
  });
  assert.equal(quotationRes.status, 201, JSON.stringify(quotationRes.body));

  const res = await asAdmin(request(env.app).post(base)).send({
    quotation: quotationRes.body.data._id,
    agreementDate: '2026-09-23',
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.consumerName, 'Souvik Ghosh');
  assert.equal(res.body.data.consumerId, '502178060');
  assert.equal(res.body.data.amount, 195000);
  assert.equal(res.body.data.quotationNo, 'SE/PMSGY/2026-27/1');
  assert.equal(res.body.data.address, 'Birpur, Gurap, Hooghly, Pin- 712303');

  // 50 / 40 / 10 of the quotation amount
  assert.deepEqual(
    res.body.data.paymentSchedule.map((stage) => stage.amountText),
    ['97500.00', '78000.00', '19500.00']
  );
});

test('api: the amount can be overridden after pulling it from a quotation', async () => {
  const quotationRes = await asAdmin(request(env.app).post(`${API_PREFIX}/quotations`)).send({
    customerName: 'Override Test',
    addressLine1: 'Station Road',
    district: 'Bankura',
    pincode: '722101',
    systemSizeKW: 5,
    amount: 250000,
  });
  assert.equal(quotationRes.status, 201, JSON.stringify(quotationRes.body));

  const res = await asAdmin(request(env.app).post(base)).send({
    quotation: quotationRes.body.data._id,
    amount: 240000,
    agreementDate: '2026-09-23',
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.amount, 240000);
  assert.equal(res.body.data.paymentSchedule[0].amountText, '120000.00');
  assert.equal(res.body.data.paymentSchedule[1].amountText, '96000.00');
  assert.equal(res.body.data.paymentSchedule[2].amountText, '24000.00');
});

test('api: updating the amount rebuilds the split', async () => {
  const created = await asAdmin(request(env.app).post(base)).send({
    consumerName: 'Rebuild Test',
    address: 'Somewhere, Pin- 711315',
    agreementDate: '2026-09-23',
    amount: 100000,
  });

  const res = await asAdmin(request(env.app).put(`${base}/${created.body.data._id}`)).send({
    amount: 200000,
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.agreement.amount, 200000);
  assert.deepEqual(
    res.body.data.agreement.paymentSchedule.map((stage) => stage.amountText),
    ['100000.00', '80000.00', '20000.00']
  );
  assert.ok(res.body.data.changedFields.includes('amount'));
});

test('api: list searches by consumer name and paginates', async () => {
  await asAdmin(request(env.app).post(base)).send({
    consumerName: 'Aparna Pramanik',
    consumerId: '102370374',
    address: 'Madaribar, Pin- 711315',
    agreementDate: '2026-09-23',
    amount: 176000,
  });
  await asAdmin(request(env.app).post(base)).send({
    consumerName: 'Souvik Ghosh',
    consumerId: '502178060',
    address: 'Birpur, Pin- 712303',
    agreementDate: '2026-09-22',
    amount: 195000,
  });

  const all = await asAdmin(request(env.app).get(`${base}?limit=10`));
  assert.equal(all.status, 200);
  assert.equal(all.body.data.length, 2);
  assert.equal(all.body.pagination.total, 2);
  // newest first
  assert.equal(all.body.data[0].consumerName, 'Aparna Pramanik');

  const search = await asAdmin(request(env.app).get(`${base}?search=souvik`));
  assert.equal(search.body.data.length, 1);
  assert.equal(search.body.data[0].consumerName, 'Souvik Ghosh');

  const byConsumerId = await asAdmin(request(env.app).get(`${base}?search=102370374`));
  assert.equal(byConsumerId.body.data.length, 1);
});

test('api: soft delete hides it everywhere but keeps the record', async () => {
  const created = await asAdmin(request(env.app).post(base)).send({
    consumerName: 'Delete Me',
    address: 'Nowhere, Pin- 700001',
    agreementDate: '2026-09-23',
    amount: 50000,
  });

  const del = await asAdmin(request(env.app).delete(`${base}/${created.body.data._id}`)).send({
    reason: 'test',
  });
  assert.equal(del.status, 200);
  assert.match(del.body.message, /deleted/);

  const list = await asAdmin(request(env.app).get(base));
  assert.equal(list.body.data.length, 0);

  const stored = await Agreement.findById(created.body.data._id).lean();
  assert.equal(stored.isActive, false);
  assert.equal(stored.deleteReason, 'test');

  const withDeleted = await asAdmin(request(env.app).get(`${base}?includeDeleted=true`));
  assert.equal(withDeleted.body.data.length, 1);

  // deleting twice is a conflict, not a crash
  const again = await asAdmin(request(env.app).delete(`${base}/${created.body.data._id}`));
  assert.equal(again.status, 409);
});

test('api: the pdf endpoint returns the four page document', async () => {
  const created = await asAdmin(request(env.app).post(base)).send({
    consumerName: 'Aparna Pramanik',
    consumerId: '102370374',
    address: 'Madaribar,gutinagori,shyampur,howrah, Pin- 711315',
    agreementDate: '2026-09-23',
    amount: 176000,
  });

  const res = await asAdmin(
    request(env.app).get(`${base}/${created.body.data._id}/pdf`).buffer(true)
  );

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.equal(res.headers['x-document-pages'], '4');
  assert.match(res.headers['content-disposition'], /Aparna Pramanik-agreement\.pdf/);

  const buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body || '');
  if (buffer.length > 0) {
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal(countPdfPages(buffer), 4);
  }
});

test('api: print returns the same four pages as html', async () => {
  const created = await asAdmin(request(env.app).post(base)).send({
    consumerName: 'Print Test',
    address: 'Somewhere, Pin- 711315',
    agreementDate: '2026-09-23',
    amount: 176000,
  });

  const res = await asAdmin(request(env.app).get(`${base}/${created.body.data._id}/print`));

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /class="stamp-gap"/);
  assert.match(res.text, /Print Test having a residential electricity connection/);
  assert.match(res.text, /Rs\.176000\//);
  assert.match(res.text, /doc-toolbar/);
});

test('api: validation and access rules', async () => {
  // no quotation linked and no consumer details given -> the service rejects it
  const missing = await asAdmin(request(env.app).post(base)).send({ consumerName: 'X' });
  assert.equal(missing.status, 422);
  // the error envelope nests field errors under error.details
  assert.ok(
    Object.keys(missing.body.error.details || {}).length > 0,
    `expected field level errors, got ${JSON.stringify(missing.body)}`
  );

  const badAmount = await asAdmin(request(env.app).post(base)).send({
    consumerName: 'Bad Amount',
    address: 'Somewhere',
    amount: -5,
  });
  assert.equal(badAmount.status, 422);

  const farFuture = await asAdmin(request(env.app).post(base)).send({
    consumerName: 'Future',
    address: 'Somewhere',
    amount: 1000,
    agreementDate: '2027-06-01',
  });
  assert.equal(farFuture.status, 422);

  const unknownId = await asAdmin(request(env.app).get(`${base}/64b7f1c9f1c9f1c9f1c9f1c9`));
  assert.equal(unknownId.status, 404);

  const malformed = await asAdmin(request(env.app).get(`${base}/not-an-id`));
  assert.equal(malformed.status, 422);

  const viewerPost = await request(env.app)
    .post(base)
    .set(auth(env.viewerToken))
    .send({ consumerName: 'Viewer', address: 'Somewhere', amount: 1000 });
  assert.equal(viewerPost.status, 403);

  const noAuth = await request(env.app).get(base);
  assert.equal(noAuth.status, 401);
});
