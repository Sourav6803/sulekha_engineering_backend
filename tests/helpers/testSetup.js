// tests/helpers/testSetup.js
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import config from '../../src/config/env.js';
import User from '../../src/models/User.js';
import CompanyProfile from '../../src/models/CompanyProfile.js';
import { Quotation } from '../../src/models/index.js';
import app from '../../src/app.js';

export const API_PREFIX = config.API_PREFIX || '/api/v1';

/**
 * Boot an isolated in-memory MongoDB, connect mongoose to it and create the
 * users the API tests need.
 *
 * Indexes are created explicitly: the partial unique indexes on
 * (quotationNo) and (financialYear, quotationSeq) are what make the numbering
 * safe, so the tests must never run against a collection without them.
 */
export const startTestEnv = async () => {
  const server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { dbName: 'sulekha_test' });

  await Promise.all([Quotation.init(), CompanyProfile.init(), User.init()]);

  const admin = await User.createUser({
    name: 'Test Admin',
    email: 'admin@test.local',
    password: 'Test@12345',
    role: 'admin',
    status: 'active',
  });

  const viewer = await User.createUser({
    name: 'Test Viewer',
    email: 'viewer@test.local',
    password: 'Test@12345',
    role: 'viewer',
    status: 'active',
  });

  const tokenFor = (user) =>
    jwt.sign(
      { id: user._id, email: user.email, role: user.role, permissions: user.permissions || [] },
      config.JWT_SECRET,
      { expiresIn: '1h', algorithm: config.JWT_ALGORITHM }
    );

  return {
    server,
    app,
    admin,
    viewer,
    adminToken: tokenFor(admin),
    viewerToken: tokenFor(viewer),
    async stop() {
      await mongoose.disconnect();
      await server.stop();
    },
  };
};

/** Wipe collections between tests without recreating the server. */
export const resetQuotations = async () => {
  await Quotation.deleteMany({});
};
