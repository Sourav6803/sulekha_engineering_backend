// tests/amountInWords.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords, integerToIndianWords } from '../src/utils/amountInWords.js';

test('integerToIndianWords: small numbers', () => {
  assert.equal(integerToIndianWords(0), '');
  assert.equal(integerToIndianWords(1), 'One');
  assert.equal(integerToIndianWords(10), 'Ten');
  assert.equal(integerToIndianWords(19), 'Nineteen');
  assert.equal(integerToIndianWords(20), 'Twenty');
  assert.equal(integerToIndianWords(21), 'Twenty One');
  assert.equal(integerToIndianWords(99), 'Ninety Nine');
  assert.equal(integerToIndianWords(100), 'One Hundred');
  assert.equal(integerToIndianWords(101), 'One Hundred One');
  assert.equal(integerToIndianWords(999), 'Nine Hundred Ninety Nine');
});

test('integerToIndianWords: lakh / crore grouping', () => {
  assert.equal(integerToIndianWords(1000), 'One Thousand');
  assert.equal(integerToIndianWords(95000), 'Ninety Five Thousand');
  assert.equal(integerToIndianWords(100000), 'One Lakh');
  assert.equal(integerToIndianWords(195000), 'One Lakh Ninety Five Thousand');
  assert.equal(integerToIndianWords(10000000), 'One Crore');
  assert.equal(
    integerToIndianWords(12345678),
    'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight'
  );
  assert.equal(integerToIndianWords(1000000000), 'One Hundred Crore');
});

test('integerToIndianWords: out of range returns null instead of inventing words', () => {
  assert.equal(integerToIndianWords(1000000000000), null);
});

test('amountInWords: the quotation sentence', () => {
  assert.equal(amountInWords(195000), 'One Lakh Ninety Five Thousand Rupees Only');
  assert.equal(amountInWords(0), 'Zero Rupees Only');
  assert.equal(amountInWords(999), 'Nine Hundred Ninety Nine Rupees Only');
});

test('amountInWords: paise are spelled out', () => {
  assert.equal(amountInWords(1234.5), 'One Thousand Two Hundred Thirty Four Rupees and Fifty Paise Only');
  assert.equal(amountInWords(1234.05), 'One Thousand Two Hundred Thirty Four Rupees and Five Paise Only');
  // rounding at the second decimal
  assert.equal(amountInWords(100.999), 'One Hundred One Rupees Only');
});

test('amountInWords: invalid input yields an empty string', () => {
  assert.equal(amountInWords(-5), '');
  assert.equal(amountInWords('abc'), '');
  assert.equal(amountInWords(null), '');
  assert.equal(amountInWords(undefined), '');
  assert.equal(amountInWords(Infinity), '');
});

test('amountInWords: string input and the Only toggle', () => {
  assert.equal(amountInWords('195000'), 'One Lakh Ninety Five Thousand Rupees Only');
  assert.equal(amountInWords(195000, { includeOnly: false }), 'One Lakh Ninety Five Thousand Rupees');
  assert.equal(amountInWords(500, { currency: 'Dollars' }), 'Five Hundred Dollars Only');
});
