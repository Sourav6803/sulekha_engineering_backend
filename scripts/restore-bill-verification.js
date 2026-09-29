// scripts/restore-bill-verification.js
//
// One-off repair. A verification probe sent `PATCH /applications/:id/electric-bill/verify`
// with an empty body, and `verifyElectricBillSchema` defaults `verified` to true — so the
// request stamped the bill as verified by an administrator when nobody had reviewed it.
//
// This puts the block back exactly as it was before that request: `verified` false and the
// three audit fields absent, rather than merely toggling `verified` back (which would leave a
// misleading verifiedAt/verifiedBy behind).
//
// Usage: node scripts/restore-bill-verification.js <applicationId>

import dns from 'node:dns';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import Application from '../src/models/Application.js';

// `mongodb+srv://` needs a DNS SRV lookup, and this machine's default resolver
// refuses those queries (querySrv ECONNREFUSED) even though the app itself
// connects fine. Point Node at public resolvers that answer SRV.
dns.setServers(['8.8.8.8', '1.1.1.1']);

const AUDIT_FIELDS = ['electricBill.verifiedAt', 'electricBill.verifiedBy', 'electricBill.verificationNote'];

async function run() {
  const id = process.argv[2];
  if (!id) throw new Error('Pass an application id.');

  await connectDB();

  const before = await Application.findById(id).select('applicationNo electricBill').lean();
  if (!before) throw new Error(`No application with id ${id}.`);

  console.log(`before (${before.applicationNo}):`, JSON.stringify(before.electricBill));

  await Application.updateOne(
    { _id: id },
    {
      $set: { 'electricBill.verified': false },
      $unset: Object.fromEntries(AUDIT_FIELDS.map((field) => [field, ''])),
    }
  );

  const after = await Application.findById(id).select('electricBill').lean();
  console.log('after: ', JSON.stringify(after.electricBill));

  await mongoose.connection.close();
}

run().catch(async (error) => {
  console.error('FAILED:', error.message);
  await mongoose.connection.close();
  process.exit(1);
});
