// tests/agent.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import config from '../src/config/env.js';
import { startTestEnv, API_PREFIX } from './helpers/testSetup.js';
import { User } from '../src/models/index.js';
import {
  generateTemporaryPassword,
} from '../src/services/agent.service.js';
import { isEmailEnabled, sendMail } from '../src/services/email.service.js';

/**
 * Agent accounts are admin-only, and the password is issued by the office rather
 * than typed in by the admin. These tests pin both rules plus the welcome-email
 * hand-off, because the failure mode — an agent who cannot sign in, or an admin
 * who quietly gets more power than they should — is only discovered by a person
 * locked out of their own account.
 */

let env;
let managerToken;
let agentToken;
let createdAgentId;
let createdAgentEmail;
let temporaryPassword;

const newAgentBody = (overrides = {}) => ({
  name: 'Bikash Mondal',
  email: 'bikash.mondal@example.com',
  phone: '9830011223',
  employeeId: 'SE-AG-001',
  department: 'sales',
  ...overrides,
});

const tokenFor = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role, permissions: user.permissions || [] },
    config.JWT_SECRET,
    { expiresIn: '1h', algorithm: config.JWT_ALGORITHM }
  );

before(async () => {
  /**
   * Keep the suite offline and deterministic.
   *
   * The developer's .env carries real Gmail credentials and EMAIL_ENABLED=true,
   * so without this the tests would genuinely send mail to example.com and the
   * "password comes back when the mail fails" assertions would flip the moment
   * someone switches email on. `isEmailEnabled()` reads this at call time, so
   * mutating the config here is enough. The live send path is verified by hand
   * against Gmail instead.
   */
  config.EMAIL_ENABLED = false;

  env = await startTestEnv();

  const manager = await User.createUser({
    name: 'Office Manager',
    email: 'manager@example.com',
    password: 'Manager@123',
    role: 'manager',
    status: 'active',
  });
  managerToken = tokenFor(manager);
});

after(async () => {
  await env.stop();
});

// ============================================================
// The generated password
// ============================================================

test('generated password satisfies the same policy the change-password form enforces', () => {
  for (let i = 0; i < 40; i += 1) {
    const password = generateTemporaryPassword();

    assert.ok(password.length >= 8, `too short: ${password}`);
    assert.match(password, /[A-Z]/, `no uppercase: ${password}`);
    assert.match(password, /[a-z]/, `no lowercase: ${password}`);
    assert.match(password, /[0-9]/, `no digit: ${password}`);
  }
});

test('generated passwords are not repeated', () => {
  const seen = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
  assert.equal(seen.size, 200, 'passwords must not collide');
});

test('generated password avoids glyphs that get misread off a phone screen', () => {
  const joined = Array.from({ length: 60 }, () => generateTemporaryPassword()).join('');
  ['0', 'O', '1', 'l', 'I'].forEach((glyph) => {
    assert.ok(!joined.includes(glyph), `ambiguous glyph "${glyph}" should not be used`);
  });
});

// ============================================================
// Who may create an agent
// ============================================================

test('api: an admin can create an agent', async () => {
  const res = await request(env.app)
    .post(`${API_PREFIX}/agents`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send(newAgentBody());

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.agent.role, 'agent');
  assert.equal(res.body.data.agent.email, 'bikash.mondal@example.com');
  assert.equal(res.body.data.agent.mustChangePassword, true, 'must be forced to set their own password');
  assert.equal(res.body.data.agent.status, 'active');

  createdAgentId = res.body.data.agent.id;
  createdAgentEmail = res.body.data.agent.email;
});

