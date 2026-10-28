// scripts/migrate-system-type-template.js
/**
 * Put `{{systemType}}` back into the stored System Overview template.
 *
 * The company profile saved in the database still carries the older wording
 * "... with {{inverterCapacityKW}} kw ongrid inverter", which is why the new
 * dropdown would change nothing on the printed sheet: the profile's own template
 * wins over the code-level default (see utils/quotationDefaults.js). This
 * rewrites the hard-coded "ongrid" that sits in front of "inverter" into the
 * token, so the quotation's system type actually reaches the sentence.
 *
 * Idempotent: a template that already uses {{systemType}} never matches.
 *
 *   node scripts/migrate-system-type-template.js            # shows what it would change
 *   node scripts/migrate-system-type-template.js --commit   # writes
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import config from '../src/config/env.js';
import { CompanyProfile, Quotation } from '../src/models/index.js';
import { SYSTEM_TYPE_LABELS, DEFAULT_SYSTEM_TYPE } from '../src/data/quotationTypes.js';

dns.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);

const COMMIT = process.argv.includes('--commit');

/** Only the word printed immediately before "inverter" is the system type. */
const WORD_BEFORE_INVERTER = /\b(?:on[\s-]?grid|off[\s-]?grid|hybrid)\b(?=\s*(?:string\s+)?inverter)/gi;

const toToken = (template) => String(template ?? '').replace(WORD_BEFORE_INVERTER, '{{systemType}}');

/** The label a given quotation should print for its own system type. */
const labelFor = (systemType) => SYSTEM_TYPE_LABELS[systemType] || SYSTEM_TYPE_LABELS[DEFAULT_SYSTEM_TYPE];

const run = async () => {
  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`connected${COMMIT ? '' : '  (DRY RUN)'}\n`);

  const profile = await CompanyProfile.findOne({ singletonKey: 'default' });
  if (!profile) {
    console.log('No default company profile found — nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  const before = profile.overviewTemplate || '';

  if (before.includes('{{systemType}}')) {
    console.log('overviewTemplate already uses {{systemType}} — nothing to do.');
  } else {
    const after = toToken(before);
    if (after === before) {
      console.log(`overviewTemplate has no on-grid wording — left as is:\n  ${before}`);
    } else {
      console.log(`overviewTemplate\n  before: ${before}\n  after : ${after}`);
      if (COMMIT) {
        profile.overviewTemplate = after;
        await profile.save();
        console.log('  -> saved');
      }
    }
  }

  /*
   * Issued quotations keep the sentence the consumer is holding — the overview is
   * a snapshot by design. Drafts are not issued yet, so the stale "on-grid" is
   * corrected there to whatever that quotation's own system type is.
   */
  const drafts = await Quotation.find({
    isActive: true,
    status: 'draft',
    systemOverview: /on[\s-]?grid\s+(?:string\s+)?inverter/i,
  });

  console.log(`\nDraft quotations carrying "on-grid inverter": ${drafts.length}`);
  for (const quotation of drafts) {
    const next = quotation.systemOverview
      .replace(WORD_BEFORE_INVERTER, labelFor(quotation.systemType));
    console.log(`  ${quotation.quotationNo} (${quotation.systemType})\n    after: ${next}`);
    if (COMMIT) {
      quotation.systemOverview = next;
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
