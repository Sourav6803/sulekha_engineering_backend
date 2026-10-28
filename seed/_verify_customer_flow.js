// seed/_verify_customer_flow.js
//
// End-to-end check of the new shape: an agent collects the customer, the office
// verifies them, and only then does the customer become an application.
//
// Everything it writes is deleted again at the end, so it is safe to run against
// the working database. Exits non-zero if an expectation fails.
//
//   node seed/_verify_customer_flow.js

import assert from 'node:assert/strict';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User, Customer, Application } from '../src/models/index.js';
import * as customerController from '../src/controllers/customer.controller.js';
import applicationService from '../src/services/application.service.js';

const makeRes = () => ({
  statusCode: 0,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const call = async (controller, body, query, user, params = {}) => {
  const res = makeRes();
  const req = { body, query, params, user, userId: user?._id };
  await controller(req, res);
  return res;
};

const stamp = Date.now();
const created = { customers: [], applications: [] };
const results = [];

const check = (name, fn) => {
  try {
    fn();
    results.push(`PASS  ${name}`);
  } catch (error) {
    results.push(`FAIL  ${name} — ${error.message}`);
    process.exitCode = 1;
  }
};

const run = async () => {
  await connectDB();

  const admin = await User.findOne({ role: 'admin', isActive: true }).lean();
  const agents = await User.find({ role: 'agent', isActive: true }).limit(2).lean();
  assert.ok(admin, 'no admin user in the database');
  assert.ok(agents.length >= 2, 'need two active agents to prove the scope');

  const [agentA, agentB] = agents;

  // ---- 1. an agent can now create a customer, and owns it ------------------
  const createRes = await call(
    customerController.createCustomer,
    {
      name: `VERIFY Customer ${stamp}`,
      phone: '9000000001',
      address: 'Verify Road, Test Para',
      village: 'Testpara',
      district: 'Purba Bardhaman',
      city: 'Burdwan',
      state: 'West Bengal',
      pincode: '713101',
      systemSizeKW: 3,
      roofType: 'rcc_rooftop',
      aadhaarNumber: '123456789012',
    },
    {},
    agentA
  );

  assert.equal(createRes.statusCode, 201, `create customer failed: ${JSON.stringify(createRes.body?.error)}`);
  const customer = createRes.body.data;
  created.customers.push(customer._id);

  check('agent can create a customer', () => assert.ok(customer._id));
  check('the creating agent owns it', () => assert.equal(String(customer.ownerAgent), String(agentA._id)));

  // A document on the customer, so the carry-over into the application is
  // actually exercised rather than silently skipped on an empty list.
  await Customer.findByIdAndUpdate(customer._id, {
    $push: {
      documents: {
        type: 'aadhar',
        url: 'https://example.test/aadhaar.jpg',
        fileName: 'aadhaar.jpg',
        fileSize: 1234,
        fileType: 'image/jpeg',
        uploadedAt: new Date(),
      },
    },
  });

  // ---- 2. scope: the other agent cannot see or open it ---------------------
  const listA = await call(customerController.listCustomers, {}, { limit: 50 }, agentA);
  const listB = await call(customerController.listCustomers, {}, { limit: 50 }, agentB);
  const idsA = (listA.body.data ?? []).map((row) => String(row._id));
  const idsB = (listB.body.data ?? []).map((row) => String(row._id));

  check("the owning agent's list contains it", () => assert.ok(idsA.includes(String(customer._id))));
  check("another agent's list does not", () => assert.ok(!idsB.includes(String(customer._id))));

  let blocked = null;
  try {
    await call(customerController.getCustomer, {}, {}, agentB, { id: customer._id });
  } catch (error) {
    blocked = error;
  }
  check('another agent gets 404 on the record itself', () => assert.equal(blocked?.statusCode, 404));

  const adminList = await call(customerController.listCustomers, {}, { limit: 50 }, admin);
  check(
    'the office sees it',
    () => assert.ok((adminList.body.data ?? []).some((row) => String(row._id) === String(customer._id)))
  );

  // ---- 3. an unverified customer cannot be filed --------------------------
  let refusal = null;
  try {
    await applicationService.createApplication({ customer: customer._id }, admin);
  } catch (error) {
    refusal = error;
  }
  check('unverified customer is refused', () => assert.equal(refusal?.statusCode, 400));
  check(
    'the refusal names verification',
    () => assert.match(refusal?.message ?? '', /verify/i)
  );

  // ---- 4. verify, then file ----------------------------------------------
  await Customer.findByIdAndUpdate(customer._id, { status: 'active' });

  const application = await applicationService.createApplication({ customer: customer._id }, admin);
  created.applications.push(application._id);

  check('a verified customer becomes an application', () => assert.ok(application._id));
  check('identity is copied from the customer', () => assert.equal(application.consumerName, customer.name));
  check('phone is copied from the customer', () => assert.equal(application.phone, customer.phone));
  check('aadhaar is copied from the customer', () => assert.equal(application.aadhaarNumber, '123456789012'));
  check(
    'the system size is carried into the deal block',
    () => assert.equal(Number(application.deal?.systemSizeKW), 3)
  );
  check(
    'customer documents are carried over with the application kind',
    () => assert.equal(application.documents?.[0]?.kind, 'aadhaar')
  );
  check('the customer is linked', () => assert.equal(String(application.customer), String(customer._id)));
  check(
    "the collecting agent keeps the application, not whoever pressed the button",
    () => assert.equal(String(application.agent), String(agentA._id))
  );

  // ---- 5. a second application for the same customer is refused -----------
  let duplicate = null;
  try {
    await applicationService.createApplication({ customer: customer._id }, admin);
  } catch (error) {
    duplicate = error;
  }
  check('a duplicate application is refused', () => assert.equal(duplicate?.statusCode, 409));
  check(
    'the duplicate points at the existing one',
    () => assert.equal(String(duplicate?.details?.applicationId), String(application._id))
  );

  // ---- 6. the schema itself insists on a customer -------------------------
  let missing = null;
  try {
    await applicationService.createApplication({}, admin);
  } catch (error) {
    missing = error;
  }
  check('a customer is required', () => assert.equal(missing?.statusCode, 400));

  // ---- cleanup ------------------------------------------------------------
  await Application.deleteMany({ _id: { $in: created.applications } });
  await Customer.deleteMany({ _id: { $in: created.customers } });

  console.log(results.join('\n'));
  console.log(`\ncleaned up ${created.applications.length} application(s), ${created.customers.length} customer(s)`);

  await disconnectDB();
};

run().catch(async (error) => {
  console.error('verification crashed:', error);
  process.exitCode = 1;
  try {
    await Application.deleteMany({ _id: { $in: created.applications } });
    await Customer.deleteMany({ _id: { $in: created.customers } });
    await disconnectDB();
  } catch {
    /* nothing left to clean */
  }
});
