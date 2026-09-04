// Builds the worked example projects in examples/.
//
//   npm run examples
//
// Each one is a real .asp project: open it from the toolbar and everything
// is already wired up. They double as end-to-end fixtures, since generating
// them exercises the document model and the file format.

import { writeFileSync, mkdirSync } from 'node:fs';
import {
  APP_VERSION, SCHEMA_VERSION,
  defaultStyle, makeAnalysis, makeColumn, makeFigure, makeLayout, newId, runAnalysis,
} from '../src/app/model.ts';
import { serializeProject } from '../src/app/io.ts';

const OUT = new URL('../examples/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const table = (name, shape, columns, rows) => ({
  id: newId('tbl'), name, shape, columns, rows,
});

const project = (name, tables, analyses, figures, layouts = []) => ({
  schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, name,
  tables, analyses, figures, layouts,
});

const built = [];

function write(fileName, doc, note) {
  // Every example must actually compute, or it is not an example of anything.
  for (const analysis of doc.analyses) {
    const source = doc.tables.find((entry) => entry.id === analysis.tableId);
    const result = runAnalysis(source, analysis);
    if (result.error) throw new Error(`${fileName}: "${analysis.name}" does not run — ${result.error}`);
  }
  writeFileSync(new URL(fileName, OUT), serializeProject(doc));
  built.push({ fileName, note });
}

// ---------------------------------------------------------------------------
// 1. Dose response
// ---------------------------------------------------------------------------
{
  const x = makeColumn('Concentration (nM)', 'x');
  const y = makeColumn('Response (%)', 'y');
  // A clean sigmoid with EC50 near 50 nM and a little noise.
  const doses = [0.5, 1.5, 5, 15, 50, 150, 500, 1500, 5000];
  const rows = doses.map((dose) => {
    const ideal = 5 + 95 / (1 + Math.pow(50 / dose, 1.1));
    const jitter = (Math.sin(dose * 7.7) * 2.4);
    return [dose, Number((ideal + jitter).toFixed(1))];
  });
  const data = table('Inhibitor titration', 'xy', [x, y], rows);
  const fit = { ...makeAnalysis('EC50 fit', data.id, 'doseresponse'), options: { logX: false } };
  const figure = {
    ...makeFigure('Dose response', data.id, 'scatter'),
    analysisId: fit.id,
    style: defaultStyle({
      title: 'Inhibitor dose response',
      xLabel: 'Concentration (nM)', yLabel: 'Response (%)',
      grid: 'none', pointSize: 5, logX: true,
    }),
  };
  write('dose-response.asp',
    project('Dose response', [data], [fit], [figure]),
    'A four-parameter logistic fit with the EC50 read off it.');
}

// ---------------------------------------------------------------------------
// 2. Three-group comparison with post-hoc
// ---------------------------------------------------------------------------
{
  const columns = [makeColumn('Vehicle'), makeColumn('Drug 1 µM'), makeColumn('Drug 10 µM')];
  const rows = [
    [92, 78, 61], [88, 74, 58], [95, 81, 66],
    [90, 76, 59], [87, 72, 63], [93, 79, 57],
  ];
  const data = table('Cell viability', 'column', columns, rows);
  const anova = { ...makeAnalysis('Viability by dose', data.id, 'anova'), options: { correction: 'tukey' } };
  const normality = makeAnalysis('Check normality', data.id, 'normality');
  const variance = makeAnalysis('Check equal variances', data.id, 'variance');

  const bar = {
    ...makeFigure('Viability', data.id, 'bar'),
    analysisId: anova.id,
    style: defaultStyle({ title: 'Viability falls with dose', yLabel: 'Viability (%)', grid: 'horizontal' }),
  };
  const spread = {
    ...makeFigure('Spread', data.id, 'box'),
    style: defaultStyle({ title: 'Distribution by group', yLabel: 'Viability (%)', grid: 'horizontal' }),
  };
  const qq = {
    ...makeFigure('Normality check', data.id, 'qq'),
    style: defaultStyle({ title: 'Q–Q plot', yLabel: 'Observed', xLabel: 'Normal quantile' }),
  };
  const layout = { ...makeLayout('Figure 1', [bar.id, spread.id, qq.id]), columns: 3 };

  write('cell-viability.asp',
    project('Cell viability', [data], [anova, normality, variance], [bar, spread, qq], [layout]),
    'One-way ANOVA with Tukey HSD, the assumption checks that belong with it, and a three-panel figure.');
}

