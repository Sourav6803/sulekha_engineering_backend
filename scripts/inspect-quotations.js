// scripts/inspect-quotations.js
/**
 * Read-only listing of every quotation in the database.
 *
 * Written for the "Quotation Formet.xlsx" back-fill: before creating 28 records
 * with fixed numbers we need to know what is already there, so that nothing is
 * duplicated and nothing collides on the (financialYear, quotationSeq) index.
 *
 * Usage:  node scripts/inspect-quotations.js
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import config from '../src/config/env.js';
import { Quotation } from '../src/models/index.js';

/*
 * A mongodb+srv:// URI needs an SRV lookup, and node's c-ares resolver on this
 * machine intermittently refuses it (ECONNREFUSED on _mongodb._tcp...) while the
 * system resolver answers fine. Pointing c-ares at public resolvers fixes it.
 */
dns.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);

const run = async () => {
  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log('connected\n');

  const all = await Quotation.find({})
    .sort({ financialYear: -1, quotationSeq: 1 })
    .select('quotationNo quotationSeq financialYear schemeCode quotationType customerName amount isActive isHistorical status issueDate createdAt importedFrom')
    .lean();

  console.log(`total documents: ${all.length}\n`);
  console.log('no | type     | seq | active | hist | amount   | date       | customer');
  console.log('-'.repeat(110));
  for (const q of all) {
    const active = q.isActive === false ? 'DELETED' : 'live';
    const hist = q.isHistorical ? 'hist' : '    ';
    const date = q.issueDate ? new Date(q.issueDate).toISOString().slice(0, 10) : '(none)';
    console.log(
      `${String(q.quotationNo).padEnd(24)} | ${String(q.quotationType || 'consumer').padEnd(8)} | ` +
        `${String(q.quotationSeq).padStart(3)} | ${active.padEnd(7)} | ${hist} | ` +
        `${String(q.amount ?? '-').padStart(8)} | ${date} | ${q.customerName}`
    );
  }

  const live = all.filter((q) => q.isActive !== false);
  console.log(`\nlive: ${live.length}   deleted: ${all.length - live.length}`);
  const maxSeq = live.reduce((m, q) => Math.max(m, q.quotationSeq || 0), 0);
  console.log(`max live sequence (FY-agnostic): ${maxSeq}`);

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('FAILED:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
