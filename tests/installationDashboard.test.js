// tests/installationDashboard.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import config from '../src/config/env.js';
import { startTestEnv, API_PREFIX } from './helpers/testSetup.js';
import Installation from '../src/models/Installation.js';
import Customer from '../src/models/Customer.js';
import { User } from '../src/models/index.js';

/**
 * The installation department's board.
 *
 * A fitter sees the jobs he is on and nothing else; the office sees the pipeline.
 * `teamAssigned` is the only thing that decides which is which.
 */

let env;
let crewA;
let crewB;
let crewAToken;
let crewBToken;
let installationId;
/** The account shape already in the database: role `agent`, department `installation`. */
let legacyCrew;
let legacyCrewToken;
let outsiderAgentToken;

const asAdmin = (call) => call.set('Authorization', `Bearer ${env.adminToken}`);

const tokenFor = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role, permissions: user.permissions || [] },
    config.JWT_SECRET,
    { expiresIn: '1h', algorithm: config.JWT_ALGORITHM }
  );

before(async () => {
  env = await startTestEnv();
  await Installation.init();

  crewA = await User.createUser({
    name: 'Crew A',
    email: 'crew.a@example.com',
    phone: '9832261860',
    password: 'Str0ngPass!23',
    role: 'installation_team',
    status: 'active',
  });
  crewB = await User.createUser({
    name: 'Crew B',
    email: 'crew.b@example.com',
    phone: '9832261861',
    password: 'Str0ngPass!23',
    role: 'installation_team',
    status: 'active',
  });

  crewAToken = tokenFor(crewA);
  crewBToken = tokenFor(crewB);

  legacyCrew = await User.createUser({
    name: 'Rakesh Das',
    email: 'rakesh.crew@example.com',
    phone: '8345057928',
    password: 'Str0ngPass!23',
    role: 'agent',
    department: 'installation',
    status: 'active',
  });
  legacyCrewToken = tokenFor(legacyCrew);

  const agent = await User.createUser({
    name: 'Board Agent',
    email: 'board.agent@example.com',
    phone: '9832261862',
    password: 'Str0ngPass!23',
    role: 'agent',
    department: 'sales',
    status: 'active',
  });
  outsiderAgentToken = tokenFor(agent);

  const customer = await Customer.create({
    customerId: 'CUS-960001',
    name: 'Board Customer',
    phone: '9832261863',
    address: 'Village Road',
    district: 'Hooghly',
    city: 'Gurap',
    state: 'West Bengal',
    pincode: '712303',
    systemSizeKW: 3,
    roofType: 'tin_shed',
    status: 'active',
    ownerAgent: agent._id,
    electricBill: { consumerId: '9988776655', installationNo: 'INS-616161' },
    verification: { status: 'verified', by: env.admin._id, at: new Date() },
  });

  const filed = await asAdmin(request(env.app).post(`${API_PREFIX}/applications`)).send({
    customer: String(customer._id),
    siteType: 'tin_shed',
    deal: { systemSizeKW: 3, proposalAmount: 150000 },
  });

  // Local date, not `toISOString()`: at 00:59 IST that still says yesterday.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  const created = await asAdmin(request(env.app).post(`${API_PREFIX}/installations`)).send({
    application: filed.body.data._id,
    installDate: today,
  });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  installationId = created.body.data.installation._id;
});

after(async () => {
  await env.stop();
});

test('api: the office assigns a crew to a job', async () => {
  const res = await asAdmin(
    request(env.app).patch(`${API_PREFIX}/installations/${installationId}/team`)
  ).send({
    members: [
      { member: String(crewA._id), role: 'lead' },
      { member: String(legacyCrew._id), role: 'technician' },
    ],
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));

  const stored = await Installation.findById(installationId).lean();
  assert.equal(stored.teamAssigned.length, 2);
  assert.equal(String(stored.teamAssigned[0].member), String(crewA._id));
  assert.equal(stored.teamAssigned[0].role, 'lead');
});

test('api: an assigned fitter sees the job, an unassigned one does not', async () => {
  const assigned = await request(env.app)
    .get(`${API_PREFIX}/installations`)
    .set('Authorization', `Bearer ${crewAToken}`);

  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.data.length, 1);

  const other = await request(env.app)
    .get(`${API_PREFIX}/installations`)
    .set('Authorization', `Bearer ${crewBToken}`);

  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal(other.body.data.length, 0, "a fitter saw a job he is not on");
});

test('api: the crew board counts their own jobs and the evidence still missing', async () => {
  const res = await request(env.app)
    .get(`${API_PREFIX}/installations/dashboard`)
    .set('Authorization', `Bearer ${crewAToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.scope, 'mine');
  assert.equal(res.body.data.counts.active, 1);
  assert.equal(res.body.data.counts.today, 1);
  assert.equal(res.body.data.counts.evidencePending, 1);
  assert.equal(res.body.data.jobs.length, 1);
  assert.ok(res.body.data.jobs[0].gaps > 0, 'a fresh job should still be missing evidence');
});

test('api: the office board is the whole pipeline, not one crew', async () => {
  const res = await asAdmin(request(env.app).get(`${API_PREFIX}/installations/dashboard`));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.scope, 'all');
  assert.ok(res.body.data.counts.active >= 1);
});

test('api: an installer created as role agent + department installation gets the crew board', async () => {
  const res = await request(env.app)
    .get(`${API_PREFIX}/installations/dashboard`)
    .set('Authorization', `Bearer ${legacyCrewToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(
    res.body.data.scope,
    'mine',
    'a role-agent account in the installation department was treated as sales'
  );
  assert.equal(res.body.data.counts.active, 1);
  assert.equal(res.body.data.jobs.length, 1);
});

test('api: the same installer may record evidence — the department grants the crew floor', async () => {
  const res = await request(env.app)
    .post(`${API_PREFIX}/installations/${installationId}/panels`)
    .set('Authorization', `Bearer ${legacyCrewToken}`)
    .send({ serial: 'PANEL-LEGACY-0001' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.panelUnits.length, 1);
  assert.equal(res.body.data.panelUnits[0].serial, 'PANEL-LEGACY-0001');
});

test('api: a sales agent does not get the crew board', async () => {
  const res = await request(env.app)
    .get(`${API_PREFIX}/installations/dashboard`)
    .set('Authorization', `Bearer ${outsiderAgentToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.scope, 'all', 'a sales login was scoped like a fitter');
});

test('api: taking somebody off the job removes it from their board', async () => {
  const cleared = await asAdmin(
    request(env.app).patch(`${API_PREFIX}/installations/${installationId}/team`)
  ).send({ members: [] });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));

  const res = await request(env.app)
    .get(`${API_PREFIX}/installations/dashboard`)
    .set('Authorization', `Bearer ${crewAToken}`);

  assert.equal(res.body.data.counts.active, 0);
  assert.equal(res.body.data.jobs.length, 0);
});
