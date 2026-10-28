// seed/_reset_and_test.js
//
// Wipes the customer and application tables (as instructed), then proves the new
// flow end to end on a fresh record:
//
//   customer created by an agent → document attached → verified → application
//   filed → identity, system size and the document carried across.
//
// A JSON export of both collections is written to backend/backups/ before
// anything is deleted; the run aborts if that file cannot be written.
//
//   node seed/_reset_and_test.js

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { connectDB, disconnectDB } from '../src/config/db.js';
import {
  User,
  Customer,
  Application,
  Installation,
  Quotation,
  Agreement,
} from '../src/models/index.js';
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
  await controller({ body, query, params, user, userId: user?._id }, res);
  return res;
};

const run = async () => {
  await connectDB();

  // ---------------------------------------------------------------- inventory
  const before = {
    customers: await Customer.countDocuments(),
    applications: await Application.countDocuments(),
    installations: await Installation.countDocuments(),
    quotations: await Quotation.countDocuments(),
    agreements: await Agreement.countDocuments(),
  };
  console.log('BEFORE', JSON.stringify(before));

  const linkedInstallations = await Installation.countDocuments({ customer: { $ne: null } });
  const linkedQuotations = await Quotation.countDocuments({ application: { $ne: null } });
  const linkedAgreements = await Agreement.countDocuments({ application: { $ne: null } });
  console.log(
    `linked rows that would be orphaned — installations: ${linkedInstallations}, quotations: ${linkedQuotations}, agreements: ${linkedAgreements}`
  );

  // ------------------------------------------------------------------ backup
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `customers-applications-${stamp}.json`);
  const dump = {
    takenAt: new Date().toISOString(),
    counts: before,
    customers: await Customer.find({}).lean(),
    applications: await Application.find({}).lean(),
  };
  fs.writeFileSync(file, JSON.stringify(dump, null, 2), 'utf8');
  const size = fs.statSync(file).size;
  assert.ok(size > 2, 'backup file is empty — refusing to delete anything');
  console.log(`BACKUP ${file} (${Math.round(size / 1024)} KB)`);

  // ------------------------------------------------------------------ wipe
  const appsDeleted = await Application.deleteMany({});
  const customersDeleted = await Customer.deleteMany({});
  console.log(`DELETED applications: ${appsDeleted.deletedCount}, customers: ${customersDeleted.deletedCount}`);

  // -------------------------------------------------------------- fresh data
  const admin = await User.findOne({ role: 'admin', isActive: true }).lean();
  const agent = await User.findOne({ role: 'agent', isActive: true }).lean();
  assert.ok(admin && agent, 'need an admin and an agent to run the flow');

  const created = await call(
    customerController.createCustomer,
    {
      name: 'Ramesh Mondal',
      phone: '9832117393',
      alternatePhone: '7083799437',
      address: 'Shurikola, Jamalpur',
      village: 'Shurikola',
      block: 'Jamalpur',
      district: 'Purba Bardhaman',
      city: 'Burdwan',
      state: 'West Bengal',
      pincode: '713408',
      systemSizeKW: 3,
      roofType: 'rcc_rooftop',
      roofArea: 320,
      aadhaarNumber: '432109876543',
      panNumber: 'ABCDE1234F',
    },
    {},
    agent
  );
  assert.equal(created.statusCode, 201, `customer create failed: ${JSON.stringify(created.body)}`);
  const customer = created.body.data;
  console.log(`CUSTOMER ${customer.customerId} ${customer.name} owner=${customer.ownerAgent}`);

  // The document an agent photographs on the visit — a roof photo, which is the
  // one the user asked to be uploaded while creating the customer.
  await Customer.findByIdAndUpdate(customer._id, {
    $push: {
      documents: {
        type: 'sitePhotoBefore',
        url: 'https://res.cloudinary.com/demo/image/upload/roof.jpg',
        fileName: 'roof-photo.jpg',
        fileSize: 284311,
        fileType: 'image/jpeg',
        uploadedAt: new Date(),
      },
    },
  });

  // Filing is refused while the papers are unchecked.
  let refused = null;
  try {
    await applicationService.createApplication({ customer: customer._id }, admin);
  } catch (error) {
    refused = error;
  }
  assert.equal(refused?.statusCode, 400, 'unverified customer should be refused');
  console.log('REFUSED while unverified:', refused.message);

  await Customer.findByIdAndUpdate(customer._id, { status: 'active' });

  const application = await applicationService.createApplication({ customer: customer._id }, admin);
  const reloaded = await Application.findById(application._id).lean();

  const checks = [
    ['customer linked', String(reloaded.customer) === String(customer._id)],
    ['name copied', reloaded.consumerName === 'Ramesh Mondal'],
    ['aadhaar copied', reloaded.aadhaarNumber === '432109876543'],
    ['district copied', reloaded.address?.district === 'Purba Bardhaman'],
    ['system size carried', Number(reloaded.deal?.systemSizeKW) === 3],
    ['document carried as rooftopPhoto', reloaded.documents?.[0]?.kind === 'rooftopPhoto'],
    ['document url carried', reloaded.documents?.[0]?.url?.endsWith('roof.jpg') === true],
    ['agent of record is the collector', String(reloaded.agent) === String(agent._id)],
  ];

  for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);

  const after = {
    customers: await Customer.countDocuments(),
    applications: await Application.countDocuments(),
  };
  console.log('AFTER', JSON.stringify(after));
  console.log(`APPLICATION ${reloaded.applicationNo} status=${reloaded.status}`);

  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;

  await disconnectDB();
};

run().catch(async (error) => {
  console.error('crashed:', error?.message ?? error);
  process.exitCode = 1;
  try {
    await disconnectDB();
  } catch {
    /* already down */
  }
});