// ---------------------------------------------------------------------------
// 3. Survival
// ---------------------------------------------------------------------------
{
  const columns = [
    makeColumn('Days', 'time'),
    makeColumn('Event', 'event'),
    makeColumn('Arm', 'group'),
  ];
  const arm = (times, events, label) => times.map((t, i) => [t, events[i], label]);
  const rows = [
    ...arm([12, 15, 18, 20, 22, 25, 28, 30, 33, 36], [1, 1, 1, 0, 1, 1, 0, 1, 1, 0], 'Vehicle'),
    ...arm([20, 26, 31, 35, 38, 42, 45, 48, 52, 60], [1, 0, 1, 1, 0, 1, 1, 0, 1, 0], 'Drug'),
  ];
  const data = table('Xenograft survival', 'survival', columns, rows);
  const analysis = makeAnalysis('Survival by arm', data.id, 'survival');
  const figure = {
    ...makeFigure('Survival curve', data.id, 'survival'),
    analysisId: analysis.id,
    style: defaultStyle({
      title: 'Treatment extends survival',
      xLabel: 'Days since implantation', yLabel: 'Fraction surviving',
      grid: 'horizontal',
    }),
  };
  write('survival.asp',
    project('Xenograft survival', [data], [analysis], [figure]),
    'Kaplan–Meier curves with censoring, compared by the log-rank test.');
}

// ---------------------------------------------------------------------------
// 4. Two factors
// ---------------------------------------------------------------------------
{
  const columns = [
    makeColumn('Sex', 'label'),
    makeColumn('Control'), makeColumn('Low dose'), makeColumn('High dose'),
  ];
  const rows = [
    ['Male', 12, 18, 25], ['Male', 14, 20, 27], ['Male', 13, 19, 26],
    ['Female', 10, 15, 19], ['Female', 11, 17, 21], ['Female', 12, 16, 20],
  ];
  const data = table('Sex by dose', 'grouped', columns, rows);
  const analysis = makeAnalysis('Two-way ANOVA', data.id, 'twoway');
  const figure = {
    ...makeFigure('Response by sex and dose', data.id, 'bar'),
    style: defaultStyle({ title: 'Response by dose', yLabel: 'Response (a.u.)', grid: 'horizontal' }),
  };
  write('two-factors.asp',
    project('Sex by dose', [data], [analysis], [figure]),
    'Two-way ANOVA with replication, from a table laid out the way it is recorded.');
}

// ---------------------------------------------------------------------------
// 5. Paired design
// ---------------------------------------------------------------------------
{
  const columns = [makeColumn('Before'), makeColumn('After')];
  const rows = [
    [5.1, 6.8], [4.7, 6.1], [5.9, 7.4], [6.2, 7.0], [4.4, 5.9],
    [5.5, 6.6], [6.0, 7.8], [5.2, 6.3],
  ];
  const data = table('Paired treatment', 'column', columns, rows);
  const paired = makeAnalysis('Before vs after', data.id, 'paired');
  const figure = {
    ...makeFigure('Change per subject', data.id, 'paired'),
    analysisId: paired.id,
    style: defaultStyle({
      title: 'Every subject improved', yLabel: 'Measurement',
      grid: 'horizontal', errorBars: 'none',
    }),
  };
  write('paired-design.asp',
    project('Paired treatment', [data], [paired], [figure]),
    'A paired t-test with each subject drawn as its own line.');
}

console.log(`Wrote ${built.length} example projects to examples/`);
for (const entry of built) console.log(`  ${entry.fileName.padEnd(30)} ${entry.note}`);
