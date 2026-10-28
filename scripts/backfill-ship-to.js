// scripts/backfill-ship-to.js
/**
 * Fill the delivery block on quotations saved before it was copied from Bill To.
 *
 * Every sheet prints a Ship To column beside Bill To, and until now the office
 * left it blank because the form asked for a separate address. Blank columns on
 * the existing paper are what prompted the "same as Bill To" checkbox, so the
 * same copy is applied here. Only an empty block is touched - a quotation with a
 * genuinely different site address keeps it.
 *
 *   node scripts/backfill-ship-to.js            # shows what it would change
 *   node scripts/backfill-ship-to.js --commit   # writes
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import config from '../src/config/env.js';
import { Quotation } from '../src/models/index.js';
import { buildShipToFromBillTo } from '../src/utils/quotationDefaults.js';

dns.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);

const COMMIT = process.argv.includes('--commit');

/** A block is blank when none of its three parts carries anything. */
const isBlank = (shipTo) =>
  !String(shipTo?.name ?? '').trim() &&
  !(shipTo?.addressLines ?? []).some((line) => String(line ?? '').trim()) &&
  !String(shipTo?.phone ?? '').trim();

const run = async () => {
  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`connected${COMMIT ? '' : '  (DRY RUN)'}\n`);

  const quotations = await Quotation.find({ isActive: true }).select(
    'quotationNo status systemSizeKW shipTo customerName addressLine1 addressLine2 district pincode phoneNo'
  );

  const blanks = quotations.filter((quotation) => isBlank(quotation.shipTo));
  console.log(`${quotations.length} live quotations, ${blanks.length} with a blank delivery block\n`);

  for (const quotation of blanks) {
    const shipTo = buildShipToFromBillTo(quotation);
    console.log(
      `${quotation.quotationNo} (${quotation.status})\n` +
        `  name   : ${shipTo.name || '-'}\n` +
        `  lines  : ${shipTo.addressLines.join(' | ') || '-'}\n` +
        `  phone  : ${shipTo.phone || '-'}`
    );

    if (COMMIT) {
      quotation.shipTo = shipTo;
      // eslint-disable-next-line no-await-in-loop
      await quotation.save();
    }
  }

  if (!COMMIT) console.log('\nRe-run with --commit to write these changes.');

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
