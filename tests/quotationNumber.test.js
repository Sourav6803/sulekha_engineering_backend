// tests/quotationNumber.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  financialYearOf,
  financialYearRange,
  parseFinancialYear,
  buildQuotationNo,
  parseQuotationNo,
  findQuotationNumberInText,
  normaliseName,
  nameSimilarity,
  calculatePanelQty,
  formatQuotationAmount,
  isValidSchemeCode,
} from '../src/utils/quotationNumber.js';

test('financialYearOf: 1 April starts a new financial year', () => {
  assert.equal(financialYearOf(new Date(2026, 3, 1)), '2026-27'); // 1 Apr 2026
  assert.equal(financialYearOf(new Date(2026, 2, 31)), '2025-26'); // 31 Mar 2026
  assert.equal(financialYearOf(new Date(2027, 1, 10)), '2026-27'); // 10 Feb 2027
  assert.equal(financialYearOf(new Date(2027, 3, 1)), '2027-28'); // 1 Apr 2027
  assert.equal(financialYearOf(new Date(2026, 5, 17)), '2026-27'); // 17 Jun 2026
});

test('financialYearOf: invalid input returns null instead of guessing', () => {
  assert.equal(financialYearOf('not-a-date'), null);
  assert.equal(financialYearOf(''), null);
  assert.equal(financialYearOf(null), null);
});

test('financialYearRange: covers 1 April to 31 March', () => {
  const range = financialYearRange('2026-27');
  assert.equal(range.start.getFullYear(), 2026);
  assert.equal(range.start.getMonth(), 3);
  assert.equal(range.start.getDate(), 1);
  assert.equal(range.end.getFullYear(), 2027);
  assert.equal(range.end.getMonth(), 2);
  assert.equal(range.end.getDate(), 31);
  assert.equal(financialYearRange('nonsense'), null);
});

test('parseFinancialYear: normalises 4-digit end years and rejects junk', () => {
  assert.equal(parseFinancialYear('2026-27').financialYear, '2026-27');
  assert.equal(parseFinancialYear('2026-2027').financialYear, '2026-27');
  assert.equal(parseFinancialYear(' 2026 - 27 ').financialYear, '2026-27');
  assert.equal(parseFinancialYear('26-27'), null);
  assert.equal(parseFinancialYear('2026/27'), null);
  assert.equal(parseFinancialYear(null), null);
});

test('buildQuotationNo: formats the agreed shape', () => {
  assert.equal(
    buildQuotationNo({ prefix: 'SE', schemeCode: 'PMSGY', financialYear: '2026-27', seq: 39 }),
    'SE/PMSGY/2026-27/39'
  );
  // no zero padding, matching the manual register
  assert.equal(
    buildQuotationNo({ prefix: 'SE', schemeCode: 'GP', financialYear: '2026-27', seq: 9 }),
    'SE/GP/2026-27/9'
  );
  // lower case input is normalised
  assert.equal(
    buildQuotationNo({ prefix: 'se', schemeCode: 'pmsgy', financialYear: '2026-27', seq: 1 }),
    'SE/PMSGY/2026-27/1'
  );
});

test('buildQuotationNo: refuses invalid parts', () => {
  assert.throws(() => buildQuotationNo({ schemeCode: 'PMSGY', financialYear: '2026-27', seq: 0 }));
  assert.throws(() => buildQuotationNo({ schemeCode: 'PMSGY', financialYear: '2026-27', seq: -1 }));
  assert.throws(() => buildQuotationNo({ schemeCode: 'P', financialYear: '2026-27', seq: 1 }));
  assert.throws(() => buildQuotationNo({ schemeCode: 'PMSGY', financialYear: '26-27', seq: 1 }));
});

test('parseQuotationNo: tolerates the legacy sheet formatting', () => {
  const spaced = parseQuotationNo(' SE/PMSGY/2026-27/17');
  assert.equal(spaced.seq, 17);
  assert.equal(spaced.schemeCode, 'PMSGY');
  assert.equal(spaced.financialYear, '2026-27');
  assert.equal(spaced.quotationNo, 'SE/PMSGY/2026-27/17');

  assert.equal(parseQuotationNo('se/solar/2026-27/11').schemeCode, 'SOLAR');
  assert.equal(parseQuotationNo('SE/PMSGY/2026-2027/38').financialYear, '2026-27');
  assert.equal(parseQuotationNo('SE/PMSGY/2026-27/017').seq, 17);
});

