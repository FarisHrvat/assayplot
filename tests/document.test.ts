// Document model, live-link, and project round-trip tests.
//
// These run against the same TypeScript modules the app imports, so a
// regression in the recompute chain or the file format fails here rather than
// in someone's browser.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  type Analysis,
  type DataTable,
  demoProject,
  makeColumn,
  runAnalysis,
  significanceStars,
  methodsSentence,
  availableMethods,
  columnValues,
} from '../src/app/model.ts';
import {
  deserializeProject,
  migrate,
  parseClipboard,
  serializeProject,
  tableFromDelimited,
  tableToCsv,
} from '../src/app/io.ts';

function tableOf(columns: Record<string, (number | null)[]>): DataTable {
  const names = Object.keys(columns);
  const depth = Math.max(...names.map((name) => columns[name].length));
  return {
    id: 'tbl_test',
    name: 'Test',
    shape: 'column',
    columns: names.map((name) => makeColumn(name)),
    rows: Array.from({ length: depth }, (_, row) => names.map((name) => columns[name][row] ?? null)),
  };
}

// ---------------------------------------------------------------- the link

test('editing a cell changes the analysis result', () => {
  const before = tableOf({ A: [10, 11, 12, 13], B: [20, 21, 22, 23] });
  const analysis: Analysis = {
    id: 'a', name: 'test', tableId: before.id, method: 'welch', options: {},
  };

  const first = runAnalysis(before, analysis);
  assert.equal(first.error, null);
  assert.ok(first.pValue !== null && first.pValue < 0.001, 'separated groups should differ');

  // Move group B down on top of A: the difference should disappear.
  const after: DataTable = {
    ...before,
    rows: before.rows.map((row) => [row[0], Number(row[0])]),
  };
  const second = runAnalysis(after, analysis);
  assert.ok(second.pValue !== null && second.pValue > 0.9, 'identical groups should not differ');
});

test('an analysis reports why it cannot run rather than throwing', () => {
  const table = tableOf({ A: [1, 2, 3], B: [4, 5, 6], C: [7, 8, 9] });
  const analysis: Analysis = {
    id: 'a', name: 'test', tableId: table.id, method: 'welch', options: {},
  };
  const result = runAnalysis(table, analysis);
  assert.equal(result.pValue, null);
  assert.match(result.error ?? '', /exactly two/i);
});

test('paired tests refuse mismatched group sizes with an actionable message', () => {
  const table = tableOf({ Before: [1, 2, 3, 4], After: [2, 3] });
  const analysis: Analysis = {
    id: 'a', name: 'test', tableId: table.id, method: 'paired', options: {},
  };
  const result = runAnalysis(table, analysis);
  assert.match(result.error ?? '', /equal numbers/i);
});

test('post-hoc comparisons are corrected and cover every pair', () => {
  const table = tableOf({ A: [1, 2, 3, 2], B: [5, 6, 7, 6], C: [9, 10, 11, 10] });
  const analysis: Analysis = {
    id: 'a', name: 'test', tableId: table.id, method: 'anova',
    options: { correction: 'holm' },
  };
  const result = runAnalysis(table, analysis);
  assert.equal(result.comparisons.length, 3, 'three groups give three pairs');
  for (const comparison of result.comparisons) {
    assert.ok(comparison.pAdjusted >= comparison.pValue - 1e-12, 'Holm never lowers a p-value');
  }
});

test('switching the correction changes the adjusted p-values', () => {
  const table = tableOf({ A: [1, 2, 3, 2], B: [3, 4, 5, 4], C: [5, 6, 7, 6], D: [7, 8, 9, 8] });
  const base: Analysis = { id: 'a', name: 't', tableId: table.id, method: 'anova', options: {} };

  const holm = runAnalysis(table, { ...base, options: { correction: 'holm' } });
  const bh = runAnalysis(table, { ...base, options: { correction: 'bh' } });
  const none = runAnalysis(table, { ...base, options: { correction: 'none' } });

  assert.ok(holm.comparisons[0].pAdjusted >= bh.comparisons[0].pAdjusted - 1e-12,
    'Holm is at least as conservative as Benjamini-Hochberg');
  assert.equal(none.comparisons[0].pAdjusted, none.comparisons[0].pValue);
  assert.ok(none.warnings.length > 0, 'uncorrected comparisons must warn');
});

