import test from 'node:test';
import assert from 'node:assert/strict';

import { demoProject, makeColumn, type DataTable } from '../src/app/model.ts';
import { buildReport, digestTable, reportToHtml, reportToMarkdown } from '../src/app/report.ts';

const table = (rows: (number | string | null)[][]): DataTable => ({
  id: 't', name: 'Data', shape: 'column',
  columns: [makeColumn('A'), makeColumn('B')],
  rows,
});

test('a digest is stable across runs', async () => {
  const first = await digestTable(table([[1, 2], [3, 4]]));
  const second = await digestTable(table([[1, 2], [3, 4]]));
  assert.equal(first.sha256, second.sha256);
  assert.match(first.sha256, /^[0-9a-f]{64}$/);
});

test('a digest changes when any cell changes', async () => {
  const before = await digestTable(table([[1, 2], [3, 4]]));
  const after = await digestTable(table([[1, 2], [3, 5]]));
  assert.notEqual(before.sha256, after.sha256);
});

test('a digest notices a blank becoming a zero', async () => {
  // These analyse identically for some tests but are not the same data.
  const blank = await digestTable(table([[1, null], [3, 4]]));
  const zero = await digestTable(table([[1, 0], [3, 4]]));
  assert.notEqual(blank.sha256, zero.sha256);
});

test('a digest notices a renamed column', async () => {
  const original = table([[1, 2]]);
  const renamed = { ...original, columns: [{ ...original.columns[0], name: 'Treated' }, original.columns[1]] };
  assert.notEqual((await digestTable(original)).sha256, (await digestTable(renamed)).sha256);
});

test('a report names the data, the method and the columns used', async () => {
  const report = await buildReport(demoProject());
  assert.equal(report.tables.length, 1);
  assert.equal(report.analyses.length, 1);

  const analysis = report.analyses[0];
  assert.equal(analysis.table, 'Cell viability');
  assert.match(analysis.method, /ANOVA/);
  assert.deepEqual(analysis.columns, ['Vehicle', 'Drug 1 µM', 'Drug 10 µM']);
  assert.equal(analysis.comparisons.length, 3);
  assert.match(analysis.sentence, /one-way ANOVA/);
});

test('markdown carries the checksum and every comparison', async () => {
  const report = await buildReport(demoProject());
  const markdown = reportToMarkdown(report);
  assert.ok(markdown.includes(report.tables[0].sha256));
  assert.match(markdown, /## Data/);
  assert.match(markdown, /## Analyses/);
  assert.match(markdown, /Vehicle vs Drug 1 µM/);
  assert.match(markdown, /not validated for clinical or regulatory use/i);
});

test('html is self-contained and escapes its content', async () => {
  const project = demoProject();
  project.name = 'Tumour <script>alert(1)</script> study';
  const html = reportToHtml(await buildReport(project));
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes('<style>'), 'styles must be inline so the file stands alone');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'project names must be escaped');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('an analysis that cannot run is reported as such, not omitted', async () => {
  const project = demoProject();
  project.tables[0].rows = [[1, 1, 1]];
  const report = await buildReport(project);
  assert.ok(report.analyses[0].error, 'the failure must appear in the report');
  assert.match(reportToMarkdown(report), /did not run/);
});

test('a deleted table leaves an explained gap rather than a crash', async () => {
  const project = demoProject();
  const report = await buildReport({ ...project, tables: [] });
  assert.match(report.analyses[0].error ?? '', /deleted/);
});

test('a Notion page id is recovered from a pasted URL', async () => {
  const { normalisePageId } = await import('../src/app/notion.ts');
  const expected = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
  assert.equal(normalisePageId('1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'), expected);
  assert.equal(normalisePageId(expected), expected);
  assert.equal(
    normalisePageId('https://www.notion.so/Lab-notes-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d?pvs=4'),
    expected
  );
  assert.equal(normalisePageId('not a page'), null);
  assert.equal(normalisePageId(''), null);
});
