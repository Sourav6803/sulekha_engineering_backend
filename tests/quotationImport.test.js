// tests/quotationImport.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cellText,
  parseSheetDate,
  parseCsv,
  buildRegisterPlan,
} from '../src/services/quotationImport.service.js';
import { LEGACY_REGISTER_ROWS } from '../src/data/legacyQuotationRegister.js';

/** Compare on local calendar parts - toISOString() would shift by the timezone. */
const ymdOf = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

test('parseSheetDate: reads every shape the legacy sheet can produce', () => {
  assert.equal(ymdOf(parseSheetDate('17.06.2026')), '2026-06-17');
  assert.equal(ymdOf(parseSheetDate('01.07.2026')), '2026-07-01');
  assert.equal(ymdOf(parseSheetDate('17/06/2026')), '2026-06-17');
  assert.equal(ymdOf(parseSheetDate('17-06-2026')), '2026-06-17');
  assert.equal(ymdOf(parseSheetDate('2026-06-17')), '2026-06-17');
  assert.equal(ymdOf(parseSheetDate(new Date(2026, 5, 17))), '2026-06-17');
  // the parsed date is local midnight, so the FY rule sees the intended day
  assert.equal(parseSheetDate('17.06.2026').getHours(), 0);
});

test('parseSheetDate: a blank cell is a valid "no date" (12 legacy rows have none)', () => {
  assert.equal(parseSheetDate(''), null);
  assert.equal(parseSheetDate(null), null);
  assert.equal(parseSheetDate(undefined), null);
  assert.equal(parseSheetDate('   '), null);
});

test('parseSheetDate: unreadable text and impossible dates return null', () => {
  assert.equal(parseSheetDate('next week'), null);
  // would otherwise silently roll over into February 2027
  assert.equal(parseSheetDate('32.13.2026'), null);
  assert.equal(parseSheetDate('31.02.2026'), null);
  assert.equal(parseSheetDate('00.06.2026'), null);
  assert.equal(parseSheetDate('17.00.2026'), null);
  assert.equal(parseSheetDate('17.06.1800'), null);
  // a real leap day is still accepted
  assert.equal(ymdOf(parseSheetDate('29.02.2028')), '2028-02-29');
  assert.equal(parseSheetDate('29.02.2027'), null);
});

test('parseSheetDate: Excel serial numbers are understood', () => {
  const fromSerial = parseSheetDate(46185);
  assert.ok(fromSerial instanceof Date);
  assert.equal(fromSerial.getFullYear(), 2026);
  // out of range serials are refused
  assert.equal(parseSheetDate(-5), null);
  assert.equal(parseSheetDate(999999), null);
});

test('cellText: unwraps the shapes exceljs returns', () => {
  assert.equal(cellText('SE/PMSGY/2026-27/38'), 'SE/PMSGY/2026-27/38');
  assert.equal(cellText(3), '3');
  assert.equal(cellText(null), '');
  assert.equal(cellText({ text: 'Souvik Ghosh' }), 'Souvik Ghosh');
  assert.equal(cellText({ richText: [{ text: 'Souvik ' }, { text: 'Ghosh' }] }), 'Souvik Ghosh');
  assert.equal(cellText({ formula: 'A1', result: 'SE/GP/2026-27/10' }), 'SE/GP/2026-27/10');
});

