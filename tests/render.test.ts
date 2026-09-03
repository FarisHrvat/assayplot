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

/**
 * Some plots fit a model, so a generic table of the right shape is not enough:
 * a logistic curve needs a 0/1 outcome, ANCOVA needs a group per Y column, and
 * a Cox forest needs a numeric predictor beside time and event.
 */
function tablesByPlot(): Record<string, DataTable> {
  const binary = makeTable('Binary outcome', 'column');
  binary.columns = [makeColumn('Responded', 'group'), makeColumn('Dose', 'group')];
  binary.rows = [[0, 1], [0, 2], [0, 3], [1, 4], [0, 5], [1, 6], [1, 7], [1, 8], [1, 9], [0, 3.5]];

  const ancova = makeTable('Two groups', 'xy');
  ancova.columns = [makeColumn('Baseline', 'x'), makeColumn('Vehicle', 'y'), makeColumn('Drug', 'y')];
  ancova.rows = [[1, 10, 20], [2, 12, 23], [3, 15, 25], [4, 16, 28], [5, 19, 30], [6, 21, 33]];

  const cox = makeTable('Survival with a covariate', 'survival');
  cox.columns = [makeColumn('Time', 'time'), makeColumn('Event', 'event'), makeColumn('Age', 'group')];
  cox.rows = [
    [5, 1, 60], [8, 1, 55], [12, 0, 70], [3, 1, 65], [15, 1, 50],
    [20, 0, 45], [7, 1, 72], [9, 0, 58], [11, 1, 63], [6, 1, 68],
  ];

  const multivariate = makeTable('Samples', 'column');
  multivariate.columns = [
    makeColumn('Sepal length'), makeColumn('Sepal width'),
    makeColumn('Petal length'), makeColumn('Petal width'), makeColumn('Species'),
  ];
  multivariate.rows = [
    [5.1, 3.5, 1.4, 0.2, 'setosa'], [4.9, 3.0, 1.4, 0.2, 'setosa'],
    [4.7, 3.2, 1.3, 0.2, 'setosa'], [4.6, 3.1, 1.5, 0.2, 'setosa'],
    [7.0, 3.2, 4.7, 1.4, 'versicolor'], [6.4, 3.2, 4.5, 1.5, 'versicolor'],
    [6.9, 3.1, 4.9, 1.5, 'versicolor'], [5.5, 2.3, 4.0, 1.3, 'versicolor'],
    [6.3, 3.3, 6.0, 2.5, 'virginica'], [5.8, 2.7, 5.1, 1.9, 'virginica'],
    [7.1, 3.0, 5.9, 2.1, 'virginica'], [6.3, 2.9, 5.6, 1.8, 'virginica'],
  ];

  const instruments = makeTable('Instruments', 'column');
  instruments.columns = [makeColumn('On exposure'), makeColumn('On outcome'), makeColumn('SE')];
  instruments.rows = [
    [0.10, 0.05, 0.02], [0.15, 0.08, 0.03], [0.08, 0.03, 0.015], [0.20, 0.11, 0.04],
    [0.12, 0.07, 0.02], [0.18, 0.09, 0.03], [0.09, 0.04, 0.02],
  ];

  const contaminated = makeTable('With outliers', 'column');
  contaminated.columns = [makeColumn('Replicate A'), makeColumn('Replicate B')];
  contaminated.rows = [
    [10.1, 9.9], [9.8, 10.2], [10.4, 10.0], [9.9, 9.7], [10.2, 10.3],
    [10.0, 10.1], [9.7, 9.8], [10.3, 10.4], [25, 10.0], [30, 9.95],
  ];

  return {
    logisticfit: binary, roc: binary, ancova, hazard: cox,
    pcascore: multivariate, scree: multivariate, dendrogram: multivariate,
    clusterheatmap: multivariate, plsscore: multivariate, anosimbox: multivariate,
    mrscatter: instruments, outliers: contaminated,
  };
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

const perPlot = tablesByPlot();

for (const kind of PLOT_KINDS) {
  test(`${kind.id} renders on a ${kind.shape} table`, () => {
    const table = perPlot[kind.id] ?? shapes[kind.shape];
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

test('a bottom legend does not sit on top of the x-axis label', () => {
  // With three or more series the legend moves below the plot. The axis label
  // lives down there too, so one of them has to give way.
  const table = demoProject().tables[0];
  const figure = {
    ...makeFigure('Three series', table.id, 'qq'),
    style: defaultStyle({ xLabel: 'Normal quantile', showLegend: true }),
  };
  const markup = renderToStaticMarkup(createElement(Plot, { table, figure }));

  const labelY = [...markup.matchAll(/<text[^>]*\by="([\d.]+)"[^>]*>Normal quantile</g)]
    .map((match) => Number(match[1]));
  const legendY = [...new Set(
    [...markup.matchAll(/translate\([\d.-]+ ([\d.]+)\)/g)].map((match) => Number(match[1]))
  )];

  assert.equal(labelY.length, 1, 'expected exactly one x-axis label');
  assert.ok(legendY.length > 0, 'expected a legend');
  assert.ok(
    Math.abs(labelY[0] - legendY[0]) > 12,
    `axis label at ${labelY[0]} and legend at ${legendY[0]} overlap`
  );
});
