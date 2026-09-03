// Procedures with no R implementation to check against.
//
// Simon's two-stage designs are checked against the table published with the
// method in 1989, which is a genuine external oracle. ROUT has no published
// per-dataset values, so it is checked on the two things the paper claims for
// it: it finds several outliers without one masking another, and its false
// discovery rate on clean data stays under the rate asked for.

import test from 'node:test';
import assert from 'node:assert/strict';
import { simonTwoStage, routOutliers } from '../src/core/designs.js';

/** Simon 1989, Table 1: alpha 0.05, power 0.80. */
const PUBLISHED = [
  { p0: 0.05, p1: 0.25, optimal: [0, 9, 2, 17], minimax: [0, 12, 2, 16] },
  { p0: 0.10, p1: 0.30, optimal: [1, 10, 5, 29], minimax: [1, 15, 5, 25] },
  { p0: 0.20, p1: 0.40, optimal: [3, 13, 12, 43], minimax: [4, 18, 10, 33] },
  { p0: 0.30, p1: 0.50, optimal: [5, 15, 18, 46], minimax: [6, 19, 16, 39] },
  { p0: 0.40, p1: 0.60, optimal: [7, 16, 23, 46], minimax: [17, 34, 20, 39] },
];

for (const entry of PUBLISHED) {
  test(`Simon two-stage, p0 ${entry.p0} against p1 ${entry.p1}`, () => {
    const found = simonTwoStage(entry.p0, entry.p1, 0.05, 0.2, 80);
    const shape = (design) => [design.r1, design.n1, design.r, design.n];
    assert.deepEqual(shape(found.optimal), entry.optimal, 'optimal design');
    assert.deepEqual(shape(found.minimax), entry.minimax, 'minimax design');
    assert.ok(found.optimal.alpha <= 0.05 + 1e-12, 'optimal holds the size');
    assert.ok(found.optimal.power >= 0.8 - 1e-12, 'optimal holds the power');
    assert.ok(found.minimax.n <= found.optimal.n, 'minimax is never the larger design');
  });
}

test('an impossible design is refused with a reason', () => {
  assert.throws(() => simonTwoStage(0.3, 0.32, 0.05, 0.2, 40), /No design of up to 40 patients/);
  assert.throws(() => simonTwoStage(0.4, 0.2), /higher than/);
});

test('ROUT finds several outliers without one hiding another', () => {
  // Grubbs finds one at a time and the second inflates the SD used to judge
  // the first, so a pair of outliers can mask each other. ROUT should not care.
  const clean = [10.1, 9.8, 10.4, 9.9, 10.2, 10.0, 9.7, 10.3, 9.95, 10.05, 10.15, 9.85];
  assert.equal(routOutliers(clean).flagged, 0, 'clean data was flagged');

  const contaminated = [...clean, 25, 30];
  const found = routOutliers(contaminated);
  assert.deepEqual(found.outliers.map((entry) => entry.value), [25, 30]);
  assert.equal(found.kept.length, clean.length);
  // The centre must come from the clean points, not be dragged by the pair.
  assert.ok(Math.abs(found.centre - 10) < 0.2, `centre moved to ${found.centre}`);
});

test('ROUT keeps its false discovery rate under the rate asked for', () => {
  // A fixed generator, so the figure below is a property of the method rather
  // than of whichever seed the suite happened to run with.
  let state = 12345;
  const uniform = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const normal = () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());

  let flagged = 0;
  let total = 0;
  for (let sample = 0; sample < 1000; sample += 1) {
    const values = Array.from({ length: 20 }, normal);
    flagged += routOutliers(values, { q: 0.01 }).flagged;
    total += values.length;
  }
  assert.ok(flagged / total <= 0.01, `flagged ${(100 * flagged / total).toFixed(2)}% of clean points`);
});

test('ROUT refuses a sample too small to judge', () => {
  assert.throws(() => routOutliers([1, 2, 3]), /at least four/);
});