test('api: the admin does not pick the password, and gets it back when mail fails', async () => {
  // EMAIL_ENABLED is false in this environment, so the welcome email is skipped
  // and the generated password has to come back for the admin to share by hand.
  const res = await request(env.app)
    .post(`${API_PREFIX}/agents`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send(newAgentBody({ email: 'second.agent@example.com', employeeId: 'SE-AG-002' }));

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.email.sent, false);
  assert.ok(res.body.data.email.reason, 'the reason must be reported so the admin knows to send it manually');
  assert.ok(res.body.data.temporaryPassword, 'admin must receive the password when mail fails');
  assert.match(res.body.data.temporaryPassword, /[A-Z]/);
  assert.match(res.body.data.temporaryPassword, /[0-9]/);
});

test('api: a manager may not create an agent', async () => {
  const res = await request(env.app)
    .post(`${API_PREFIX}/agents`)
    .set('Authorization', `Bearer ${managerToken}`)
    .send(newAgentBody({ email: 'nope@example.com' }));

  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('api: one agent may not create another agent', async () => {
  const agentUser = await User.findById(createdAgentId);
  agentToken = tokenFor(agentUser);

  const res = await request(env.app)
    .post(`${API_PREFIX}/agents`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send(newAgentBody({ email: 'peer@example.com' }));

  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('api: an anonymous caller may not create an agent', async () => {
  const res = await request(env.app).post(`${API_PREFIX}/agents`).send(newAgentBody());

  assert.equal(res.status, 401, JSON.stringify(res.body));
});

test('api: a duplicate email is refused', async () => {
  const res = await request(env.app)
    .post(`${API_PREFIX}/agents`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send(newAgentBody({ email: createdAgentEmail }));

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'EMAIL_ALREADY_REGISTERED');
});

// ============================================================
// Sign-in with the issued password, and changing it
// ============================================================

test('api: the agent signs in with the emailed password and is told to change it', async () => {
  // The first agent's password was not returned to the caller, so issue a fresh
  // one through the admin reset path and use that.
  const reset = await request(env.app)
    .post(`${API_PREFIX}/agents/${createdAgentId}/reset-password`)
    .set('Authorization', `Bearer ${env.adminToken}`);

  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  temporaryPassword = reset.body.data.temporaryPassword;
  assert.ok(temporaryPassword, 'admin must receive the new password when mail fails');

  const login = await request(env.app)
    .post(`${API_PREFIX}/auth/login`)
    .send({ email: createdAgentEmail, password: temporaryPassword });

  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.data.user.role, 'agent');
  assert.equal(login.body.data.user.mustChangePassword, true);
  assert.ok(login.body.data.accessToken);
});

test('api: the agent changes their own password, which clears the prompt', async () => {
  const login = await request(env.app)
    .post(`${API_PREFIX}/auth/login`)
    .send({ email: createdAgentEmail, password: temporaryPassword });
  const token = login.body.data.accessToken;

  const change = await request(env.app)
    .post(`${API_PREFIX}/auth/change-password`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      currentPassword: temporaryPassword,
      newPassword: 'MyOwnSecret9',
      confirmPassword: 'MyOwnSecret9',
    });

  assert.equal(change.status, 200, JSON.stringify(change.body));

  // The new password works, and the old one does not.
  const relogin = await request(env.app)
    .post(`${API_PREFIX}/auth/login`)
    .send({ email: createdAgentEmail, password: 'MyOwnSecret9' });

  assert.equal(relogin.status, 200, JSON.stringify(relogin.body));
  assert.equal(
    relogin.body.data.user.mustChangePassword,
    false,
    'the prompt must clear once the agent has set their own password'
  );

  const stale = await request(env.app)
    .post(`${API_PREFIX}/auth/login`)
    .send({ email: createdAgentEmail, password: temporaryPassword });

  assert.equal(stale.status, 401, 'the temporary password must stop working');
});

// ============================================================
// The admin's view
// ============================================================

test('api: the admin sees agents but the agent does not see peers', async () => {
  const asAdmin = await request(env.app)
    .get(`${API_PREFIX}/agents`)
    .set('Authorization', `Bearer ${env.adminToken}`);

  assert.equal(asAdmin.status, 200, JSON.stringify(asAdmin.body));
  assert.ok(asAdmin.body.data.length >= 2, 'both agents should be listed');
  assert.ok(
    asAdmin.body.data.every((item) => item.role === 'agent'),
    'only agents belong on this list'
  );
  assert.ok(
    asAdmin.body.data[0].stats && typeof asAdmin.body.data[0].stats.applications === 'number',
    'each agent carries their own numbers'
  );

  const asAgent = await request(env.app)
    .get(`${API_PREFIX}/agents`)
    .set('Authorization', `Bearer ${agentToken}`);

  assert.equal(asAgent.status, 403, JSON.stringify(asAgent.body));
});

test('api: the admin can suspend and reactivate an agent', async () => {
  const suspend = await request(env.app)
    .put(`${API_PREFIX}/agents/${createdAgentId}`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({ status: 'suspended' });

  assert.equal(suspend.status, 200, JSON.stringify(suspend.body));
  assert.equal(suspend.body.data.status, 'suspended');

  const blocked = await request(env.app)
    .post(`${API_PREFIX}/auth/login`)
    .send({ email: createdAgentEmail, password: 'MyOwnSecret9' });

  assert.equal(blocked.status, 403, 'a suspended agent must not be able to sign in');

  const reactivate = await request(env.app)
    .post(`${API_PREFIX}/agents/${createdAgentId}/activate`)
    .set('Authorization', `Bearer ${env.adminToken}`);

  assert.equal(reactivate.status, 200, JSON.stringify(reactivate.body));
  assert.equal(reactivate.body.data.status, 'active');
});

test('api: the admin is warned when welcome emails will not go out', async () => {
  const res = await request(env.app)
    .get(`${API_PREFIX}/agents/email-status`)
    .set('Authorization', `Bearer ${env.adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(typeof res.body.data.enabled, 'boolean');
  assert.equal(res.body.data.enabled, isEmailEnabled());
});

test('api: a manager cannot read the agent list either', async () => {
  const res = await request(env.app)
    .get(`${API_PREFIX}/agents`)
    .set('Authorization', `Bearer ${managerToken}`);

  assert.equal(res.status, 403, JSON.stringify(res.body));
});

// ============================================================
// The email service itself
// ============================================================

test('email: a send is reported as skipped, never thrown, when mail is off', async () => {
  const result = await sendMail({ to: 'someone@example.com', subject: 'x', text: 'y' });

  assert.equal(result.sent, false);
  assert.ok(result.reason, 'a reason must come back so the API can explain itself');
});

test('email: no recipient is a clean failure, not a crash', async () => {
  const result = await sendMail({ subject: 'x', text: 'y' });

  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no-recipient');
});

// ============================================================
// The previously public register route
// ============================================================

test('api: /auth/register is no longer open to the world', async () => {
  const anonymous = await request(env.app)
    .post(`${API_PREFIX}/auth/register`)
    .send({ name: 'Intruder', email: 'intruder@example.com', password: 'Intruder123' });

  assert.equal(anonymous.status, 401, 'anyone could previously mint an account here');

  const asAgent = await request(env.app)
    .post(`${API_PREFIX}/auth/register`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send({ name: 'Peer', email: 'peer2@example.com', password: 'Peer@12345' });

  assert.equal(asAgent.status, 403);
});

test('api: an admin-created account through /auth/register is also asked to change its password', async () => {
  const res = await request(env.app)
    .post(`${API_PREFIX}/auth/register`)
    .set('Authorization', `Bearer ${env.adminToken}`)
    .send({
      name: 'Warehouse Person',
      email: 'warehouse@example.com',
      password: 'Warehouse123',
      role: 'warehouse_staff',
    });

  assert.equal(res.status, 201, JSON.stringify(res.body));

  const login = await request(env.app)
    .post(`${API_PREFIX}/auth/login`)
    .send({ email: 'warehouse@example.com', password: 'Warehouse123' });

  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.data.user.mustChangePassword, true);
});