test('tied data still gets an exact test when the sample is small enough', () => {
  // R 4.5 began conditioning on the observed midranks rather than falling back
  // to a normal approximation. This matches it.
  const table = tableOf({ A: [1, 2, 2, 3, 5], B: [2, 3, 4, 4, 6] });
  const result = runAnalysis(table, {
    id: 'a', name: 't', tableId: table.id, method: 'mannwhitney', options: {},
  });
  assert.equal(result.raw.ties, true);
  assert.equal(result.raw.exact, true);
  assert.match(String(result.raw.pApproach), /conditional/);
  assert.ok(Math.abs((result.pValue as number) - 2 / 9) < 1e-12, `p was ${result.pValue}`);
  assert.equal(result.warnings.length, 0, 'nothing to warn about when the test is exact');
});

test('a tied sample too large to enumerate falls back and says so', () => {
  const big = (offset: number) => Array.from({ length: 40 }, (_, i) => (i % 7) + offset);
  const table = tableOf({ A: big(0), B: big(1) });
  const result = runAnalysis(table, {
    id: 'a', name: 't', tableId: table.id, method: 'mannwhitney', options: {},
  });
  assert.equal(result.raw.exact, false);
  assert.ok(result.warnings.some((w) => /normal approximation/i.test(w)));
});

// ------------------------------------------------------------- guardrails

test('methods offered depend on the shape of the table', () => {
  const twoGroups = tableOf({ A: [1, 2], B: [3, 4] });
  const usable = availableMethods(twoGroups).filter((entry) => entry.usable).map((e) => e.info.id);
  assert.ok(usable.includes('welch'));
  assert.ok(!usable.includes('anova'), 'ANOVA needs three groups');
  assert.ok(!usable.includes('regression'), 'regression needs an XY table');

  const xy: DataTable = {
    id: 'x', name: 'XY', shape: 'xy',
    columns: [makeColumn('X', 'x'), makeColumn('Y', 'y')],
    rows: [[1, 2], [2, 4], [3, 6]],
  };
  const xyUsable = availableMethods(xy).filter((entry) => entry.usable).map((e) => e.info.id);
  assert.ok(xyUsable.includes('regression'));
  assert.ok(!xyUsable.includes('welch'), 'group tests need a column table');
});

test('significance stars follow the conventional thresholds', () => {
  assert.equal(significanceStars(0.00001), '****');
  assert.equal(significanceStars(0.0005), '***');
  assert.equal(significanceStars(0.005), '**');
  assert.equal(significanceStars(0.02), '*');
  assert.equal(significanceStars(0.4), 'ns');
});

test('methods text states the test and reads as a sentence', () => {
  const table = tableOf({ Control: [1, 2, 3, 4], Treated: [8, 9, 10, 11] });
  const analysis: Analysis = { id: 'a', name: 't', tableId: table.id, method: 'welch', options: {} };
  const sentence = methodsSentence(table, analysis, runAnalysis(table, analysis));
  assert.match(sentence, /Welch/);
  assert.match(sentence, /Control/);
  assert.match(sentence, /P [=<]/, 'reads "P = x" or "P < x", never "P = < x"');
  assert.doesNotMatch(sentence, /P = </);
});

// ------------------------------------------------------------ file format

test('a project survives a save and reopen unchanged', () => {
  const original = demoProject();
  const restored = deserializeProject(serializeProject(original));

  assert.equal(restored.name, original.name);
  assert.deepEqual(restored.tables, original.tables);
  assert.deepEqual(restored.analyses, original.analyses);
  assert.deepEqual(restored.figures, original.figures);
});

