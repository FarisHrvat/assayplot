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
    const scale = Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
    if (Math.abs(a - b) / scale > TOLERANCE) {
      differences.push(`${path}: committed ${a}, R now gives ${b}`);
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
  console.error(`${differences.length} value(s) differ by more than ${TOLERANCE} relative:\n`);
  for (const line of differences.slice(0, 40)) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`All ${left.length} cases agree with R to within ${TOLERANCE} relative.`);
