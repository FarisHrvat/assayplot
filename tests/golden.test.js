// Validates the statistics core against golden values produced by R.
//
// The fixtures in validation/fixtures/reference.json are committed, so this
// suite runs in CI without R installed. Regenerate them after any intentional
// change with:  Rscript validation/generate/reference.R
//
// A failure here means one of two things: a regression in AssayPlot, or a
// deliberate change that has not yet been reflected in the fixtures. Never
// edit a fixture by hand to make a test pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as stats from '../src/core/stats.js';
import * as posthoc from '../src/core/posthoc.js';
import * as diagnostics from '../src/core/diagnostics.js';

const fixtures = JSON.parse(
  readFileSync(new URL('../validation/fixtures/reference.json', import.meta.url), 'utf8')
);

/** Closed-form statistics must agree to near machine precision. */
const CLOSED_FORM_TOLERANCE = 1e-10;

function relativeError(actual, expected) {
  if (!Number.isFinite(expected)) return Number.isFinite(actual) ? Infinity : 0;
  const scale = Math.max(Math.abs(expected), 1e-300);
  return Math.abs(actual - expected) / scale;
}

/**
 * Values this small are below the resolution of the procedures that produce
 * them (see RANGE_P_FLOOR in posthoc.js). Agreeing that both are negligible is
 * the strongest claim either side can honestly make.
 */
const NEGLIGIBLE = 1e-9;

function assertClose(actual, expected, tolerance, label) {
  if (Math.abs(expected) < NEGLIGIBLE && Math.abs(actual) < NEGLIGIBLE) return;
  assert.equal(typeof actual, 'number', `${label}: expected a number, got ${actual}`);
  const error = relativeError(actual, expected);
  assert.ok(
    error <= tolerance,
    `${label}: got ${actual}, R gives ${expected} (relative error ${error.toExponential(3)} > ${tolerance})`
  );
}

/** Maps a fixture case onto a call into the statistics core. */
const RUNNERS = {
  welchTTest: ({ a, b }) => stats.welchTTest(a, b),
  studentTTest: ({ a, b }) => stats.studentTTest(a, b),
  pairedTTest: ({ a, b }) => stats.pairedTTest(a, b),
  mannWhitney: ({ a, b }) => stats.mannWhitney(a, b),
  wilcoxonSignedRank: ({ a, b }) => stats.wilcoxonSignedRank(a, b),
  kruskalWallis: ({ groups }) => stats.kruskalWallis(groups),
  oneWayAnova: ({ groups }) => stats.oneWayAnova(groups),
  pearsonCorrelation: ({ x, y }) => stats.pearsonCorrelation(x, y),
  spearmanCorrelation: ({ x, y }) => stats.spearmanCorrelation(x, y),
  linearRegression: ({ x, y }) => stats.linearRegression(x, y),
  chiSquareTest: ({ table }) => stats.chiSquareTest(table),
  fisherExactTest: ({ table }) => stats.fisherExactTest(table),
  holmAdjust: ({ p }) => ({ adjusted: stats.holmAdjust(p) }),
  benjaminiHochberg: ({ p }) => ({ adjusted: stats.benjaminiHochberg(p) }),
  // The fixture stores the design by subject; the procedure takes it by condition.
  twoWayAnova: ({ rows }) => stats.twoWayAnova(rows),
  logRankTest: ({ timesA, eventsA, timesB, eventsB }) =>
    stats.logRankTest(timesA, eventsA, timesB, eventsB),
  kaplanMeier: ({ times, events }) => stats.kaplanMeier(times, events),

  friedmanTest: ({ matrix }) =>
    stats.friedmanTest(matrix[0].map((_, index) => matrix.map((row) => row[index]))),

  shapiroWilk: ({ x }) => diagnostics.shapiroWilk(x),
  leveneTest: ({ groups }) => diagnostics.leveneTest(groups),
  grubbsTest: ({ x }) => diagnostics.grubbsTest(x),
  fitFourParameterLogistic: ({ x, y }) => stats.fitFourParameterLogistic(x, y),

  // Flattened so the fixture can compare the whole comparison table at once.
  dunnTest: ({ groups }) => {
    const result = posthoc.dunnTest(groups);
    return {
      z: result.comparisons.map((entry) => entry.z),
      pValues: result.comparisons.map((entry) => entry.pValue),
    };
  },
  bartlettTest: ({ groups }) => diagnostics.bartlettTest(groups),
  oneSampleTTest: ({ x, mu }) => diagnostics.oneSampleTTest(x, mu),

  // Flattened so the fixture can compare whole columns of the comparison table.
  tukeyHSD: ({ groups }) => {
    const result = posthoc.tukeyHSD(groups);
    return {
      differences: result.comparisons.map((entry) => entry.difference),
      pValues: result.comparisons.map((entry) => entry.pValue),
      lower: result.comparisons.map((entry) => entry.confidenceInterval95[0]),
      upper: result.comparisons.map((entry) => entry.confidenceInterval95[1]),
    };
  },
};

// R's fisher.test finds the conditional MLE with optimize() at its default
// tolerance, which is accurate to roughly four significant figures. AssayPlot
// solves E[X | psi] = a by bisection to ~1e-12, and was verified to satisfy that
// equation more closely than R's own estimate. The loose bound here reflects the
// oracle's precision, not ours.
// Tukey values come from a numerically integrated studentized range, which
// agrees with R's ptukey to about 1e-10. Its p-values are then computed as
// 1 - CDF, which loses leading digits once the CDF saturates, so far-tail
// values are looser than the intervals -- see RANGE_P_FLOOR in posthoc.js.
// Values below NEGLIGIBLE are past the resolution of either implementation.
const FIELD_TOLERANCE = {
  oddsRatioConditional: 1e-3,
  // The 4PL fit is a coordinate search against R's Levenberg-Marquardt; both
  // land on the same optimum but stop at slightly different points on it.
  ec50: 1e-5, hillSlope: 1e-5, bottom: 1e-5, top: 1e-5,
  pValues: 1e-4,
  lower: 1e-7,
  upper: 1e-7,
  differences: 1e-10,
};

/** Fields R reports that AssayPlot deliberately names differently or omits. */
const SKIP_FIELDS = new Set([]);

for (const testCase of fixtures.cases) {
  const { id, procedure, input, expected, note } = testCase;
  const title = `R parity: ${id} (${procedure})${note ? ` — ${note}` : ''}`;

  test(title, () => {
    const runner = RUNNERS[procedure];
    assert.ok(runner, `no runner registered for procedure "${procedure}"`);

    const result = runner(input);

    for (const [field, expectedValue] of Object.entries(expected)) {
      if (SKIP_FIELDS.has(field)) continue;

      const actualValue = result[field];
      const tolerance = FIELD_TOLERANCE[field] ?? CLOSED_FORM_TOLERANCE;

      if (typeof expectedValue === 'boolean') {
        assert.equal(actualValue, expectedValue, `${id}.${field}`);
      } else if (Array.isArray(expectedValue)) {
        assert.ok(Array.isArray(actualValue), `${id}.${field}: expected an array`);
        assert.equal(actualValue.length, expectedValue.length, `${id}.${field}: length`);
        expectedValue.forEach((value, index) => {
          assertClose(actualValue[index], value, tolerance, `${id}.${field}[${index}]`);
        });
      } else {
        assertClose(actualValue, expectedValue, tolerance, `${id}.${field}`);
      }
    }
  });
}

test('fixture file is present and non-trivial', () => {
  assert.ok(fixtures.cases.length >= 20, 'expected at least 20 golden cases');
  assert.match(fixtures.generatedBy, /^R \d/);
});