test('a reopened project still computes the same result', () => {
  const original = demoProject();
  const restored = deserializeProject(serializeProject(original));
  const before = runAnalysis(original.tables[0], original.analyses[0]);
  const after = runAnalysis(restored.tables[0], restored.analyses[0]);
  assert.equal(after.pValue, before.pValue);
});

test('the project file is a readable ZIP of JSON', () => {
  const bytes = serializeProject(demoProject());
  assert.equal(bytes[0], 0x50, 'starts with PK');
  assert.equal(bytes[1], 0x4b);
});

test('a prototype-era project migrates forward to the current schema', () => {
  const old = {
    schemaVersion: 2,
    projectTitle: 'Old experiment',
    roles: { group: 'group', value: 'value' },
    data: [
      { group: 'Control', value: 10 },
      { group: 'Control', value: 12 },
      { group: 'Treated', value: 20 },
      { group: 'Treated', value: 22 },
    ],
  };
  const migrated = migrate(old);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.tables.length, 1);
  assert.deepEqual(migrated.tables[0].columns.map((c) => c.name), ['Control', 'Treated']);
  assert.deepEqual(columnValues(migrated.tables[0], migrated.tables[0].columns[0].id), [10, 12]);
  assert.deepEqual(columnValues(migrated.tables[0], migrated.tables[0].columns[1].id), [20, 22]);
});

test('opening a file that is not a project fails with a readable message', () => {
  assert.throws(
    () => deserializeProject(new TextEncoder().encode('this is not a project')),
    /not an AssayPlot project/
  );
});

// ----------------------------------------------------------------- import

test('CSV import detects a header row and parses numbers', () => {
  const table = tableFromDelimited('Control,Treated\n10,20\n12,22\n', 'demo');
  assert.deepEqual(table.columns.map((c) => c.name), ['Control', 'Treated']);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0], [10, 20]);
});

test('CSV import handles a headerless numeric file', () => {
  const table = tableFromDelimited('1,2\n3,4\n', 'demo');
  assert.deepEqual(table.columns.map((c) => c.name), ['Column 1', 'Column 2']);
  assert.equal(table.rows.length, 2);
});

test('quoted fields containing the delimiter survive import', () => {
  const table = tableFromDelimited('"Dose, mg",Response\n1,50\n', 'demo');
  assert.equal(table.columns[0].name, 'Dose, mg');
});

test('tab-separated text pastes as a rectangular block', () => {
  const block = parseClipboard('1\t2\t3\n4\t5\t6');
  assert.deepEqual(block, [[1, 2, 3], [4, 5, 6]]);
});

test('blank cells in a paste become nulls, not zeros', () => {
  const block = parseClipboard('1\t\t3');
  assert.deepEqual(block, [[1, null, 3]]);
});

test('CSV export round-trips through import', () => {
  const original = tableFromDelimited('A,B\n1,2\n3,4\n', 'demo');
  const reimported = tableFromDelimited(tableToCsv(original), 'demo');
  assert.deepEqual(reimported.rows, original.rows);
  assert.deepEqual(
    reimported.columns.map((c) => c.name),
    original.columns.map((c) => c.name)
  );
});

// ------------------------------------------------------- blank-cell safety

test('empty rows do not become (0, 0) points in an XY table', () => {
  const table: DataTable = {
    id: 'x', name: 'XY', shape: 'xy',
    columns: [makeColumn('X', 'x'), makeColumn('Y', 'y')],
    // Two real observations followed by the blank rows a new table starts with.
    rows: [[1, 10], [2, 20], [null, null], [null, null]],
  };
  const analysis: Analysis = {
    id: 'a', name: 't', tableId: table.id, method: 'regression', options: {},
  };
  const result = runAnalysis(table, analysis);
  // Two real rows plus two blank ones must count as two, not four.
  assert.match(result.error ?? '', /at least three rows/,
    'blank rows must not be counted as observations');
  assert.match(result.error ?? '', /has 2\b/, 'the message should say how many were usable');
});