test('parseCsv: handles quotes, commas inside fields and CRLF', () => {
  const rows = parseCsv('SL NO,QUOTATION NO,DETAILS ,DATE\r\n3,SE/GP/2026-27/10,"HARAL GP, Block II",17.06.2026\r\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['SL NO', 'QUOTATION NO', 'DETAILS ', 'DATE']);
  assert.equal(rows[1][2], 'HARAL GP, Block II');
  assert.equal(rows[1][3], '17.06.2026');
});

test('parseCsv: escaped double quotes and blank line handling', () => {
  const rows = parseCsv('a,b\n"say ""hi""",2\n\n');
  assert.deepEqual(rows[1], ['say "hi"', '2']);
  assert.equal(rows.length, 2);
});

test('buildRegisterPlan: the real 24 sheet rows all validate', () => {
  const plan = buildRegisterPlan(LEGACY_REGISTER_ROWS);

  assert.equal(plan.valid.length, 24);
  assert.equal(plan.invalid.length, 0);
  assert.equal(plan.duplicates.length, 0);

  // leading spaces in the sheet are cleaned up
  assert.equal(plan.valid[2].quotationNo, 'SE/PMSGY/2026-27/17');
  assert.equal(plan.valid[4].quotationNo, 'SE/PMSGY/2026-27/19');

  // the register stops at 38, so the next number is 39
  const maxSeq = Math.max(...plan.valid.map((row) => row.quotationSeq));
  assert.equal(maxSeq, 38);

  // schemes present in the sheet
  assert.deepEqual(
    [...new Set(plan.valid.map((row) => row.schemeCode))].sort(),
    ['GP', 'MBECL', 'PMSGY', 'SOLAR']
  );

  // exactly half the rows carry a date
  const withDates = plan.valid.filter((row) => row.issueDate instanceof Date).length;
  assert.equal(withDates, 12);
  assert.equal(plan.valid.length - withDates, 12);
});

test('buildRegisterPlan: blank filler rows are ignored silently', () => {
  const plan = buildRegisterPlan([
    { slNo: 1 },
    { slNo: 2 },
    { slNo: 3, quotationNo: 'SE/GP/2026-27/10', details: 'HARAL GP', date: '17.06.2026' },
    { slNo: 27 },
  ]);

  assert.equal(plan.valid.length, 1);
  assert.equal(plan.invalid.length, 0);
});

test('buildRegisterPlan: rejects numbers it cannot read', () => {
  const plan = buildRegisterPlan([
    { slNo: 3, quotationNo: 'SE/PMSGY/26-27/9', details: 'Someone' },
    { slNo: 4, quotationNo: 'SE/PMSGY/2026-27/0', details: 'Someone else' },
    { slNo: 5, details: 'No number at all' },
  ]);

  assert.equal(plan.valid.length, 0);
  assert.equal(plan.invalid.length, 3);
  assert.match(plan.invalid[0].reason, /Unrecognised quotation number/);
});

test('buildRegisterPlan: a row without a customer name is rejected', () => {
  const plan = buildRegisterPlan([{ slNo: 3, quotationNo: 'SE/PMSGY/2026-27/9', details: '  ' }]);
  assert.equal(plan.valid.length, 0);
  assert.match(plan.invalid[0].reason, /Missing customer name/);
});

test('buildRegisterPlan: duplicate numbers and duplicate sequence slots are caught', () => {
  const plan = buildRegisterPlan([
    { slNo: 3, quotationNo: 'SE/PMSGY/2026-27/38', details: 'Souvik Ghosh' },
    { slNo: 4, quotationNo: 'SE/PMSGY/2026-27/38', details: 'Someone Else' },
    // same FY + sequence, different scheme prefix
    { slNo: 5, quotationNo: 'SE/GP/2026-27/38', details: 'Third Person' },
  ]);

  assert.equal(plan.valid.length, 1);
  assert.equal(plan.duplicates.length, 2);
  assert.match(plan.duplicates[0].reason, /Duplicate number/);
  assert.match(plan.duplicates[1].reason, /already used by/);
});

test('buildRegisterPlan: an unreadable date becomes a warning, not a failure', () => {
  const plan = buildRegisterPlan([
    { slNo: 3, quotationNo: 'SE/PMSGY/2026-27/38', details: 'Souvik Ghosh', date: 'sometime in July' },
  ]);

  assert.equal(plan.valid.length, 1);
  assert.equal(plan.valid[0].issueDate, null);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0].message, /could not be read/);
});

test('buildRegisterPlan: financial year comes from the number, not from today', () => {
  const plan = buildRegisterPlan([{ slNo: 3, quotationNo: 'SE/PMSGY/2025-26/4', details: 'Old Customer' }]);
  assert.equal(plan.valid[0].financialYear, '2025-26');
  assert.equal(plan.valid[0].quotationSeq, 4);
});

test('buildRegisterPlan: an empty sheet produces an empty plan', () => {
  const plan = buildRegisterPlan([]);
  assert.deepEqual(plan, { valid: [], invalid: [], duplicates: [], warnings: [] });
});
