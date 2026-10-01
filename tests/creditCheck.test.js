import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCredit, slabFor, LENDERS } from '../src/data/lenderCriteria.js';

/**
 * The credit verdict is a notice, never a gate, so these tests guard two things:
 * that the published rules are applied to the right slab, and that nothing can
 * come back as a verdict that would stop an application.
 */

const assess = (creditCheck, amount) => assessCredit({ amount, creditCheck });

test('SBI prescribes no minimum up to ₹2 lakh, whatever the score', () => {
  const verdict = assess({ bank: 'SBI', score: 610 }, 195000);
  assert.equal(verdict.status, 'pass');
  assert.match(verdict.headline, /no minimum/i);
});

test('SBI wants 650 above ₹2 lakh', () => {
  assert.equal(assess({ bank: 'SBI', score: 650 }, 320000).status, 'pass');
  assert.equal(assess({ bank: 'SBI', score: 649 }, 320000).status, 'review');
});

test('the ₹2 lakh line itself belongs to the lower slab', () => {
  assert.equal(slabFor(200000), 'upTo2L');
  assert.equal(slabFor(200001), 'above2L');
  // Same score, either side of the line, opposite verdicts at SBI.
  assert.equal(assess({ bank: 'SBI', score: 620 }, 200000).status, 'pass');
  assert.equal(assess({ bank: 'SBI', score: 620 }, 200001).status, 'review');
});

test('Central Bank asks for 680 at both slabs', () => {
  assert.equal(assess({ bank: 'CBI', score: 680 }, 150000).status, 'pass');
  assert.equal(assess({ bank: 'CBI', score: 679 }, 150000).status, 'review');
  assert.equal(assess({ bank: 'CBI', score: 679 }, 400000).status, 'review');
});

test('a default or write-off is a fail at every lender and slab, even with a good score', () => {
  for (const bank of ['SBI', 'CBI', 'PNB']) {
    for (const amount of [150000, 400000]) {
      const verdict = assess({ bank, score: 800, defaultOrWriteOff: true }, amount);
      assert.equal(verdict.status, 'fail', `${bank} at ${amount}`);
      assert.match(verdict.headline, /ineligible/i);
    }
  }
});

test('new to credit is not a failure', () => {
  const verdict = assess({ bank: 'SBI', newToCredit: true }, 400000);
  assert.equal(verdict.status, 'not_checked');
  assert.match(verdict.headline, /new to credit/i);
});

test('a missing score is neutral, not a warning', () => {
  for (const score of [undefined, null, '', 0]) {
    const verdict = assess({ bank: 'SBI', score }, 400000);
    assert.equal(verdict.status, 'not_checked', `score ${JSON.stringify(score)}`);
  }
});

test('a score outside 1–900 is not treated as a score', () => {
  assert.equal(assess({ bank: 'SBI', score: 950 }, 400000).status, 'not_checked');
  assert.equal(assess({ bank: 'SBI', score: -5 }, 400000).status, 'not_checked');
});

test('a lender whose minimum we could not read says so instead of guessing', () => {
  const verdict = assess({ bank: 'PNB', score: 700 }, 400000);
  assert.equal(verdict.status, 'not_checked');
  assert.match(verdict.headline, /not recorded/i);
});

test('no lender chosen yet is not an error', () => {
  const verdict = assess({ score: 700 }, 400000);
  assert.equal(verdict.status, 'not_checked');
  assert.match(verdict.headline, /no lender/i);
});

test('every verdict carries copy for the agent, and no state can block a record', () => {
  const statuses = new Set(['pass', 'review', 'fail', 'not_checked']);
  const inputs = [
    { bank: 'SBI', score: 700 },
    { bank: 'SBI', score: 500 },
    { bank: 'CBI', score: 700 },
    { bank: 'PNB', score: 700 },
    { bank: 'SBI', defaultOrWriteOff: true },
    { bank: 'SBI', newToCredit: true },
    {},
  ];

  for (const creditCheck of inputs) {
    for (const amount of [50000, 200000, 200001, 600000]) {
      const verdict = assessCredit({ amount, creditCheck });
      assert.ok(statuses.has(verdict.status), `unexpected status ${verdict.status}`);
      assert.ok(verdict.headline && verdict.headline.length > 10, 'headline must be usable copy');
      assert.equal(typeof verdict.detail, 'string');
    }
  }
});

test('the two verified lenders are the only rows with figures we read from the bank', () => {
  const withFigures = LENDERS.filter((lender) => !lender.unknown);
  assert.deepEqual(
    withFigures.map((lender) => lender.code).sort(),
    ['CBI', 'SBI']
  );
  // Every other onboarded bank is present but explicitly without a number.
  assert.ok(LENDERS.length >= 12, 'all twelve public-sector banks should be listed');
  assert.equal(LENDERS.find((l) => l.code === 'CBI').above2L.minScore, 680);
  assert.equal(LENDERS.find((l) => l.code === 'SBI').above2L.minScore, 650);
  assert.equal(LENDERS.find((l) => l.code === 'SBI').upTo2L.minScore, null);
});