test('a partly blank XY table uses only the complete rows', () => {
  const table: DataTable = {
    id: 'x', name: 'XY', shape: 'xy',
    columns: [makeColumn('X', 'x'), makeColumn('Y', 'y')],
    rows: [[1, 2], [2, 4], [3, 6], [4, null], [null, 10], [null, null]],
  };
  const result = runAnalysis(table, {
    id: 'a', name: 't', tableId: table.id, method: 'regression', options: {},
  });
  assert.equal(result.error, null);
  assert.equal(result.raw.n, 3, 'only the three complete pairs count');
  assert.ok(Math.abs((result.raw.slope as number) - 2) < 1e-12);
});

// ------------------------------------------------------- closing documents

test('closing a table also closes what was built on it', async () => {
  const { useStore } = await import('../src/app/store.ts');
  const project = demoProject();
  useStore.getState().replaceProject(project);

  const tableId = project.tables[0].id;
  assert.equal(useStore.getState().project.analyses.length, 1);
  assert.equal(useStore.getState().project.figures.length, 1);

  useStore.getState().deleteNode('table', tableId);

  const after = useStore.getState().project;
  assert.equal(after.tables.length, 0, 'the table is gone');
  assert.equal(after.analyses.length, 0, 'its analysis went with it');
  assert.equal(after.figures.length, 0, 'its figure went with it');
});

test('deleting an analysis leaves its table and unlinks dependent figures', async () => {
  const { useStore } = await import('../src/app/store.ts');
  const project = demoProject();
  useStore.getState().replaceProject(project);

  useStore.getState().deleteNode('analysis', project.analyses[0].id);

  const after = useStore.getState().project;
  assert.equal(after.tables.length, 1, 'the data survives');
  assert.equal(after.analyses.length, 0);
  assert.equal(after.figures.length, 1, 'the figure survives');
  assert.equal(after.figures[0].analysisId, null, 'but no longer points at a missing analysis');
});

test('closing a table can be undone', async () => {
  const { useStore } = await import('../src/app/store.ts');
  useStore.getState().replaceProject(demoProject());
  const before = useStore.getState().project;

  useStore.getState().deleteNode('table', before.tables[0].id);
  assert.equal(useStore.getState().project.tables.length, 0);

  useStore.getState().undo();
  assert.equal(useStore.getState().project.tables.length, 1);
  assert.equal(useStore.getState().project.analyses.length, 1);
  assert.equal(useStore.getState().project.figures.length, 1);
});

test('a new project starts empty but usable', async () => {
  const { useStore } = await import('../src/app/store.ts');
  const { emptyProject } = await import('../src/app/model.ts');
  useStore.getState().replaceProject(emptyProject());
  const project = useStore.getState().project;
  assert.equal(project.tables.length, 1);
  assert.equal(project.analyses.length, 0);
  assert.equal(project.figures.length, 0);
  assert.equal(useStore.getState().dirty, false, 'a fresh project is not dirty');
});

// ------------------------------------------------------------ layouts

test('a layout survives a save and reopen, and keeps its panel order', async () => {
  const { makeLayout, makeFigure } = await import('../src/app/model.ts');
  const project = demoProject();
  const second = makeFigure('Second', project.tables[0].id, 'box');
  const layout = makeLayout('Figure 1', [project.figures[0].id, second.id]);
  const withLayout = { ...project, figures: [...project.figures, second], layouts: [layout] };

  const restored = deserializeProject(serializeProject(withLayout));
  assert.equal(restored.layouts.length, 1);
  assert.deepEqual(restored.layouts[0].panels, [project.figures[0].id, second.id]);
  assert.equal(restored.layouts[0].columns, 2);
  assert.equal(restored.layouts[0].labelStyle, 'A');
});

test('a project saved before layouts existed still opens', () => {
  const older = { ...demoProject(), schemaVersion: 4 } as any;
  delete older.layouts;
  const migrated = migrate(older);
  assert.deepEqual(migrated.layouts, []);
  assert.equal(migrated.tables.length, 1);
});

