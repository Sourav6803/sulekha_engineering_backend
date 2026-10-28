// tests/quotationTerms.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestEnv, API_PREFIX } from './helpers/testSetup.js';
import Quotation from '../src/models/Quotation.js';

/**
 * Terms and payment terms are the sheet's own, not the company's only.
 *
 * They still start from the standard wording — the office should not have to type
 * eleven lines every time — but a sheet occasionally needs a clause the standard
 * block does not carry: an extra AMC year, a different GST note, a partner's
 * payment split. Before this, they were copied from the CompanyProfile and a
 * client could not write them at all.
 */

let env;

const asAdmin = (call) => call.set('Authorization', `Bearer ${env.adminToken}`);

const base = () => ({
  customerName: 'Aparna Pramanik',
  consumerId: '502178060',
  addressLine1: 'Birpur, Gurap',
  district: 'Hooghly',
  pincode: '712303',
  systemSizeKW: 3,
  amount: 176000,
});

before(async () => {
  env = await startTestEnv();
  await Quotation.init();
});

after(async () => {
  await env.stop();
});

test('api: a quotation stores the terms it was written with', async () => {
  const res = await asAdmin(request(env.app).post(`${API_PREFIX}/quotations`)).send({
    ...base(),
    terms: [
      { text: 'Warranty: 10 years on modules, 10 years on the inverter.' },
      { text: 'AMC free for the first two years after commissioning.' },
    ],
    paymentTerms: [{ text: '70% with the order, 20% before dispatch, 10% after commissioning.' }],
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.terms.length, 2);
  assert.match(res.body.data.terms[1].text, /AMC free/);
  assert.equal(res.body.data.paymentTerms.length, 1);
  assert.match(res.body.data.paymentTerms[0].text, /70%/);

  const stored = await Quotation.findById(res.body.data._id).lean();
  assert.equal(stored.terms.length, 2);
  assert.match(stored.paymentTerms[0].text, /20% before dispatch/);
});

test('api: without any terms sent, the company wording is still applied', async () => {
  const res = await asAdmin(request(env.app).post(`${API_PREFIX}/quotations`)).send(base());

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.data.terms.length > 0, 'a blank terms block was printed');
  assert.ok(res.body.data.paymentTerms.length > 0);
});

test('api: a term can be reworded on an edit, and blanks are dropped', async () => {
  const created = await asAdmin(request(env.app).post(`${API_PREFIX}/quotations`)).send({
    ...base(),
    customerName: 'Edit Terms',
    terms: [{ text: 'Original wording.' }],
  });

  assert.equal(created.status, 201, JSON.stringify(created.body));

  const res = await asAdmin(
    request(env.app).put(`${API_PREFIX}/quotations/${created.body.data._id}`)
  ).send({
    terms: [{ text: 'Reworded after the site visit.' }, { text: '   ' }],
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.quotation.terms.length, 1, 'an empty line survived');
  assert.equal(res.body.data.quotation.terms[0].text, 'Reworded after the site visit.');
});

test('api: clearing every line falls back to what the sheet already had', async () => {
  const created = await asAdmin(request(env.app).post(`${API_PREFIX}/quotations`)).send({
    ...base(),
    customerName: 'Cleared Terms',
    terms: [{ text: 'Keep me.' }],
  });

  const res = await asAdmin(
    request(env.app).put(`${API_PREFIX}/quotations/${created.body.data._id}`)
  ).send({ terms: [] });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(
    res.body.data.quotation.terms[0].text,
    'Keep me.',
    'an empty list wiped the block instead of leaving it alone'
  );
});
