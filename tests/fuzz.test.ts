// Property tests: throw awkward data at every analysis and assert the invariants
// that must hold whatever the input.
//
// The point is not to check any particular number. It is that a scientist can
// type anything into a spreadsheet — a stray letter, one row, a column of
// identical values, a number in the 1e300s — and the app must respond with a
// result or a readable explanation, never a crash, a NaN presented as a
// finding, or a p-value outside [0, 1].

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type Analysis,
  type Cell,
  type DataTable,
  type Method,
  type TableShape,
  METHODS,
  makeColumn,
  runAnalysis,
} from '../src/app/model.ts';

/** Deterministic generator, so a failure is always reproducible. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** The kinds of cell a real spreadsheet contains. */
function awkwardCell(random: () => number): Cell {
  const roll = random();
  if (roll < 0.12) return null;
  if (roll < 0.18) return '';
  if (roll < 0.22) return 'N/A';
  if (roll < 0.25) return ' 12 ';
  if (roll < 0.28) return 'not a number';
  if (roll < 0.31) return 0;
  if (roll < 0.34) return -Math.round(random() * 100);
  if (roll < 0.37) return 1e300 * random();
  if (roll < 0.40) return 1e-300 * random();
  if (roll < 0.43) return Math.round(random() * 5) / 3;
  return Math.round(random() * 1000) / 10;
}

function randomTable(random: () => number, shape: TableShape): DataTable {
  const columnCount = 1 + Math.floor(random() * 5);
  const rowCount = Math.floor(random() * 8);

  const columns = Array.from({ length: columnCount }, (_, index) => {
    if (shape === 'xy') return makeColumn(`C${index}`, index === 0 ? 'x' : 'y');
    if (shape === 'grouped') return makeColumn(`C${index}`, index === 0 ? 'label' : 'group');
    if (shape === 'survival') {
      return makeColumn(`C${index}`, index === 0 ? 'time' : index === 1 ? 'event' : 'group');
    }
    return makeColumn(`C${index}`);
  });

  const rows: Cell[][] = Array.from({ length: rowCount }, () =>
    columns.map((column) => {
      if (column.role === 'event') return random() < 0.5 ? 1 : 0;
      if (column.role === 'label' || column.role === 'group') {
        return ['A', 'B', '', null][Math.floor(random() * 4)] as Cell;
      }
      return awkwardCell(random);
    })
  );

  return { id: 'fuzz', name: 'Fuzz', shape, columns, rows };
}

const SHAPES: TableShape[] = ['column', 'grouped', 'xy', 'survival'];

/** Walks a result looking for a NaN or Infinity presented as a finding. */
function findBadNumbers(value: unknown, path = 'result'): string[] {
  const bad: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, where: string) => {
    if (typeof node === 'number') {
      // NaN inside `raw` is honest for an undefined statistic; what must never
      // happen is a NaN in the summary a scientist reads.
      if (!Number.isFinite(node) && where.startsWith('result.summary')) {
        bad.push(`${where} = ${node}`);
      }
      return;
    }
    if (typeof node === 'string') {
      if (/\bNaN\b|\bInfinity\b/.test(node) && where.startsWith('result.summary')) {
        bad.push(`${where} = ${JSON.stringify(node)}`);
      }
      return;
    }
    if (node && typeof node === 'object') {
      if (seen.has(node)) return;
      seen.add(node);
      for (const [key, child] of Object.entries(node)) walk(child, `${where}.${key}`);
    }
  };
  walk(value, path);
  return bad;
}