test('panel labels follow the chosen style', async () => {
  const { panelLabel } = await import('../src/app/model.ts');
  assert.equal(panelLabel('A', 0), 'A');
  assert.equal(panelLabel('A', 2), 'C');
  assert.equal(panelLabel('a', 1), 'b');
  assert.equal(panelLabel('1', 3), '4');
  assert.equal(panelLabel('none', 0), '');
});

test('deleting a figure removes it from every layout that used it', async () => {
  const { useStore } = await import('../src/app/store.ts');
  const { makeLayout } = await import('../src/app/model.ts');
  const project = demoProject();
  const figureId = project.figures[0].id;
  useStore.getState().replaceProject({ ...project, layouts: [makeLayout('L', [figureId])] });

  useStore.getState().deleteNode('figure', figureId);

  const after = useStore.getState().project;
  assert.equal(after.figures.length, 0);
  assert.deepEqual(after.layouts[0].panels, [], 'the layout must not keep a dangling panel');
});

test('moving a panel reorders it and stops at the ends', async () => {
  const { useStore } = await import('../src/app/store.ts');
  const { makeLayout, makeFigure } = await import('../src/app/model.ts');
  const project = demoProject();
  const b = makeFigure('B', project.tables[0].id);
  const c = makeFigure('C', project.tables[0].id);
  const layout = makeLayout('L', [project.figures[0].id, b.id, c.id]);
  useStore.getState().replaceProject({ ...project, figures: [...project.figures, b, c], layouts: [layout] });

  useStore.getState().movePanel(layout.id, 2, -1);
  assert.deepEqual(useStore.getState().project.layouts[0].panels, [project.figures[0].id, c.id, b.id]);

  useStore.getState().movePanel(layout.id, 0, -1);
  assert.deepEqual(
    useStore.getState().project.layouts[0].panels,
    [project.figures[0].id, c.id, b.id],
    'moving the first panel up is a no-op, not a crash'
  );
});

// ------------------------------------------------------- dose response

/** Builds an XY table of a clean four-parameter curve with a known EC50. */
function doseResponseTable(direction: 'up' | 'down'): DataTable {
  const doses = [0.5, 1.5, 5, 15, 50, 150, 500, 1500, 5000];
  const response = (dose: number) =>
    direction === 'up'
      ? 5 + 95 / (1 + Math.pow(50 / dose, 1.1))
      : 5 + 95 / (1 + Math.pow(dose / 50, 1.1));
  return {
    id: 'dr', name: 'Dose response', shape: 'xy',
    columns: [makeColumn('Concentration', 'x'), makeColumn('Response', 'y')],
    rows: doses.map((dose) => [dose, response(dose)]),
  };
}

const doseAnalysis = (options = {}): Analysis => ({
  id: 'a', name: 'fit', tableId: 'dr', method: 'doseresponse', options,
});

test('a dose-response fit recovers the EC50 it was generated from', () => {
  const result = runAnalysis(doseResponseTable('up'), doseAnalysis());
  assert.equal(result.error, null);
  assert.ok(Math.abs((result.raw.ec50 as number) - 50) < 1e-4, `EC50 was ${result.raw.ec50}`);
  assert.ok(Math.abs((result.raw.hillSlope as number) - 1.1) < 1e-4);
  assert.ok((result.raw.r2 as number) > 0.9999);
});

test('Bottom is the response at low dose and Top at high dose, for both directions', () => {
  // The universal convention: Bottom is the low-dose asymptote.
  // An inverted parameterisation still fits the data perfectly, so only an
  // assertion on the labels catches it.
  const rising = runAnalysis(doseResponseTable('up'), doseAnalysis());
  assert.ok(Math.abs((rising.raw.bottom as number) - 5) < 1e-3, `rising Bottom was ${rising.raw.bottom}`);
  assert.ok(Math.abs((rising.raw.top as number) - 100) < 1e-3, `rising Top was ${rising.raw.top}`);

  const falling = runAnalysis(doseResponseTable('down'), doseAnalysis());
  assert.ok(Math.abs((falling.raw.bottom as number) - 100) < 1e-3, `falling Bottom was ${falling.raw.bottom}`);
  assert.ok(Math.abs((falling.raw.top as number) - 5) < 1e-3, `falling Top was ${falling.raw.top}`);
});

