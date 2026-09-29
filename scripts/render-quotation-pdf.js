// scripts/render-quotation-pdf.js
/**
 * Render the PDF of one stored quotation, without going through the API.
 *
 * Used to eyeball a back-filled record to make sure the printed sheet matches
 * the manual one it came from.
 *
 *   node scripts/render-quotation-pdf.js SE/BOB/2026-27/42
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns';
import mongoose from 'mongoose';
import config from '../src/config/env.js';
import { Quotation } from '../src/models/index.js';
import { renderQuotationPdf } from '../src/services/quotationPdf.service.js';

dns.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);

const quotationNo = process.argv[2];
if (!quotationNo) {
  console.error('usage: node scripts/render-quotation-pdf.js <quotationNo>');
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const quotation = await Quotation.findOne({ quotationNo, isActive: true }).lean({ virtuals: true });
  if (!quotation) throw new Error(`No live quotation with number ${quotationNo}`);

  console.log(
    `${quotation.quotationNo} | ${quotation.quotationType} | ${quotation.items.length} lines | ` +
      `Rs ${quotation.amount} | GST inclusive: ${quotation.amountIncludesGST}`
  );
  console.log(`  terms: ${quotation.terms.length}   payment terms: ${quotation.paymentTerms.length}`);
  if (quotation.quotationType === 'partner') {
    const sections = [...new Set(quotation.items.map((i) => i.section).filter(Boolean))];
    console.log(`  sections: ${sections.join('  ||  ')}`);
  }

  const { buffer, fontSize, pages } = await renderQuotationPdf(quotation);

  const outDir = path.join(process.cwd(), '..', 'browser-check');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${quotationNo.replace(/\//g, '-')}.pdf`);
  await fs.writeFile(outFile, buffer);

  console.log(`  rendered: ${pages} page(s), font ${fontSize}pt -> ${outFile}`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('FAILED:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
