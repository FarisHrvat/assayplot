// Compares two fixture files numerically.
//
//   node scripts/compare-fixtures.mjs committed.json regenerated.json
//
// A byte comparison is too strict across platforms: R's math library differs
// by an ulp between macOS on ARM and Linux on x86, so the same computation
// serialises as 7.93177737881508 in one place and ...09 in the other. That is
// not a changed procedure, and failing the build over it teaches people to
// ignore the check. A real change moves a value far more than this.

import { readFileSync } from 'node:fs';

const TOLERANCE = 1e-12;

/**
 * Values below this are past the resolution of the procedure that produced
 * them. R's own ptukey, for instance, returns 2.1080936996043e-10 on macOS and
 * 2.10809036893522e-10 on Linux for the same input: a relative difference of
 * 1.6e-6, from a numerical integration whose last digits are platform noise.
 * Agreeing that both are negligible is the strongest honest claim.
 */
const NEGLIGIBLE = 1e-9;

/**
 * Fields R computes by integration or iteration rather than in closed form.
 * These carry the oracle's own precision, not ours, and it is not identical
 * across platforms. A real change to a procedure moves a value by orders of
 * magnitude, not by the eleventh significant figure.
 */
const FIELD_TOLERANCE = {
  // The studentized range, integrated numerically inside R.
  pValues: 1e-8,
  // R's fisher.test finds this with optimize() at its default tolerance.
  oddsRatioConditional: 1e-6,
  // nls, and the IRLS behind glm, geeglm and lme: all stop on a convergence
  // criterion rather than at an exact point.
  ec50: 1e-7, hillSlope: 1e-7, top: 1e-7, bottom: 1e-7,
  interceptSE: 1e-9, slopeSE: 1e-9, slopeP: 1e-9,
  estimates: 1e-9, standardErrors: 1e-9,
  workingCorrelation: 1e-9, dispersion: 1e-9,
  restrictedLogLikelihood: 1e-9, fStatistic: 1e-9,
  subjectSd: 1e-9, residualSd: 1e-9,
};

/** The last named segment of a path like "tukey.pValues[0]". */
function fieldOf(path) {
  const segments = path.replace(/\[\d+\]/g, '').split('.');
  return segments[segments.length - 1];
}

const [, , leftPath, rightPath] = process.argv;
if (!leftPath || !rightPath) {
  console.error('usage: compare-fixtures.mjs <committed.json> <regenerated.json>');
  process.exit(2);
}

const load = (path) => JSON.parse(readFileSync(path, 'utf8')).cases;
const left = load(leftPath);
const right = load(rightPath);

const differences = [];

function compare(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    if (Math.abs(a) < NEGLIGIBLE && Math.abs(b) < NEGLIGIBLE) return;
    const tolerance = FIELD_TOLERANCE[fieldOf(path)] ?? TOLERANCE;
    const scale = Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
    const error = Math.abs(a - b) / scale;
    if (error > tolerance) {
      differences.push(
        `${path}: committed ${a}, R now gives ${b} (relative ${error.toExponential(2)} > ${tolerance})`
      );
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      differences.push(`${path}: ${a.length} values committed, ${b.length} now`);
      return;
    }
    a.forEach((value, index) => compare(value, b[index], `${path}[${index}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!(key in a)) { differences.push(`${path}.${key}: new in the regenerated file`); continue; }
      if (!(key in b)) { differences.push(`${path}.${key}: missing from the regenerated file`); continue; }
      compare(a[key], b[key], `${path}.${key}`);
    }
    return;
  }
  if (a !== b) differences.push(`${path}: committed ${JSON.stringify(a)}, now ${JSON.stringify(b)}`);
}

const byId = (cases) => Object.fromEntries(cases.map((entry) => [entry.id, entry]));
const committed = byId(left);
const regenerated = byId(right);

for (const id of new Set([...Object.keys(committed), ...Object.keys(regenerated)])) {
  if (!committed[id]) { differences.push(`${id}: a new case R produces but the file does not have`); continue; }
  if (!regenerated[id]) { differences.push(`${id}: committed but R no longer produces it`); continue; }
  compare(committed[id].expected, regenerated[id].expected, id);
}

if (differences.length) {
  console.error(`${differences.length} value(s) have drifted:\n`);
  for (const line of differences.slice(0, 40)) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`All ${left.length} cases agree with R, to ${TOLERANCE} relative except where noted in this script.`);