test('no analysis throws on awkward data, whatever the shape', () => {
  const random = makeRandom(20260903);
  const failures: string[] = [];

  for (let iteration = 0; iteration < 400; iteration += 1) {
    const shape = SHAPES[Math.floor(random() * SHAPES.length)];
    const table = randomTable(random, shape);
    for (const info of METHODS) {
      const analysis: Analysis = {
        id: 'a', name: 'fuzz', tableId: table.id,
        method: info.id as Method,
        options: { hypothesised: 0, correction: 'tukey' },
      };
      try {
        runAnalysis(table, analysis);
      } catch (error) {
        failures.push(
          `${info.id} on ${shape} (${table.columns.length}x${table.rows.length}): ` +
          (error instanceof Error ? error.message : String(error))
        );
      }
    }
  }

  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} analyses threw`);
});

test('a p-value is always a probability or absent', () => {
  const random = makeRandom(7);
  const offenders: string[] = [];

  for (let iteration = 0; iteration < 300; iteration += 1) {
    const shape = SHAPES[Math.floor(random() * SHAPES.length)];
    const table = randomTable(random, shape);
    for (const info of METHODS) {
      const result = runAnalysis(table, {
        id: 'a', name: 'f', tableId: table.id, method: info.id as Method, options: {},
      });
      if (result.pValue === null) continue;
      if (!Number.isFinite(result.pValue) || result.pValue < 0 || result.pValue > 1) {
        offenders.push(`${info.id}: p = ${result.pValue}`);
      }
      for (const comparison of result.comparisons) {
        for (const [label, p] of [['raw', comparison.pValue], ['adjusted', comparison.pAdjusted]] as const) {
          if (!Number.isFinite(p) || p < 0 || p > 1) {
            offenders.push(`${info.id} ${label} pairwise p = ${p}`);
          }
        }
      }
    }
  }

  assert.deepEqual(offenders.slice(0, 5), [], `${offenders.length} p-values out of range`);
});

test('a result either reports something or explains why it cannot', () => {
  const random = makeRandom(99);
  const silent: string[] = [];

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const shape = SHAPES[Math.floor(random() * SHAPES.length)];
    const table = randomTable(random, shape);
    for (const info of METHODS) {
      const result = runAnalysis(table, {
        id: 'a', name: 'f', tableId: table.id, method: info.id as Method, options: {},
      });
      const reportsSomething =
        result.summary.length > 0 || result.tables.length > 0 || result.comparisons.length > 0;
      if (!result.error && !reportsSomething) {
        silent.push(`${info.id} on ${shape} with ${table.rows.length} rows`);
      }
    }
  }

  assert.deepEqual(silent.slice(0, 5), [], `${silent.length} results were silent`);
});

test('nothing a scientist reads is NaN or Infinity', () => {
  const random = makeRandom(4242);
  const offenders: string[] = [];

  for (let iteration = 0; iteration < 250; iteration += 1) {
    const shape = SHAPES[Math.floor(random() * SHAPES.length)];
    const table = randomTable(random, shape);
    for (const info of METHODS) {
      const result = runAnalysis(table, {
        id: 'a', name: 'f', tableId: table.id, method: info.id as Method, options: {},
      });
      const bad = findBadNumbers(result);
      if (bad.length) offenders.push(`${info.id}: ${bad[0]}`);
    }
  }

  assert.deepEqual(offenders.slice(0, 5), [], `${offenders.length} summaries contained NaN`);
});

test('an error message names something the user can act on', () => {
  // "invalid input" helps nobody. Every refusal should mention a quantity, a
  // column, or a concrete requirement.
  const random = makeRandom(31337);
  const vague: string[] = [];

  for (let iteration = 0; iteration < 150; iteration += 1) {
    const table = randomTable(random, SHAPES[Math.floor(random() * SHAPES.length)]);
    for (const info of METHODS) {
      const result = runAnalysis(table, {
        id: 'a', name: 'f', tableId: table.id, method: info.id as Method, options: {},
      });
      if (!result.error) continue;
      const actionable =
        /\d/.test(result.error) ||
        /\b(one|two|three|four|five)\b/i.test(result.error) ||
        /column|row|group|value|table|pair|concentration|subject|shape|variance|event/i.test(result.error) ||
        /bound|equivalent|option|categor|stratum|strata|standard error/i.test(result.error);
      if (!actionable) vague.push(`${info.id}: ${result.error}`);
    }
  }

  assert.deepEqual([...new Set(vague)].slice(0, 5), [], `${vague.length} vague errors`);
});

test('an analysis is a pure function of its inputs', () => {
  // The result must not depend on evaluation order or on anything cached, and
  // must never mutate the table it was handed.
  const random = makeRandom(5150);
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const shape = SHAPES[Math.floor(random() * SHAPES.length)];
    const table = randomTable(random, shape);
    const before = JSON.stringify(table);

    for (const info of METHODS) {
      const analysis: Analysis = {
        id: 'a', name: 'f', tableId: table.id, method: info.id as Method, options: {},
      };
      const first = runAnalysis(table, analysis);
      const second = runAnalysis(table, analysis);
      assert.equal(
        JSON.stringify(first.summary), JSON.stringify(second.summary),
        `${info.id} is not deterministic`
      );
      assert.equal(first.pValue, second.pValue, `${info.id} p-value is not deterministic`);
    }

    assert.equal(JSON.stringify(table), before, 'an analysis mutated its input table');
  }
});
