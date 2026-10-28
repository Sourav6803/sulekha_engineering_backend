// tests/installationEvidence.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import config from '../src/config/env.js';
import { startTestEnv, API_PREFIX } from './helpers/testSetup.js';
import Installation from '../src/models/Installation.js';
import Customer from '../src/models/Customer.js';
import Application from '../src/models/Application.js';
import { User } from '../src/models/index.js';

// A 1x1 PNG — enough for the storage layer, which does not judge content.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+pP8WAAAAAElFTkSuQmCC',
  'base64'
);

/**
 * The roof evidence: panel serials and photos, the two site pictures, the
 * inverter. A job is only "completed" once all of it exists.
 */

let env;
let crew;
let crewToken;
let agent;
let installationId;

const tokenFor = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role, permissions: user.permissions || [] },
    config.JWT_SECRET,
    { expiresIn: '1h', algorithm: config.JWT_ALGORITHM }
  );

const asAdmin = (call) => call.set('Authorization', `Bearer ${env.adminToken}`);
const asCrew = (call) => call.set('Authorization', `Bearer ${crewToken}`);

before(async () => {
  env = await startTestEnv();
  await Installation.init();

  crew = await User.createUser({
    name: 'Crew Member',
    email: 'crew@example.com',
    phone: '9832261850',
    password: 'Str0ngPass!23',
    role: 'installation_team',
    status: 'active',
  });
  crewToken = tokenFor(crew);

  agent = await User.createUser({
    name: 'Evidence Agent',
    email: 'evidence.agent@example.com',
    phone: '9832261851',
    password: 'Str0ngPass!23',
    role: 'agent',
    status: 'active',
  });

  const customer = await Customer.create({
    customerId: 'CUS-950001',
    name: 'Evidence Customer',
    phone: '9832261852',
    address: 'Village Road',
    district: 'Hooghly',
    city: 'Gurap',
    state: 'West Bengal',
    pincode: '712303',
    systemSizeKW: 3,
    roofType: 'tin_shed',
    status: 'active',
    ownerAgent: agent._id,
    electricBill: { consumerId: '1122334455', installationNo: 'INS-515151' },
    verification: { status: 'verified', by: env.admin._id, at: new Date() },
  });

  const filed = await asAdmin(request(env.app).post(`${API_PREFIX}/applications`)).send({
    customer: String(customer._id),
    siteType: 'tin_shed',
    deal: { systemSizeKW: 3, proposalAmount: 150000 },
  });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));

  const created = await asAdmin(request(env.app).post(`${API_PREFIX}/installations`)).send({
    application: filed.body.data._id,
    installDate: '2026-11-10',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  installationId = created.body.data.installation._id;
});

after(async () => {
  await env.stop();
});

test('api: the crew can open the jobs list (permission floor, not admin-only)', async () => {
  const res = await asCrew(request(env.app).get(`${API_PREFIX}/installations`));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body.data));
});

test('api: “completed” is refused while the evidence is missing', async () => {
  const res = await asCrew(request(env.app).patch(`${API_PREFIX}/installations/${installationId}/complete`));

  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.match(res.body.error.message, /not documented yet/i);
});

