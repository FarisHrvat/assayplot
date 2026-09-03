// Every plot type must render, for the shape it advertises, without throwing.
//
// Uses React's static renderer rather than a browser, so this runs in CI in
// milliseconds. Written with createElement rather than JSX because Node strips
// TypeScript types but does not compile JSX.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  type DataTable,
  type PlotType,
  defaultStyle,
  demoProject,
  makeColumn,
  makeFigure,
  makeTable,
  runAnalysis,
} from '../src/app/model.ts';
import { LayoutFigure, PLOT_KINDS, Plot } from '../src/app/plot.tsx';

/** One populated table per shape, so each plot gets data it can actually draw. */
function tablesByShape(): Record<string, DataTable> {
  const xy = makeTable('XY', 'xy');
  xy.rows = [[1, 10], [2, 19], [3, 31], [4, 42], [5, 48], [6, 61]];

  const grouped = makeTable('Grouped', 'grouped');
  grouped.rows = [['Male', 12, 18], ['Male', 14, 20], ['Female', 10, 15], ['Female', 11, 17]];

  const survival = makeTable('Survival', 'survival');
  survival.rows = [
    [12, 1, 'Vehicle'], [15, 0, 'Vehicle'], [18, 1, 'Vehicle'], [22, 1, 'Vehicle'],
    [20, 1, 'Drug'], [26, 0, 'Drug'], [31, 1, 'Drug'], [38, 0, 'Drug'],
  ];

  return { column: demoProject().tables[0], xy, grouped, survival };
}

function render(table: DataTable, plotType: PlotType, style = {}) {
  const figure = { ...makeFigure('Test figure', table.id, plotType), style: defaultStyle(style) };
  return renderToStaticMarkup(createElement(Plot, { table, figure }));
}

/** Counts drawing primitives, so an "empty but valid" SVG still fails. */
function markCount(markup: string): number {
  return (markup.match(/<(rect|circle|path|polyline|polygon|line|text)\b/g) ?? []).length;
}

const shapes = tablesByShape();

for (const kind of PLOT_KINDS) {
  test(`${kind.id} renders on a ${kind.shape} table`, () => {
    const table = shapes[kind.shape];
    assert.ok(table, `no fixture table for shape ${kind.shape}`);
    const markup = render(table, kind.id);
    assert.match(markup, /^<svg/, `${kind.id} did not produce an svg`);
    assert.ok(markCount(markup) > 5, `${kind.id} drew only ${markCount(markup)} marks`);
  });
}

test('every plot type survives an empty table', () => {
  // A new table is all blanks. Nothing may throw; an explanatory placeholder is
  // the correct output.
  for (const kind of PLOT_KINDS) {
    const empty = makeTable('Empty', kind.shape);
    assert.doesNotThrow(() => render(empty, kind.id), `${kind.id} threw on an empty table`);
  }
});

test('every plot type survives a single observation', () => {
  for (const kind of PLOT_KINDS) {
    const table = makeTable('One value', kind.shape);
    table.rows = [table.columns.map((column, index) =>
      column.role === 'event' ? 1 : column.role === 'group' || column.role === 'label' ? 'A' : index + 1
    )];
    assert.doesNotThrow(() => render(table, kind.id), `${kind.id} threw on one row`);
  }
});

test('a group plot with zero variance still renders', () => {
  // Every value identical: SD is 0 and the axis range collapses.
  const table = demoProject().tables[0];
  table.rows = [[5, 5, 5], [5, 5, 5], [5, 5, 5]];
  for (const plotType of ['bar', 'box', 'violin', 'swarm', 'pointrange'] as PlotType[]) {
    const markup = render(table, plotType);
    assert.match(markup, /^<svg/, `${plotType} failed on zero variance`);
  }
});

test('significance brackets render from a bound analysis', () => {
  const project = demoProject();
  const table = project.tables[0];
  const result = runAnalysis(table, project.analyses[0]);
  const figure = {
    ...makeFigure('With brackets', table.id, 'bar'),
    style: defaultStyle({ showSignificance: true }),
  };
  const markup = renderToStaticMarkup(createElement(Plot, { table, figure, result }));
  assert.ok(
    markup.includes('****') || markup.includes('***') || markup.includes('**'),
    'expected significance stars in the markup'
  );
});

test('an unset axis label leaves no placeholder in the markup', () => {
  // Placeholders are an editing affordance. Without an onSelect handler the
  // figure is not editable, so none may be drawn — this is what a layout panel
  // and an export both see.
  const markup = render(shapes.column, 'bar');
  assert.doesNotMatch(markup, /X axis label|Y axis label/);
});

test('log axes render without producing NaN coordinates', () => {
  const xy = shapes.xy;
  const markup = render(xy, 'scatter', { logX: true, logY: true });
  assert.match(markup, /^<svg/);
  assert.doesNotMatch(markup, /NaN/, 'a non-positive value leaked into a log scale');
});

test('a log axis with a zero in the data does not produce NaN', () => {
  const xy = makeTable('With zero', 'xy');
  xy.rows = [[0, 10], [1, 19], [2, 31], [3, 42]];
  const markup = render(xy, 'scatter', { logX: true });
  assert.doesNotMatch(markup, /NaN/);
});

test('a multi-panel layout composes its panels into one svg', () => {
  const project = demoProject();
  const table = project.tables[0];
  const panels = (['bar', 'box', 'violin'] as PlotType[]).map((plotType) => ({
    figure: { ...makeFigure(plotType, table.id, plotType), style: defaultStyle() },
    table,
    result: null,
  }));
  const markup = renderToStaticMarkup(createElement(LayoutFigure, {
    panels, columns: 2, gap: 18, labelStyle: 'A',
    labelFor: (index: number) => 'ABC'[index],
  }));
  // One outer svg, plus a viewport svg and a figure svg for each panel.
  assert.equal((markup.match(/<svg/g) ?? []).length, 7, 'outer svg plus a viewport and a figure per panel');
  assert.ok(markup.includes('>A<') && markup.includes('>B<') && markup.includes('>C<'));
});

test('an empty layout explains itself rather than rendering nothing', () => {
  const markup = renderToStaticMarkup(createElement(LayoutFigure, {
    panels: [], columns: 2, gap: 18, labelStyle: 'A', labelFor: () => '',
  }));
  assert.match(markup, /Add figures/);
});

test('a figure whose table has non-numeric text does not throw', () => {
  const table: DataTable = {
    id: 't', name: 'Messy', shape: 'column',
    columns: [makeColumn('A'), makeColumn('B')],
    rows: [[1, 'n/a'], ['missing', 4], [3, 5], [null, null]],
  };
  for (const plotType of ['bar', 'dot', 'box', 'histogram', 'ecdf'] as PlotType[]) {
    assert.doesNotThrow(() => render(table, plotType), `${plotType} threw on messy data`);
  }
});