test('parseQuotationNo: rejects malformed numbers', () => {
  assert.equal(parseQuotationNo('SE/PMSGY/26-27/17'), null);
  assert.equal(parseQuotationNo('SE/PMSGY/2026-27'), null);
  assert.equal(parseQuotationNo('SE/PMSGY/2026-27/0'), null);
  assert.equal(parseQuotationNo('random text'), null);
  assert.equal(parseQuotationNo(''), null);
  assert.equal(parseQuotationNo(undefined), null);
  assert.equal(parseQuotationNo('SE/PMSGY/2026-27/12/extra'), null);
});

test('findQuotationNumberInText: reads the number out of a file name', () => {
  const withPrefix = findQuotationNumberInText('SE-PMSGY-2026-27-38_Souvik Ghosh.pdf');
  assert.deepEqual(withPrefix, {
    prefix: 'SE',
    schemeCode: 'PMSGY',
    financialYear: '2026-27',
    seq: 38,
  });

  const slashes = findQuotationNumberInText('SE_PMSGY_2026-27_38.pdf');
  assert.equal(slashes.seq, 38);

  // no prefix, only the year and sequence
  const bare = findQuotationNumberInText('2026-27-38.pdf');
  assert.equal(bare.seq, 38);
  assert.equal(bare.prefix, null);

  // a plain customer name carries no number
  assert.equal(findQuotationNumberInText('Souvik Ghosh_Quotation.pdf'), null);
  assert.equal(findQuotationNumberInText('quotation 39.pdf'), null);
});

test('normaliseName: strips file noise and punctuation', () => {
  assert.equal(normaliseName('  Souvik   Ghosh_Quotation.PDF'), 'souvik ghosh');
  assert.equal(normaliseName('Souvik Ghosh-Quotation copy.pdf'), 'souvik ghosh');
  assert.equal(normaliseName('HARAL GP'), 'haral gp');
  assert.equal(normaliseName('Swapan Kr. Dey'), 'swapan kr dey');
  assert.equal(normaliseName(null), '');
});

test('nameSimilarity: exact names score 1, partial names score in between', () => {
  assert.equal(nameSimilarity('Souvik Ghosh', 'Souvik Ghosh_Quotation.pdf'), 1);
  assert.equal(nameSimilarity('Sourav Singha Roy', 'Sourav  Singha   Roy.pdf'), 1);
  assert.equal(Number(nameSimilarity('HARAL GP', 'NS HARAL GP').toFixed(3)), 0.667);
  assert.equal(Number(nameSimilarity('Kanchan Ghosh', 'Kanchan Singha Roy').toFixed(3)), 0.333);
  assert.equal(nameSimilarity('', 'anything'), 0);
});

test('calculatePanelQty: reproduces the existing quotations (3 kW -> 6 x 610 Wp)', () => {
  assert.equal(calculatePanelQty(3, 610, 1.2), 6);
  assert.equal(calculatePanelQty(3, 610, 1), 5);
  assert.equal(calculatePanelQty(5, 610, 1.2), 10);
  assert.equal(calculatePanelQty(1, 610, 1.2), 2);
  assert.equal(calculatePanelQty(3, 540, 1.2), 7); // ceil(6.66)
});

test('calculatePanelQty: guards against nonsense input', () => {
  assert.equal(calculatePanelQty(0, 610), null);
  assert.equal(calculatePanelQty(-3, 610), null);
  assert.equal(calculatePanelQty(3, 0), null);
  assert.equal(calculatePanelQty('abc', 610), null);
});

test('formatQuotationAmount: plain two decimals, as printed on the sheet', () => {
  assert.equal(formatQuotationAmount(195000), '195000.00');
  assert.equal(formatQuotationAmount(1234.5), '1234.50');
  assert.equal(formatQuotationAmount(0), '0.00');
  assert.equal(formatQuotationAmount('1234.567'), '1234.57');
  assert.equal(formatQuotationAmount(null), '0.00');
});

test('isValidSchemeCode: accepts the schemes actually in use', () => {
  ['PMSGY', 'GP', 'SOLAR', 'MBECL'].forEach((code) => assert.equal(isValidSchemeCode(code), true));
  assert.equal(isValidSchemeCode('pmsgy'), true);
  assert.equal(isValidSchemeCode('P'), false);
  assert.equal(isValidSchemeCode('PMSGY-2026'), false);
  assert.equal(isValidSchemeCode(''), false);
});