test('a fitted curve is returned in the same X units as the table', () => {
  const linear = runAnalysis(doseResponseTable('up'), doseAnalysis());
  assert.ok(linear.fittedCurve && linear.fittedCurve.length > 100);
  assert.ok(Math.abs(linear.fittedCurve![0].x - 0.5) < 1e-9, 'curve starts at the lowest concentration');
  assert.ok(Math.abs(linear.fittedCurve!.at(-1)!.x - 5000) < 1e-6, 'and ends at the highest');
});

test('a table already holding log concentrations fits the same curve', () => {
  const linear = runAnalysis(doseResponseTable('up'), doseAnalysis());

  const logged = doseResponseTable('up');
  logged.rows = logged.rows.map(([dose, y]) => [Math.log10(Number(dose)), y]);
  const result = runAnalysis(logged, doseAnalysis({ logX: true }));

  assert.equal(result.error, null);
  assert.ok(
    Math.abs((result.raw.ec50 as number) - (linear.raw.ec50 as number)) < 1e-6,
    'the EC50 is a concentration either way'
  );
  // The overlay has to be plotted in the table's own units.
  assert.ok(Math.abs(result.fittedCurve![0].x - Math.log10(0.5)) < 1e-9);
});

test('a zero-dose control is refused with an explanation, not a crash', () => {
  const table = doseResponseTable('up');
  table.rows = [[0, 5], [0, 6], [0, 4]];
  const result = runAnalysis(table, doseAnalysis());
  assert.match(result.error ?? '', /above zero/);
});

test('zero-dose rows are dropped and counted rather than failing the whole fit', () => {
  const table = doseResponseTable('up');
  table.rows = [[0, 5], ...table.rows];
  const result = runAnalysis(table, doseAnalysis());
  assert.equal(result.error, null);
  assert.ok(result.warnings.some((warning) => /left out of the fit/.test(warning)));
  assert.ok(Math.abs((result.raw.ec50 as number) - 50) < 1e-4);
});

test('a copied figure can be pasted into a layout', async () => {
  const { useStore } = await import('../src/app/store.ts');
  const { makeLayout, makeFigure } = await import('../src/app/model.ts');
  const project = demoProject();
  const second = makeFigure('Second', project.tables[0].id, 'box');
  const layout = makeLayout('Panel', []);
  useStore.getState().replaceProject({ ...project, figures: [...project.figures, second], layouts: [layout] });

  useStore.getState().copyFigures([project.figures[0].id, second.id]);
  const added = useStore.getState().pasteIntoLayout(layout.id);

  assert.equal(added, 2);
  assert.deepEqual(useStore.getState().project.layouts[0].panels, [project.figures[0].id, second.id]);
});

test('pasting a figure that has since been deleted adds nothing', async () => {
  const { useStore } = await import('../src/app/store.ts');
  const { makeLayout } = await import('../src/app/model.ts');
  const project = demoProject();
  const layout = makeLayout('Panel', []);
  useStore.getState().replaceProject({ ...project, layouts: [layout] });

  useStore.getState().copyFigures(['fig_that_never_existed']);
  assert.equal(useStore.getState().pasteIntoLayout(layout.id), 0);
  assert.deepEqual(useStore.getState().project.layouts[0].panels, []);
});

test('the same figure may appear twice in a layout', async () => {
  const { useStore } = await import('../src/app/store.ts');
  const { makeLayout } = await import('../src/app/model.ts');
  const project = demoProject();
  const layout = makeLayout('Panel', []);
  useStore.getState().replaceProject({ ...project, layouts: [layout] });

  useStore.getState().copyFigures([project.figures[0].id]);
  useStore.getState().pasteIntoLayout(layout.id);
  useStore.getState().pasteIntoLayout(layout.id);
  assert.equal(useStore.getState().project.layouts[0].panels.length, 2);
});
