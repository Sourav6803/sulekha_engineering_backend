// seed/_seed_demo_customers.js
//
// Two more customers, collected the way a field agent actually collects them:
// KYC plus the papers photographed at the house. Both are created by an agent,
// so both land in `pending_verification` — the office checks the papers and only
// then can they become applications.
//
//   node seed/_seed_demo_customers.js

import { connectDB, disconnectDB } from '../src/config/db.js';
import { User, Customer } from '../src/models/index.js';
import * as customerController from '../src/controllers/customer.controller.js';

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

const PEOPLE = [
  {
    name: 'Anjali Ghosh',
    phone: '9830011223',
    alternatePhone: '9830011224',
    email: 'anjali.ghosh@example.com',
    address: 'Bahir Sarbamangala, Lane 4',
    village: 'Bahir Sarbamangala',
    block: 'Burdwan Sadar',
    district: 'Purba Bardhaman',
    city: 'Burdwan',
    state: 'West Bengal',
    pincode: '713101',
    systemSizeKW: 3,
    roofType: 'rcc_rooftop',
    roofArea: 280,
    aadhaarNumber: '222233334444',
    panNumber: 'AAAAA1111A',
    documents: [
      { type: 'sitePhotoBefore', fileName: 'roof-anjali.jpg' },
      { type: 'aadhar', fileName: 'aadhaar-anjali.jpg' },
    ],
  },
  {
    name: 'Sk. Rafiqul Islam',
    phone: '9830022334',
    alternatePhone: '',
    email: 'rafiqul.islam@example.com',
    address: 'Kamalpur Bazaar Road',
    village: 'Kamalpur',
    block: 'Kalna',
    district: 'Purba Bardhaman',
    city: 'Kalna',
    state: 'West Bengal',
    pincode: '713409',
    systemSizeKW: 5,
    roofType: 'tin_shed',
    roofArea: 430,
    aadhaarNumber: '333344445555',
    panNumber: 'BBBBB2222B',
    documents: [{ type: 'electricBill', fileName: 'bill-rafiqul.jpg' }],
  },
];

const run = async () => {
  await connectDB();

  const agent = await User.findOne({ role: 'agent', isActive: true }).lean();
  if (!agent) throw new Error('no active agent to attribute these customers to');

  for (const person of PEOPLE) {
    const { documents, ...payload } = person;

    const existing = await Customer.findOne({ phone: payload.phone }).lean();
    if (existing) {
      console.log(`SKIP  ${payload.name} — phone ${payload.phone} already on file as ${existing.customerId}`);
      continue;
    }

    const res = await call(customerController.createCustomer, payload, {}, agent);
    if (res.statusCode !== 201) {
      console.log(`FAIL  ${payload.name} — ${JSON.stringify(res.body?.error ?? res.body)}`);
      continue;
    }

    const customer = res.body.data;

    await Customer.findByIdAndUpdate(customer._id, {
      $push: {
        documents: {
          $each: documents.map((doc) => ({
            type: doc.type,
            url: `https://res.cloudinary.com/demo/image/upload/${doc.fileName}`,
            fileName: doc.fileName,
            fileSize: 245_000,
            fileType: 'image/jpeg',
            uploadedAt: new Date(),
          })),
        },
      },
    });

    console.log(
      `ADDED ${customer.customerId}  ${customer.name}  ${customer.systemSizeKW} kW  ${customer.district}  status=${customer.status}  docs=${documents.length}`
    );
  }

  console.log(`customers now: ${await Customer.countDocuments()}`);
  await disconnectDB();
};

run().catch(async (error) => {
  console.error(error);
  await disconnectDB();
  process.exitCode = 1;
});
