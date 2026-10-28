// tests/installationFromApplication.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import config from '../src/config/env.js';
import { startTestEnv, API_PREFIX } from './helpers/testSetup.js';
import Application from '../src/models/Application.js';
import Customer from '../src/models/Customer.js';
import Installation from '../src/models/Installation.js';
import { User } from '../src/models/index.js';

/**
 * An installation is created *from an application*.
 *
 * The picker offers only applications whose customer has no installation yet, and
 * the four facts that identify the job — quotation number, system size, roof type,
 * customer — are read from the application rather than typed. The project number
 * is assigned serially by the server.
 */

let env;
let agent;
let customerId;
let applicationId;
let quotationNo;

const asAdmin = (call) => call.set('Authorization', `Bearer ${env.adminToken}`);

before(async () => {
  env = await startTestEnv();
  await Installation.init();

  agent = await User.createUser({
    name: 'Install Agent',
    email: 'install.agent@example.com',
    phone: '9832261800',
    password: 'Str0ngPass!23',
    role: 'agent',
    status: 'active',
  });

  const customer = await Customer.create({
    customerId: 'CUS-930001',
    name: 'Install Candidate',
    phone: '9832261801',
    address: 'Village Road',
    district: 'Hooghly',
    city: 'Gurap',
    state: 'West Bengal',
    pincode: '712303',
    systemSizeKW: 4,
    roofType: 'tin_shed',
    status: 'active',
    ownerAgent: agent._id,
    electricBill: { consumerId: '7788990011', installationNo: 'INS-313131' },
    verification: { status: 'verified', by: env.admin._id, at: new Date() },
  });
  customerId = String(customer._id);

  const filed = await asAdmin(request(env.app).post(`${API_PREFIX}/applications`)).send({
    customer: customerId,
    siteType: 'tin_shed',
    deal: { systemSizeKW: 4, proposalAmount: 200000 },
  });

  assert.equal(filed.status, 201, JSON.stringify(filed.body));
  applicationId = filed.body.data._id;

  // A quotation, linked the way the issue endpoint links it. Created through the
  // API so the scheme code, financial year and sequence are assigned for real.
  const createdQuotation = await asAdmin(request(env.app).post(`${API_PREFIX}/quotations`)).send({
    customer: customerId,
    customerName: 'Install Candidate',
    quotationType: 'consumer',
    systemSizeKW: 4,
    amount: 200000,
  });

  assert.equal(createdQuotation.status, 201, JSON.stringify(createdQuotation.body));

  await Application.updateOne(
    { _id: applicationId },
    { quotation: createdQuotation.body.data._id }
  );
  quotationNo = createdQuotation.body.data.quotationNo;
});

after(async () => {
  await env.stop();
});

test('api: the list offers only applications with no installation yet', async () => {
  const res = await asAdmin(request(env.app).get(`${API_PREFIX}/installations/installable-applications`));

  assert.equal(res.status, 200, JSON.stringify(res.body));

  const row = res.body.data.find((item) => item._id === applicationId);
  assert.ok(row, 'the application waiting for installation is missing');
  assert.equal(row.systemSizeKW, 4);
  assert.equal(row.roofType, 'tin_shed');
  assert.equal(row.quotationNo, quotationNo);
  assert.equal(row.consumerName, 'Install Candidate');
});

test('api: the installation takes its facts from the application, not the payload', async () => {
  const res = await asAdmin(request(env.app).post(`${API_PREFIX}/installations`)).send({
    application: applicationId,
    // Deliberately wrong: the server must read these from the application.
    systemSizeKW: 99,
    roofType: 'ground_mount',
    quotationNo: 'WRONG/1',
    projectNo: 'MANUAL-1',
    installDate: '2026-11-05',
    laborCost: 4500,
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));

  const installation = res.body.data.installation;
  assert.equal(installation.systemSizeKW, 4, 'the posted system size won over the application');
  assert.equal(installation.roofType, 'tin_shed');
  assert.equal(installation.quotationNo, quotationNo, 'the posted quotation number won');
  assert.equal(String(installation.application), String(applicationId));
  assert.match(installation.projectNo, /^PRJ-\d{4}-\d{4}$/, 'project number was not assigned serially');
  assert.notEqual(installation.projectNo, 'MANUAL-1');
});

test('api: the installed application drops out of the list', async () => {
  const res = await asAdmin(request(env.app).get(`${API_PREFIX}/installations/installable-applications`));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(
    res.body.data.some((item) => item._id === applicationId),
    false,
    'an installed application is still being offered'
  );
});

test('api: a second installation for the same customer is refused', async () => {
  const res = await asAdmin(request(env.app).post(`${API_PREFIX}/installations`)).send({
    application: applicationId,
    installDate: '2026-11-06',
  });

  assert.equal(res.status, 409, JSON.stringify(res.body));
});
