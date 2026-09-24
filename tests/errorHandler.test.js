// tests/errorHandler.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import config from '../src/config/env.js';

const API_PREFIX = config.API_PREFIX || '/api/v1';

// These tests never touch the database: an unmatched route is rejected by the
// 404 handler and a mounted-but-protected route by the auth middleware, so no
// MongoMemoryServer is needed here.

// ===========================================================================
// 404 handling
//
// The error handler used to read only `err.statusCode`, but app.js raises its
// 404 with `err.status`. That mismatch reported every unmatched route as
// 500 INTERNAL_ERROR - which is exactly how a deploy missing a route ended up
// looking like a server crash instead of a plain 404.
// ===========================================================================

test('404: an unknown top-level route answers 404, not 500', async () => {
  const res = await request(app).get(`${API_PREFIX}/this-route-does-not-exist`);

  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('404: an unknown sub-route of a protected module is stopped by auth first', async () => {
  // `router.use(authenticate)` runs before route matching inside those modules,
  // so an unknown path there is rejected with 401 rather than 404. Asserted so
  // the ordering is deliberate and visible rather than accidental.
  const res = await request(app).get(`${API_PREFIX}/materials/this-does-not-exist`);

  assert.equal(res.status, 401, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('404: a route outside the API prefix still answers 404', async () => {
  const res = await request(app).get('/definitely/not/here');

  assert.equal(res.status, 404, JSON.stringify(res.body));
});

// ===========================================================================
// Route mounting
//
// A route that is mounted but requires auth answers 401. A route that was never
// registered answers 404. Asserting 401 therefore proves the module is actually
// wired into routes/index.js - the regression that made the deployed backend
// report every quotation call as a 500.
// ===========================================================================

for (const modulePath of ['quotations', 'agreements', 'materials', 'installations']) {
  test(`routes: ${modulePath} is mounted (401, not 404)`, async () => {
    const res = await request(app).get(`${API_PREFIX}/${modulePath}`);

    assert.notEqual(
      res.status,
      404,
      `${modulePath} is not mounted on the router - check src/routes/index.js`
    );
    assert.equal(res.status, 401, JSON.stringify(res.body));
  });
}
