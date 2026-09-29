// scripts/fix-partner-overview.js
/**
 * Correct the System Overview on the two back-filled Bank of Baroda project
 * sheets to the wording their manual sheets actually carry.
 *
 * The overview is normally generated from the profile template, which printed
 * the project's total plant size against the on-grid figure and the inverter
 * rating against the off-grid figure ("7 KW on-grid ... & 5 KW off-grid").
 * The manual sheets read "5KW on-grid ... & 2KW Solar off-grid".
 *
 *   node scripts/fix-partner-overview.js            # shows what it would change
 *   node scripts/fix-partner-overview.js --commit
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import config from '../src/config/env.js';
import { Quotation } from '../src/models/index.js';

dns.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);

const COMMIT = process.argv.includes('--commit');

// Verbatim from "Quotation Formet.xlsx" — identical on both BOB sheets.
const SHEET_OVERVIEW =
  'We are pleased to submit the domestic proposal for Supply, Installation and Commissioning of ' +
  '5KW on-grid Rooftop Solar Power Plant with Net-metering Arrangement & 2KW Solar off-grid power plant ' +
  'Assumptions include south-facing tilt and typical cable runs  for solar roof top mounting structures.';

const NUMBERS = ['SE/BOB/2026-27/42', 'SE/BOB/2026-27/44'];

const run = async () => {
  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`connected${COMMIT ? '' : '  (DRY RUN)'}\n`);

  for (const quotationNo of NUMBERS) {
    // eslint-disable-next-line no-await-in-loop
    const quotation = await Quotation.findOne({ quotationNo, isActive: true });
    if (!quotation) {
      console.log(`${quotationNo} | NOT FOUND (live)`);
      continue;
    }

    const before = quotation.systemOverview || '';
    if (before === SHEET_OVERVIEW) {
      console.log(`${quotationNo} | already correct`);
      continue;
    }

    console.log(`${quotationNo}\n  before: ${before}\n  after : ${SHEET_OVERVIEW}`);

    if (COMMIT) {
      quotation.systemOverview = SHEET_OVERVIEW;
      // eslint-disable-next-line no-await-in-loop
      await quotation.save();
      console.log('  -> saved');
    }
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('FAILED:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