test('api: panels, site photos and the inverter make a job complete', async () => {
  // Two panel rows, then each serial typed in and each panel photographed.
  const added = await asCrew(
    request(env.app).post(`${API_PREFIX}/installations/${installationId}/panels`)
  ).send({ count: 2 });

  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.data.panelUnits.length, 2);

  for (const [index, panel] of added.body.data.panelUnits.entries()) {
    const serial = `PL-${index + 1}-998877`;

    const saved = await asCrew(
      request(env.app).patch(`${API_PREFIX}/installations/${installationId}/panels/${panel._id}`)
    ).send({ serial });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const photo = await asCrew(
      request(env.app).post(`${API_PREFIX}/installations/${installationId}/evidence-photo`)
    )
      .field('slot', 'panel')
      .field('panelId', panel._id)
      .attach('file', PNG, 'panel.png');
    assert.equal(photo.status, 200, JSON.stringify(photo.body));
  }

  for (const slot of ['panels', 'meter']) {
    const res = await asCrew(
      request(env.app).post(`${API_PREFIX}/installations/${installationId}/evidence-photo`)
    )
      .field('slot', slot)
      .attach('file', PNG, `${slot}.png`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  const inverter = await asCrew(
    request(env.app).patch(`${API_PREFIX}/installations/${installationId}/inverter`)
  ).send({ brand: 'Growatt', serial: 'INV-556677', capacityKW: 3 });
  assert.equal(inverter.status, 200, JSON.stringify(inverter.body));

  const inverterPhoto = await asCrew(
    request(env.app).post(`${API_PREFIX}/installations/${installationId}/evidence-photo`)
  )
    .field('slot', 'inverter')
    .attach('file', PNG, 'inverter.png');
  assert.equal(inverterPhoto.status, 200, JSON.stringify(inverterPhoto.body));

  const gaps = await asCrew(
    request(env.app).get(`${API_PREFIX}/installations/${installationId}/evidence-gaps`)
  );
  assert.equal(gaps.status, 200);
  assert.deepEqual(gaps.body.data.gaps, []);

  const completed = await asCrew(
    request(env.app).patch(`${API_PREFIX}/installations/${installationId}/complete`)
  );
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.data.status, 'completed');

  const stored = await Installation.findById(installationId).lean();
  assert.equal(stored.panelUnits.length, 2);
  assert.equal(stored.inverter.brand, 'Growatt');
  assert.ok(stored.sitePhotos.meter.url);
});

test('api: the inverter rating is recorded with the unit that went in', async () => {
  const saved = await asCrew(
    request(env.app).patch(`${API_PREFIX}/installations/${installationId}/inverter`)
  ).send({ capacityKW: 5 });

  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const stored = await Installation.findById(installationId).lean();
  assert.equal(stored.inverterCapacity, 5, 'capacity was not stored on the installation');
  assert.equal(stored.inverter.brand, 'Growatt', 'saving capacity dropped the brand');

  const tooBig = await asCrew(
    request(env.app).patch(`${API_PREFIX}/installations/${installationId}/inverter`)
  ).send({ capacityKW: 240 });

  assert.equal(tooBig.status, 422, 'a nonsense rating was accepted');
});

test('api: a panel without a serial keeps the job open', async () => {
  const added = await asCrew(
    request(env.app).post(`${API_PREFIX}/installations/${installationId}/panels`)
  ).send({ serial: '' });

  assert.equal(added.status, 200);

  const gaps = await asCrew(
    request(env.app).get(`${API_PREFIX}/installations/${installationId}/evidence-gaps`)
  );
  assert.ok(gaps.body.data.gaps.some((gap) => /without a serial/i.test(gap)));
});

test('api: the office files the scheme paperwork, the agent cannot', async () => {
  const application = await Application.findOne({ customer: (await Customer.findOne({ customerId: 'CUS-950001' }))._id });

  const officeUpload = await asAdmin(
    request(env.app).post(`${API_PREFIX}/applications/${application._id}/documents`)
  )
    .field('kind', 'feasibilityReport')
    .attach('file', PNG, 'feasibility.png');

  assert.equal(officeUpload.status, 201, JSON.stringify(officeUpload.body));

  const reloaded = await Application.findById(application._id).lean();
  assert.ok(
    reloaded.documents.some((doc) => doc.kind === 'feasibilityReport'),
    'the office upload was not filed on the application'
  );

  const agentUpload = await request(env.app)
    .post(`${API_PREFIX}/applications/${application._id}/documents`)
    .set('Authorization', `Bearer ${tokenFor(agent)}`)
    .field('kind', 'dcrCertificate')
    .attach('file', PNG, 'dcr.png');

  assert.equal(agentUpload.status, 403, JSON.stringify(agentUpload.body));
});
