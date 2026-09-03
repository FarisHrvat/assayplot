// The AssayPlot document model.
//
// A project is a set of data tables, plus analyses and figures that are *bound*
// to a table by id. Nothing here touches the DOM: this module defines the
// document, the dependency edges between its nodes, and the pure functions that
// turn a specification plus a table into a result.

// @ts-ignore - the statistics core is still plain JS, ported incrementally.
import * as stats from '../core/stats.js';
// @ts-ignore
import * as posthoc from '../core/posthoc.js';
// @ts-ignore
import * as diagnostics from '../core/diagnostics.js';

export type Cell = number | string | null;

/** Role a column plays in an analysis. */
export type ColumnRole = 'group' | 'x' | 'y' | 'label' | 'time' | 'event' | 'ignore';

/**
 * Table shapes, following the way experiments are actually laid out rather than
 * a normalised long format. In `column` shape each column is one treatment
 * group and each row is a replicate — the layout a bench scientist already has
 * in their notebook.
 */
export type TableShape = 'column' | 'xy' | 'grouped' | 'survival';

/** What each shape means, shown in the shape picker. */
export const SHAPE_INFO: Record<TableShape, { label: string; help: string }> = {
  column: {
    label: 'Column — each column is a group',
    help: 'One column per treatment, one row per replicate. The usual layout for comparing groups.',
  },
  grouped: {
    label: 'Grouped — two factors',
    help: 'First column names the row factor (repeat a label for replicates); the remaining columns are the levels of the second factor.',
  },
  xy: {
    label: 'XY — first column is X',
    help: 'Paired measurements for correlation, regression, and dose–response.',
  },
  survival: {
    label: 'Survival — time, event, group',
    help: 'One row per subject: time to event or last follow-up, 1 if the event happened and 0 if censored, and which group they were in.',
  },
};

export interface Column {
  id: string;
  name: string;
  role: ColumnRole;
}

export interface DataTable {
  id: string;
  name: string;
  shape: TableShape;
  columns: Column[];
  /** Row-major. Ragged rows are padded with null on read. */
  rows: Cell[][];
}

export type Method =
  | 'descriptive'
  | 'onesample'
  | 'welch'
  | 'student'
  | 'paired'
  | 'mannwhitney'
  | 'wilcoxon'
  | 'anova'
  | 'kruskal'
  | 'friedman'
  | 'correlation'
  | 'spearman'
  | 'regression'
  | 'doseresponse'
  | 'chisq'
  | 'fisher'
  | 'twoway'
  | 'survival'
  | 'normality'
  | 'variance'
  | 'outlier';

export type Correction = 'none' | 'holm' | 'bh' | 'tukey' | 'dunn' | 'control';

export interface AnalysisOptions {
  /** Column ids to compare. Two for a t-test, any number for ANOVA. */
  columnIds?: string[];
  /** Multiplicity correction applied to post-hoc comparisons. */
  correction?: Correction;
  /** Column index treated as the control for "versus control" comparisons. */
  controlIndex?: number;
  /** Value the sample mean is tested against in a one-sample t-test. */
  hypothesised?: number;
  /** Treat the X column as log10 concentration in a dose-response fit. */
  logX?: boolean;
}

export interface Analysis {
  id: string;
  name: string;
  tableId: string;
  method: Method;
  options: AnalysisOptions;
}

export type PlotType =
  | 'bar' | 'dot' | 'box' | 'violin' | 'strip' | 'swarm' | 'pointrange'
  | 'lollipop' | 'paired'
  | 'histogram' | 'density' | 'ecdf' | 'qq'
  | 'scatter' | 'line' | 'area' | 'step' | 'bubble'
  | 'heatmap' | 'correlation'
  | 'pie' | 'donut'
  | 'survival';

export type ErrorBarKind = 'none' | 'sd' | 'sem' | 'ci95' | 'range';
export type GridKind = 'none' | 'horizontal' | 'vertical' | 'both';

export interface FigureStyle {
  title: string;
  xLabel: string;
  yLabel: string;
  palette: string;
  /** Per-series colour overrides, keyed by column id. Set by clicking a mark. */
  seriesColors: Record<string, string>;
  errorBars: ErrorBarKind;
  showPoints: boolean;
  showSignificance: boolean;
  showLegend: boolean;
  grid: GridKind;
  frame: boolean;
  yMin: number | null;
  yMax: number | null;
  xMin: number | null;
  xMax: number | null;
  logY: boolean;
  logX: boolean;
  width: number;
  height: number;
  pointSize: number;
  fontSize: number;
  barWidth: number;
  /** Histogram / density resolution. */
  bins: number;
}

export interface Figure {
  id: string;
  name: string;
  tableId: string;
  /** Optional: when set, significance brackets are drawn from this result. */
  analysisId: string | null;
  plotType: PlotType;
  style: FigureStyle;
}

/** How panels are lettered in a multi-panel figure. */
export type PanelLabelStyle = 'A' | 'a' | '1' | 'none';

export interface Layout {
  id: string;
  name: string;
  /** Figure ids, in reading order. A missing figure is skipped on render. */
  panels: string[];
  columns: number;
  labelStyle: PanelLabelStyle;
  /** Gap between panels, in the same units as figure width. */
  gap: number;
}

export interface Project {
  schemaVersion: number;
  appVersion: string;
  name: string;
  tables: DataTable[];
  analyses: Analysis[];
  figures: Figure[];
  layouts: Layout[];
}

export const SCHEMA_VERSION = 5;
export const APP_VERSION = '0.3.1';

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function columnIndex(table: DataTable, columnId: string): number {
  return table.columns.findIndex((column) => column.id === columnId);
}

/** A cell as a number, or null when it is blank or non-numeric. */
export function numericCell(cell: Cell): number | null {
  if (cell === null || cell === undefined || cell === '') return null;
  const value = typeof cell === 'number' ? cell : Number(cell);
  return Number.isFinite(value) ? value : null;
}

/** Numeric values in one column, with blanks and non-numeric entries dropped. */
export function columnValues(table: DataTable, columnId: string): number[] {
  const index = columnIndex(table, columnId);
  if (index < 0) return [];
  const values: number[] = [];
  for (const row of table.rows) {
    const value = numericCell(row[index]);
    if (value !== null) values.push(value);
  }
  return values;
}

/** Columns eligible to carry measurements, in table order. */
export function valueColumns(table: DataTable): Column[] {
  if (table.shape === 'xy') {
    return table.columns.filter((column) => column.role === 'y');
  }
  if (table.shape === 'survival') return [];
  return table.columns.filter(
    (column) => !['ignore', 'label', 'time', 'event'].includes(column.role)
  );
}

/** The column naming the row factor in a Grouped table. */
export function labelColumn(table: DataTable): Column | null {
  return table.columns.find((column) => column.role === 'label') ?? null;
}

export function roleColumn(table: DataTable, role: ColumnRole): Column | null {
  return table.columns.find((column) => column.role === role) ?? null;
}

/** One row per subject for a survival table, dropping incomplete rows. */
export function survivalRows(table: DataTable): { time: number; event: number; group: string }[] {
  const time = roleColumn(table, 'time');
  const event = roleColumn(table, 'event');
  const group = roleColumn(table, 'group');
  if (!time || !event) return [];
  const timeIndex = columnIndex(table, time.id);
  const eventIndex = columnIndex(table, event.id);
  const groupIndex = group ? columnIndex(table, group.id) : -1;

  const out: { time: number; event: number; group: string }[] = [];
  for (const row of table.rows) {
    const t = numericCell(row[timeIndex]);
    const rawEvent = row[eventIndex];
    if (t === null || t < 0) continue;
    const e = numericCell(rawEvent);
    const flag = e !== null
      ? (e === 1 ? 1 : e === 0 ? 0 : null)
      : ['event', 'died', 'yes', 'true', '1'].includes(String(rawEvent ?? '').toLowerCase()) ? 1
      : ['censored', 'alive', 'no', 'false', '0'].includes(String(rawEvent ?? '').toLowerCase()) ? 0
      : null;
    if (flag === null) continue;
    const label = groupIndex >= 0 ? String(row[groupIndex] ?? '').trim() : '';
    out.push({ time: t, event: flag, group: label || 'All subjects' });
  }
  return out;
}

/** Long-format rows for a Grouped table: row-factor label, column name, value. */
export function groupedRows(table: DataTable): { factorA: string; factorB: string; value: number }[] {
  const label = labelColumn(table);
  if (!label) return [];
  const labelIndex = columnIndex(table, label.id);
  const out: { factorA: string; factorB: string; value: number }[] = [];
  for (const row of table.rows) {
    const level = String(row[labelIndex] ?? '').trim();
    if (!level) continue;
    for (const column of valueColumns(table)) {
      const value = numericCell(row[columnIndex(table, column.id)]);
      if (value !== null) out.push({ factorA: level, factorB: column.name, value });
    }
  }
  return out;
}

export function xColumn(table: DataTable): Column | null {
  return table.columns.find((column) => column.role === 'x') ?? null;
}

/** Paired (x, y) points, keeping only rows where both entries are numeric. */
export function xyPairs(table: DataTable, yColumnId: string): { x: number[]; y: number[] } {
  const x = xColumn(table);
  const xIndex = x ? columnIndex(table, x.id) : -1;
  const yIndex = columnIndex(table, yColumnId);
  const xs: number[] = [];
  const ys: number[] = [];
  if (xIndex < 0 || yIndex < 0) return { x: xs, y: ys };
  // Number(null) and Number('') are both 0, so blanks must be rejected before
  // the numeric conversion or empty rows silently become (0, 0) observations.
  for (const row of table.rows) {
    const xv = numericCell(row[xIndex]);
    const yv = numericCell(row[yIndex]);
    if (xv !== null && yv !== null) {
      xs.push(xv);
      ys.push(yv);
    }
  }
  return { x: xs, y: ys };
}

/** Rows where every selected column has a value, for matched-subject designs. */
export function completeRows(table: DataTable, columnIds: string[]): number[][] {
  const indices = columnIds.map((id) => columnIndex(table, id));
  const out: number[][] = [];
  for (const row of table.rows) {
    const values = indices.map((index) => numericCell(row[index]));
    if (values.every((value) => value !== null)) out.push(values as number[]);
  }
  return out;
}

export type MethodFamily =
  | 'Describe' | 'One sample' | 'Two groups' | 'Three or more groups'
  | 'X versus Y' | 'Two factors' | 'Survival' | 'Categorical counts'
  | 'Assumptions and screening';

export interface MethodInfo {
  id: Method;
  label: string;
  family: MethodFamily;
  /** Plain-language statement of what the method assumes. */
  assumes: string;
  minGroups: number;
  maxGroups: number;
  /** Table shapes this method can run on. */
  shapes: TableShape[];
}

export const METHODS: MethodInfo[] = [
  { id: 'descriptive', label: 'Descriptive statistics', family: 'Describe', assumes: 'Nothing beyond numeric values.', minGroups: 1, maxGroups: Infinity, shapes: ['column', 'grouped', 'xy'] },

  { id: 'onesample', label: 'One-sample t-test', family: 'One sample', assumes: 'One group of roughly normal values, compared against a fixed number you choose.', minGroups: 1, maxGroups: 1, shapes: ['column'] },

  { id: 'welch', label: 'Welch t-test (unequal variance)', family: 'Two groups', assumes: 'Two independent groups. Roughly normal, but variances may differ.', minGroups: 2, maxGroups: 2, shapes: ['column'] },
  { id: 'student', label: "Student's t-test (equal variance)", family: 'Two groups', assumes: 'Two independent groups, roughly normal, with similar variances.', minGroups: 2, maxGroups: 2, shapes: ['column'] },
  { id: 'paired', label: 'Paired t-test', family: 'Two groups', assumes: 'Two measurements on the same subjects, in matching row order.', minGroups: 2, maxGroups: 2, shapes: ['column'] },
  { id: 'mannwhitney', label: 'Mann–Whitney U', family: 'Two groups', assumes: 'Two independent groups. No distributional assumption; compares ranks.', minGroups: 2, maxGroups: 2, shapes: ['column'] },
  { id: 'wilcoxon', label: 'Wilcoxon signed-rank', family: 'Two groups', assumes: 'Two paired measurements, in matching row order. Compares ranks.', minGroups: 2, maxGroups: 2, shapes: ['column'] },

  { id: 'anova', label: 'One-way ANOVA', family: 'Three or more groups', assumes: 'Three or more independent groups, roughly normal, similar variances.', minGroups: 3, maxGroups: Infinity, shapes: ['column'] },
  { id: 'kruskal', label: 'Kruskal–Wallis', family: 'Three or more groups', assumes: 'Three or more independent groups. Rank-based, no normality assumed.', minGroups: 3, maxGroups: Infinity, shapes: ['column'] },
  { id: 'friedman', label: 'Friedman (repeated measures)', family: 'Three or more groups', assumes: 'Three or more measurements on the same subjects. Each row is one subject.', minGroups: 3, maxGroups: Infinity, shapes: ['column'] },

  { id: 'correlation', label: 'Pearson correlation', family: 'X versus Y', assumes: 'Paired X and Y measurements with a roughly linear relationship.', minGroups: 1, maxGroups: Infinity, shapes: ['xy'] },
  { id: 'spearman', label: 'Spearman rank correlation', family: 'X versus Y', assumes: 'Paired X and Y. Monotone rather than linear association.', minGroups: 1, maxGroups: Infinity, shapes: ['xy'] },
  { id: 'regression', label: 'Simple linear regression', family: 'X versus Y', assumes: 'Y depends linearly on X, with roughly constant scatter.', minGroups: 1, maxGroups: Infinity, shapes: ['xy'] },
  { id: 'doseresponse', label: 'Dose–response curve (EC50 / IC50)', family: 'X versus Y', assumes: 'A sigmoid response to dose. X is concentration; tick “X is already log” if it is.', minGroups: 1, maxGroups: Infinity, shapes: ['xy'] },

  { id: 'chisq', label: 'Chi-square test of counts', family: 'Categorical counts', assumes: 'Each cell is a count of independent observations, not a measurement.', minGroups: 2, maxGroups: Infinity, shapes: ['column'] },
  { id: 'fisher', label: "Fisher's exact test (2 × 2)", family: 'Categorical counts', assumes: 'A 2 × 2 table of counts. Exact, so it is safe with small numbers.', minGroups: 2, maxGroups: 2, shapes: ['column'] },

  { id: 'twoway', label: 'Two-way ANOVA', family: 'Two factors', assumes: 'Two crossed factors with the same number of observations in every combination. Repeat a row label for replicates.', minGroups: 2, maxGroups: Infinity, shapes: ['grouped'] },

  { id: 'survival', label: 'Kaplan–Meier survival', family: 'Survival', assumes: 'One row per subject: a time, whether the event happened, and a group. Censored subjects are those still event-free at last follow-up.', minGroups: 1, maxGroups: Infinity, shapes: ['survival'] },

  { id: 'normality', label: 'Normality (Shapiro–Wilk)', family: 'Assumptions and screening', assumes: 'Checks each column against a normal distribution.', minGroups: 1, maxGroups: Infinity, shapes: ['column'] },
  { id: 'variance', label: 'Equal variances (Levene, Bartlett)', family: 'Assumptions and screening', assumes: 'Checks whether the groups have comparable spread.', minGroups: 2, maxGroups: Infinity, shapes: ['column'] },
  { id: 'outlier', label: "Outlier screening (Grubbs')", family: 'Assumptions and screening', assumes: 'Finds the single most extreme value in a roughly normal column.', minGroups: 1, maxGroups: Infinity, shapes: ['column'] },
];

export const METHOD_FAMILIES: MethodFamily[] = [
  'Describe', 'One sample', 'Two groups', 'Three or more groups',
  'Two factors', 'X versus Y', 'Survival', 'Categorical counts',
  'Assumptions and screening',
];

export function methodInfo(method: Method): MethodInfo {
  return METHODS.find((entry) => entry.id === method) ?? METHODS[0];
}

/**
 * Methods this table can support, each with a reason when it cannot.
 * The app offers and explains; it never silently picks a test.
 */
export function availableMethods(table: DataTable): { info: MethodInfo; usable: boolean; why: string }[] {
  const groups = valueColumns(table).length;
  return METHODS.map((info) => {
    if (!info.shapes.includes(table.shape)) {
      const wanted = info.shapes.map((shape) => SHAPE_INFO[shape].label.split(' —')[0]).join(' or ');
      return { info, usable: false, why: `Needs a ${wanted} table. This one is ${SHAPE_INFO[table.shape].label.split(' —')[0]}.` };
    }
    if (table.shape === 'survival' || table.shape === 'grouped') {
      return { info, usable: true, why: info.assumes };
    }
    if (groups < info.minGroups) {
      return { info, usable: false, why: `Needs at least ${info.minGroups} data column${info.minGroups === 1 ? '' : 's'}; this table has ${groups}.` };
    }
    if (groups > info.maxGroups) {
      return { info, usable: false, why: `Uses exactly ${info.maxGroups} column${info.maxGroups === 1 ? '' : 's'}. Choose which below.` };
    }
    return { info, usable: true, why: info.assumes };
  });
}

export interface Comparison {
  labelA: string;
  labelB: string;
  indexA: number;
  indexB: number;
  pValue: number;
  pAdjusted: number;
  difference?: number;
  confidenceInterval95?: [number, number];
}

export interface ResultTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface AnalysisResult {
  method: string;
  /** Headline figures shown in the results panel, in display order. */
  summary: { label: string; value: string; note?: string }[];
  /** Full result object from the statistics core, for the details view. */
  raw: Record<string, unknown>;
  pValue: number | null;
  comparisons: Comparison[];
  /** Extra tabular output, such as per-column normality tests. */
  tables: ResultTable[];
  /** Fitted curve for overlay on a figure, as [x, y] pairs. */
  fittedCurve?: { x: number; y: number }[];
  warnings: string[];
  error: string | null;
}

function formatNumber(value: unknown, digits = 4): string {
  if (typeof value === 'number' && value === Infinity) return '∞';
  if (typeof value === 'number' && value === -Infinity) return '−∞';
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 1e-4) return value.toExponential(2);
  const rounded = Number(value.toFixed(digits));
  return String(rounded);
}

export function formatP(p: unknown): string {
  if (typeof p !== 'number' || !Number.isFinite(p)) return '—';
  if (p < 0.0001) return '< 0.0001';
  return p.toFixed(4);
}

export function significanceStars(p: number): string {
  if (!Number.isFinite(p)) return '';
  if (p < 0.0001) return '****';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
}

/** Columns an analysis actually operates on, after applying its options. */
export function analysisColumns(table: DataTable, analysis: Analysis): Column[] {
  const candidates = valueColumns(table);
  const chosen = analysis.options.columnIds;
  if (!chosen || chosen.length === 0) return candidates;
  const picked = chosen
    .map((id) => candidates.find((column) => column.id === id))
    .filter((column): column is Column => Boolean(column));
  return picked.length ? picked : candidates;
}

const EMPTY: AnalysisResult = {
  method: '', summary: [], raw: {}, pValue: null,
  comparisons: [], tables: [], warnings: [], error: null,
};

function adjuster(correction: Correction) {
  if (correction === 'holm') return (p: number[]) => stats.holmAdjust(p);
  if (correction === 'bh') return (p: number[]) => stats.benjaminiHochberg(p);
  return (p: number[]) => p;
}

function isTwoGroupTest(method: Method): boolean {
  return ['welch', 'student', 'paired', 'mannwhitney', 'wilcoxon'].includes(method);
}

/**
 * Largest magnitude a value may have before sums of squares overflow.
 *
 * A double tops out near 1.8e308, so squaring anything past about 1e154 gives
 * Infinity and every statistic built on it becomes NaN. Values this large are
 * real - a broken instrument export, a spreadsheet with a stray exponent - and
 * the app has to say so rather than print a dash.
 */
const MAX_SAFE_MAGNITUDE = 1e150;

function overflowRisk(values: number[]): number | null {
  for (const value of values) {
    if (Math.abs(value) > MAX_SAFE_MAGNITUDE) return value;
  }
  return null;
}

/**
 * Runs an analysis and enforces the invariants the rest of the app relies on:
 * a p-value is a probability or absent, and a result never presents a NaN as a
 * finding. Anything that slips through the individual guards is converted into
 * an explanation here rather than reaching the screen.
 */
export function runAnalysis(table: DataTable, analysis: Analysis): AnalysisResult {
  const result = computeAnalysis(table, analysis);
  if (result.error) return result;

  const pValueIsBroken = result.pValue !== null && !Number.isFinite(result.pValue);
  const comparisonIsBroken = result.comparisons.some(
    (comparison) => !Number.isFinite(comparison.pValue) || !Number.isFinite(comparison.pAdjusted)
  );
  if (!pValueIsBroken && !comparisonIsBroken) return result;

  // Almost always overflow from an extreme value; say so if we can point at one.
  const extreme = overflowRisk(
    analysisColumns(table, analysis).flatMap((column) => columnValues(table, column.id))
  );
  return {
    ...result,
    pValue: null,
    comparisons: [],
    summary: [],
    error: extreme !== null
      ? `A value of ${extreme.toExponential(2)} is too large for this calculation — squaring it exceeds what a computer can represent, so the result would be meaningless. Check the units, or rescale the column.`
      : 'This calculation did not produce a usable number for these data. Check for extreme values, or for a column where every value is identical.',
  };
}

function computeAnalysis(table: DataTable, analysis: Analysis): AnalysisResult {
  const base: AnalysisResult = { ...EMPTY, method: methodInfo(analysis.method).label };

  try {
    const columns = analysisColumns(table, analysis);
    const method = analysis.method;
    const labels = columns.map((column) => column.name);
    if (method === 'descriptive') {
      const rows = columns.map((column) => ({
        column,
        stat: stats.descriptiveSummary(columnValues(table, column.id)),
      }));
      return {
        ...base,
        raw: { columns: rows.map((entry) => ({ name: entry.column.name, ...entry.stat })) },
        summary: rows.slice(0, 6).map((entry) => ({
          label: entry.column.name,
          value: `${formatNumber(entry.stat.mean)} ± ${formatNumber(entry.stat.sd)}`,
          note: `n = ${entry.stat.n}`,
        })),
        tables: [{
          title: 'Per column',
          columns: ['Column', 'n', 'Mean', 'SD', 'SEM', 'Median', 'Min', 'Max', '95% CI'],
          rows: rows.map((entry) => [
            entry.column.name, entry.stat.n,
            formatNumber(entry.stat.mean), formatNumber(entry.stat.sd), formatNumber(entry.stat.sem),
            formatNumber(entry.stat.median), formatNumber(entry.stat.min), formatNumber(entry.stat.max),
            `${formatNumber(entry.stat.confidenceInterval95?.[0])} to ${formatNumber(entry.stat.confidenceInterval95?.[1])}`,
          ]),
        }],
      };
    }
    if (method === 'onesample') {
      const target = columns[0];
      if (!target) return { ...base, error: 'Choose a column to test.' };
      const hypothesised = analysis.options.hypothesised ?? 0;
      const raw: any = diagnostics.oneSampleTTest(columnValues(table, target.id), hypothesised);
      return {
        ...base,
        raw,
        pValue: raw.pValue,
        summary: [
          { label: 'Mean', value: formatNumber(raw.mean), note: `tested against ${hypothesised}` },
          { label: 'Difference', value: formatNumber(raw.difference) },
          { label: '95% CI', value: `${formatNumber(raw.confidenceInterval95[0])} to ${formatNumber(raw.confidenceInterval95[1])}` },
          { label: 'P value', value: formatP(raw.pValue), note: `t = ${formatNumber(raw.t, 3)}, df = ${raw.df}` },
        ],
      };
    }
    if (method === 'normality') {
      const rows = columns.map((column) => {
        const values = columnValues(table, column.id);
        if (values.length < 3) {
          return [column.name, values.length, '—', '—', 'needs at least three values'];
        }
        if (values.length > 5000) {
          return [column.name, values.length, '—', '—', 'defined for at most 5000 values'];
        }
        const result: any = diagnostics.shapiroWilk(values);
        return [column.name, result.n, formatNumber(result.statistic), formatP(result.pValue),
          result.pValue < 0.05 ? 'departs from normal' : 'no detectable departure'];
      });
      const anySmall = columns.some((column) => columnValues(table, column.id).length < 20);
      return {
        ...base,
        raw: { columns: rows },
        tables: [{ title: 'Shapiro–Wilk per column', columns: ['Column', 'n', 'W', 'P value', 'Reading'], rows }],
        warnings: anySmall
          ? ['With fewer than about 20 values a normality test has very little power. A non-significant result is not evidence that the data are normal — look at a Q–Q plot as well.']
          : [],
      };
    }

    if (method === 'variance') {
      const groups = columns.map((column) => columnValues(table, column.id));
      if (groups.filter((values) => values.length > 1).length < 2) {
        return { ...base, error: 'Needs at least two columns with two or more values each.' };
      }
      const levene: any = diagnostics.leveneTest(groups);
      const bartlett: any = diagnostics.bartlettTest(groups);
      return {
        ...base,
        raw: { levene, bartlett },
        pValue: levene.pValue,
        summary: [
          { label: 'Levene P', value: formatP(levene.pValue), note: `F = ${formatNumber(levene.statistic, 3)}` },
          { label: 'Bartlett P', value: formatP(bartlett.pValue), note: `χ² = ${formatNumber(bartlett.statistic, 3)}` },
        ],
        tables: [{
          title: 'Spread by column',
          columns: ['Column', 'n', 'SD', 'Variance'],
          rows: columns.map((column, index) => [
            column.name, groups[index].length,
            formatNumber(Math.sqrt(stats.variance(groups[index]))),
            formatNumber(stats.variance(groups[index])),
          ]),
        }],
        warnings: levene.pValue < 0.05
          ? ['The variances differ. Prefer Welch’s t-test over Student’s, and read an equal-variance ANOVA with caution.']
          : [],
      };
    }

    if (method === 'outlier') {
      const rows = columns.map((column) => {
        const values = columnValues(table, column.id);
        if (values.length < 3) {
          return [column.name, values.length, '—', '—', '—', 'needs at least three values'];
        }
        if (new Set(values).size === 1) {
          return [column.name, values.length, '—', '—', '—', 'every value is identical'];
        }
        const result: any = diagnostics.grubbsTest(values);
        return [column.name, values.length, formatNumber(result.value), formatNumber(result.statistic, 3),
          formatP(result.pValue), result.isOutlier ? 'flagged' : '—'];
      });
      return {
        ...base,
        raw: { columns: rows },
        tables: [{ title: "Grubbs' test per column", columns: ['Column', 'n', 'Most extreme', 'G', 'P value', 'Verdict'], rows }],
        warnings: ['Removing a value because a test flagged it changes the meaning of every p-value you compute afterwards. If you exclude it, say so in the paper and give the reason.'],
      };
    }
    if (method === 'twoway') {
      const rows = groupedRows(table);
      if (rows.length < 4) {
        return {
          ...base,
          error: `Needs a row-factor label in the first column and numbers in the others; only ${rows.length} usable observation(s) were found.`,
        };
      }
      const raw: any = stats.twoWayAnova(rows);
      const rowFactor = labelColumn(table)?.name ?? 'Row factor';
      return {
        ...base,
        raw,
        pValue: raw.pInteraction,
        summary: [
          { label: rowFactor, value: formatP(raw.pA), note: `F(${raw.dfA}, ${raw.dfError}) = ${formatNumber(raw.fA, 3)}` },
          { label: 'Columns', value: formatP(raw.pB), note: `F(${raw.dfB}, ${raw.dfError}) = ${formatNumber(raw.fB, 3)}` },
          { label: 'Interaction', value: formatP(raw.pInteraction), note: `F(${raw.dfInteraction}, ${raw.dfError}) = ${formatNumber(raw.fInteraction, 3)}` },
        ],
        tables: [{
          title: 'Analysis of variance',
          columns: ['Source', 'Sum of squares', 'df', 'F', 'P value'],
          rows: [
            [rowFactor, formatNumber(raw.sumSquaresA), raw.dfA, formatNumber(raw.fA, 3), formatP(raw.pA)],
            ['Columns', formatNumber(raw.sumSquaresB), raw.dfB, formatNumber(raw.fB, 3), formatP(raw.pB)],
            ['Interaction', formatNumber(raw.sumSquaresInteraction), raw.dfInteraction, formatNumber(raw.fInteraction, 3), formatP(raw.pInteraction)],
            ['Residual', formatNumber(raw.sumSquaresError), raw.dfError, '—', '—'],
          ],
        }],
        warnings: raw.pInteraction < 0.05
          ? ['The interaction is significant, so the two main effects are hard to interpret on their own: the effect of one factor depends on the level of the other.']
          : [],
      };
    }
    if (method === 'survival') {
      const subjects = survivalRows(table);
      if (subjects.length < 2) {
        return {
          ...base,
          error: `Needs at least two rows with a non-negative time and a 0/1 event indicator; this table has ${subjects.length}. Censored subjects are 0, subjects that had the event are 1.`,
        };
      }
      if (!subjects.some((subject) => subject.event === 1)) {
        return {
          ...base,
          error: 'No subject had the event, so there is no survival curve to estimate. The event column marks 1 for the event and 0 for censored.',
        };
      }
      const groupNames = [...new Set(subjects.map((subject) => subject.group))];
      const curves = groupNames.map((name) => {
        const inGroup = subjects.filter((subject) => subject.group === name);
        const estimate: any = stats.kaplanMeier(
          inGroup.map((subject) => subject.time),
          inGroup.map((subject) => subject.event)
        );
        return { name, ...estimate };
      });

      let logRank: any = null;
      if (groupNames.length === 2) {
        const [first, second] = groupNames.map((name) => subjects.filter((subject) => subject.group === name));
        logRank = stats.logRankTest(
          first.map((subject) => subject.time), first.map((subject) => subject.event),
          second.map((subject) => subject.time), second.map((subject) => subject.event)
        );
      }

      const summary: AnalysisResult['summary'] = curves.slice(0, 4).map((curve) => ({
        label: curve.name,
        value: Number.isFinite(curve.median) ? formatNumber(curve.median) : 'not reached',
        note: `${curve.events} of ${curve.n} had the event`,
      }));
      if (logRank) {
        summary.push({
          label: 'Log-rank P',
          value: formatP(logRank.pValue),
          note: `χ² = ${formatNumber(logRank.statistic ?? logRank.chiSquare, 3)}, df = 1`,
        });
      }

      return {
        ...base,
        raw: { curves, logRank },
        pValue: logRank?.pValue ?? null,
        summary,
        tables: [{
          title: 'Median survival',
          columns: ['Group', 'n', 'Events', 'Censored', 'Median'],
          rows: curves.map((curve) => [
            curve.name, curve.n, curve.events, curve.censored,
            Number.isFinite(curve.median) ? formatNumber(curve.median) : 'not reached',
          ]),
        }],
        warnings: groupNames.length > 2
          ? ['The log-rank test here compares exactly two groups. With more than two, compare them pairwise and correct for multiplicity.']
          : [],
      };
    }
    if (method === 'chisq' || method === 'fisher') {
      const counts = table.rows
        .map((row) => columns.map((column) => numericCell(row[columnIndex(table, column.id)])))
        .filter((row) => row.every((value) => value !== null && value >= 0)) as number[][];
      if (counts.length < 2) return { ...base, error: 'Needs at least two rows of non-negative counts.' };

      if (method === 'fisher') {
        if (counts.length !== 2 || columns.length !== 2) {
          return { ...base, error: `Fisher's exact test needs exactly a 2 × 2 table; this is ${counts.length} × ${columns.length}.` };
        }
        const raw: any = stats.fisherExactTest(counts);
        return {
          ...base,
          raw,
          pValue: raw.pValue,
          summary: [
            { label: 'P value', value: formatP(raw.pValue), note: 'two-sided, exact' },
            { label: 'Odds ratio', value: formatNumber(raw.oddsRatioSample), note: 'cross-product, as Prism reports' },
            { label: 'Odds ratio (cMLE)', value: formatNumber(raw.oddsRatioConditional), note: 'conditional MLE, as R reports' },
          ],
        };
      }

      // A zero row or column total makes an expected count zero, and the
      // statistic divides by it.
      const rowTotals = counts.map((row) => row.reduce((sum, value) => sum + value, 0));
      const columnTotals = counts[0].map((_, index) => counts.reduce((sum, row) => sum + row[index], 0));
      const emptyRow = rowTotals.indexOf(0);
      const emptyColumn = columnTotals.indexOf(0);
      if (emptyRow >= 0) {
        return { ...base, error: `Row ${emptyRow + 1} totals zero. A chi-square test cannot use a category in which nothing was observed — remove the row, or pool it with another.` };
      }
      if (emptyColumn >= 0) {
        return { ...base, error: `Column "${labels[emptyColumn]}" totals zero. A chi-square test cannot use a category in which nothing was observed — remove the column, or pool it with another.` };
      }

      const raw: any = stats.chiSquareTest(counts, { yates: counts.length === 2 && columns.length === 2 });
      const warnings: string[] = [];
      if (raw.minimumExpected < 5) {
        warnings.push(`The smallest expected count is ${formatNumber(raw.minimumExpected, 2)}. Below about 5 the chi-square approximation is unreliable — use Fisher's exact test instead.`);
      }
      return {
        ...base,
        raw,
        pValue: raw.pValue,
        summary: [
          { label: 'χ²', value: formatNumber(raw.statistic), note: `df = ${raw.df}` },
          { label: 'P value', value: formatP(raw.pValue), note: raw.yatesApplied ? 'Yates corrected' : 'uncorrected' },
          { label: 'n', value: String(raw.n) },
        ],
        tables: [{
          title: 'Expected counts under independence',
          columns: ['Row', ...labels],
          rows: raw.expected.map((row: number[], index: number) => [`Row ${index + 1}`, ...row.map((value) => formatNumber(value, 2))]),
        }],
        warnings,
      };
    }
    if (method === 'correlation' || method === 'spearman' || method === 'regression' || method === 'doseresponse') {
      const target = columns[0];
      if (!target) return { ...base, error: 'Choose a Y column to model.' };
      const { x, y } = xyPairs(table, target.id);
      if (x.length < 3) {
        return {
          ...base,
          error: `Needs at least three rows with a number in both X and "${target.name}"; this table has ${x.length}.`,
        };
      }

      if (method === 'regression') {
        const raw: any = stats.linearRegression(x, y);
        const low = Math.min(...x);
        const high = Math.max(...x);
        return {
          ...base,
          raw,
          pValue: raw.pValue ?? null,
          fittedCurve: Array.from({ length: 60 }, (_, i) => {
            const at = low + ((high - low) * i) / 59;
            return { x: at, y: raw.intercept + raw.slope * at };
          }),
          summary: [
            { label: 'Slope', value: formatNumber(raw.slope), note: `95% CI ${formatNumber(raw.slopeConfidenceInterval95?.[0])} to ${formatNumber(raw.slopeConfidenceInterval95?.[1])}` },
            { label: 'Intercept', value: formatNumber(raw.intercept) },
            { label: 'R²', value: formatNumber(raw.r2) },
            { label: 'n', value: String(raw.n) },
          ],
        };
      }

      if (method === 'doseresponse') {
        // The fitter works in linear concentration units. If the user's X
        // column already holds log10(concentration), it is un-logged for the
        // fit and the fitted curve is put back into log units for the plot,
        // so the overlay lines up with the points either way.
        const logX = analysis.options.logX ?? false;
        const pairs = x
          .map((value, index) => ({
            concentration: logX ? Math.pow(10, value) : value,
            plotX: value,
            y: y[index],
          }))
          .filter((pair) => Number.isFinite(pair.concentration) && pair.concentration > 0);

        if (pairs.length < 4) {
          return {
            ...base,
            error: logX
              ? 'A four-parameter fit needs at least four points.'
              : 'A four-parameter fit needs at least four points at concentrations above zero. A zero-dose control cannot be placed on a log axis — either drop it or use a very small nominal concentration.',
          };
        }

        const raw: any = stats.fitFourParameterLogistic(
          pairs.map((pair) => pair.concentration),
          pairs.map((pair) => pair.y)
        );

        // Sampled geometrically, because a dose-response curve is read on a
        // log axis and even spacing would leave the low end unresolved.
        const low = Math.min(...pairs.map((pair) => pair.concentration));
        const high = Math.max(...pairs.map((pair) => pair.concentration));
        const fittedCurve = Array.from({ length: 160 }, (_, i) => {
          const concentration = low * Math.pow(high / low, i / 159);
          return {
            x: logX ? Math.log10(concentration) : concentration,
            y: raw.model(concentration),
          };
        });

        const dropped = x.length - pairs.length;
        return {
          ...base,
          raw: {
            method: raw.method, n: raw.n,
            ec50: raw.ec50, hillSlope: raw.hillSlope,
            top: raw.top, bottom: raw.bottom,
            r2: raw.r2, rmse: raw.rmse,
          },
          fittedCurve,
          summary: [
            { label: 'EC50 / IC50', value: formatNumber(raw.ec50), note: 'concentration giving a half-maximal response' },
            { label: 'Hill slope', value: formatNumber(raw.hillSlope) },
            { label: 'Top', value: formatNumber(raw.top) },
            { label: 'Bottom', value: formatNumber(raw.bottom) },
            { label: 'R²', value: formatNumber(raw.r2), note: `n = ${raw.n}` },
          ],
          warnings: [
            'This fit reports no confidence interval on the EC50 and does not compare alternative models. Treat it as a point estimate.',
            ...(dropped > 0 ? [`${dropped} point(s) at zero or negative concentration were left out of the fit.`] : []),
          ],
        };
      }

      const raw: any = method === 'correlation'
        ? stats.pearsonCorrelation(x, y)
        : stats.spearmanCorrelation(x, y);
      const coefficient = method === 'correlation' ? raw.r : raw.rho;
      return {
        ...base,
        raw,
        pValue: raw.pValue,
        summary: [
          { label: method === 'correlation' ? 'r' : 'rho', value: formatNumber(coefficient) },
          { label: 'P value', value: formatP(raw.pValue), note: raw.pApproach as string | undefined },
          { label: 'n', value: String(raw.n) },
        ],
        warnings: ['Correlation measures association, not causation, and a single outlier can dominate it. Look at the scatter plot before quoting the coefficient.'],
      };
    }
    if (method === 'friedman') {
      const matrix = completeRows(table, columns.map((column) => column.id));
      if (matrix.length < 2) {
        return { ...base, error: 'Needs at least two complete rows. Each row is one subject measured under every condition.' };
      }
      // completeRows gives one array per subject; friedmanTest wants one per
      // condition, so the matrix is transposed before it is handed over.
      const byCondition = columns.map((_, index) => matrix.map((row) => row[index]));
      const raw: any = stats.friedmanTest(byCondition);
      const correction = analysis.options.correction ?? 'holm';
      const pairs: { i: number; j: number; p: number }[] = [];
      for (let i = 0; i < columns.length; i += 1) {
        for (let j = i + 1; j < columns.length; j += 1) {
          const a = matrix.map((row) => row[i]);
          const b = matrix.map((row) => row[j]);
          pairs.push({ i, j, p: stats.wilcoxonSignedRank(a, b).pValue });
        }
      }
      const useable: Correction = correction === 'bh' ? 'bh' : 'holm';
      const adjusted = adjuster(useable)(pairs.map((pair) => pair.p));
      return {
        ...base,
        raw,
        pValue: raw.pValue,
        comparisons: pairs.map((pair, index) => ({
          labelA: labels[pair.i], labelB: labels[pair.j],
          indexA: pair.i, indexB: pair.j,
          pValue: pair.p, pAdjusted: adjusted[index],
        })),
        summary: [
          { label: 'χ²', value: formatNumber(raw.statistic ?? raw.chiSquare), note: `df = ${raw.df}` },
          { label: 'P value', value: formatP(raw.pValue), note: 'overall test' },
          { label: 'Subjects', value: String(matrix.length) },
        ],
        warnings: matrix.length < table.rows.length
          ? [`${table.rows.length - matrix.length} row(s) were dropped because they were not complete across every condition.`]
          : [],
      };
    }
    if (method === 'anova' || method === 'kruskal') {
      const groups = columns.map((column) => columnValues(table, column.id));
      if (groups.length < 3) return { ...base, error: 'Needs at least three data columns.' };
      if (groups.some((values) => values.length < 2)) {
        return { ...base, error: 'Every column needs at least two numeric values.' };
      }
      // With no variation anywhere, F is 0/0. With variation between groups but
      // none within, F is finite/0. Both are real situations in a lab - three
      // wells all reading exactly 100 - and neither may surface as NaN.
      const everyValue = groups.flat();
      if (new Set(everyValue).size === 1) {
        return {
          ...base,
          error: `Every value in these columns is ${everyValue[0]}. There is no variation to partition, so no test can be run.`,
        };
      }
      const withinVariation = groups.some((values) => new Set(values).size > 1);
      if (!withinVariation) {
        return {
          ...base,
          error: 'Every column is constant, so there is no within-group variation to compare the differences against. An F ratio would be infinite. Check whether replicates were entered.',
        };
      }

      const raw: any = method === 'anova' ? stats.oneWayAnova(groups) : stats.kruskalWallis(groups);
      const correction = analysis.options.correction ?? (method === 'anova' ? 'tukey' : 'dunn');

      let comparisons: Comparison[] = [];
      let postHocName = '';
      const warnings: string[] = [];

      if (correction === 'tukey' && method === 'anova') {
        const tukey: any = posthoc.tukeyHSD(groups, labels);
        postHocName = 'Tukey HSD';
        comparisons = tukey.comparisons.map((entry: any) => ({
          labelA: entry.labelA, labelB: entry.labelB,
          indexA: entry.indexA, indexB: entry.indexB,
          pValue: entry.pValue, pAdjusted: entry.pValue,
          difference: entry.difference, confidenceInterval95: entry.confidenceInterval95,
        }));
      } else if (correction === 'dunn') {
        const dunn: any = posthoc.dunnTest(groups, labels, (p: number[]) => stats.holmAdjust(p));
        postHocName = "Dunn's test with Holm correction";
        comparisons = dunn.comparisons.map((entry: any) => ({
          labelA: entry.labelA, labelB: entry.labelB,
          indexA: entry.indexA, indexB: entry.indexB,
          pValue: entry.pValue, pAdjusted: entry.pAdjusted,
        }));
      } else if (correction === 'control') {
        const controlIndex = Math.min(analysis.options.controlIndex ?? 0, groups.length - 1);
        const test = method === 'anova' ? stats.welchTTest : stats.mannWhitney;
        const versus: any = posthoc.versusControl(groups, controlIndex, labels, test);
        postHocName = versus.method;
        warnings.push(versus.note);
        comparisons = versus.comparisons;
      } else {
        const pairs: { i: number; j: number; p: number }[] = [];
        for (let i = 0; i < groups.length; i += 1) {
          for (let j = i + 1; j < groups.length; j += 1) {
            const test = method === 'anova'
              ? stats.welchTTest(groups[i], groups[j])
              : stats.mannWhitney(groups[i], groups[j]);
            pairs.push({ i, j, p: test.pValue });
          }
        }
        const adjusted = adjuster(correction)(pairs.map((pair) => pair.p));
        postHocName = correction === 'holm' ? 'pairwise tests with Holm correction'
          : correction === 'bh' ? 'pairwise tests with Benjamini–Hochberg correction'
          : 'uncorrected pairwise tests';
        comparisons = pairs.map((pair, index) => ({
          labelA: labels[pair.i], labelB: labels[pair.j],
          indexA: pair.i, indexB: pair.j,
          pValue: pair.p, pAdjusted: adjusted[index],
        }));
        if (correction === 'none') {
          warnings.push('Pairwise p-values are uncorrected. With multiple comparisons this inflates the false-positive rate.');
        }
      }

      return {
        ...base,
        raw: { ...raw, postHoc: postHocName },
        pValue: raw.pValue,
        comparisons,
        summary: [
          { label: method === 'anova' ? 'F' : 'H', value: formatNumber(raw.statistic) },
          { label: 'P value', value: formatP(raw.pValue), note: 'overall test' },
          { label: 'Groups', value: String(groups.length) },
          { label: 'Post-hoc', value: postHocName || '—' },
        ],
        warnings,
      };
    }
    if (isTwoGroupTest(method)) {
      const groups = columns.map((column) => columnValues(table, column.id));
      if (groups.length !== 2) return { ...base, error: 'Select exactly two columns to compare.' };
      const [a, b] = groups;
      if (a.length < 2 || b.length < 2) {
        return { ...base, error: 'Each column needs at least two numeric values.' };
      }

      const paired = method === 'paired' || method === 'wilcoxon';
      if (paired && a.length !== b.length) {
        return { ...base, error: `Paired tests need equal numbers of values (${a.length} vs ${b.length}). Each row must be one subject.` };
      }

      const raw: any =
        method === 'welch' ? stats.welchTTest(a, b)
        : method === 'student' ? stats.studentTTest(a, b)
        : method === 'paired' ? stats.pairedTTest(a, b)
        : method === 'mannwhitney' ? stats.mannWhitney(a, b)
        : stats.wilcoxonSignedRank(a, b);

      const summary: AnalysisResult['summary'] = [];
      if (typeof raw.difference === 'number') {
        summary.push({ label: 'Difference of means', value: formatNumber(raw.difference), note: `${labels[0]} − ${labels[1]}` });
      } else if (typeof raw.meanDifference === 'number') {
        summary.push({ label: 'Mean difference', value: formatNumber(raw.meanDifference), note: 'paired' });
      } else if (typeof raw.medianDifference === 'number') {
        summary.push({ label: 'Median difference', value: formatNumber(raw.medianDifference) });
      }
      if (Array.isArray(raw.confidenceInterval95)) {
        summary.push({
          label: '95% CI',
          value: `${formatNumber(raw.confidenceInterval95[0])} to ${formatNumber(raw.confidenceInterval95[1])}`,
        });
      }
      summary.push({
        label: 'P value',
        value: formatP(raw.pValue),
        note: (raw.pApproach as string) ?? (typeof raw.df === 'number' ? `df = ${formatNumber(raw.df, 3)}` : undefined),
      });
      if (typeof raw.effectSizeCohensD === 'number') {
        summary.push({ label: "Cohen's d", value: formatNumber(raw.effectSizeCohensD), note: 'standardised effect size' });
      }

      const warnings: string[] = [];
      if (raw.ties === true && raw.exact === false) {
        warnings.push('Ties are present and the sample is too large to enumerate every arrangement, so a normal approximation with continuity correction was used.');
      }
      if (a.length < 3 || b.length < 3) {
        warnings.push('Fewer than three values in a group. Any p-value here is very weak evidence.');
      }

      return {
        ...base,
        raw,
        pValue: raw.pValue,
        method: raw.method ?? methodInfo(method).label,
        summary,
        warnings,
        comparisons: [{
          labelA: labels[0], labelB: labels[1],
          indexA: 0, indexB: 1,
          pValue: raw.pValue, pAdjusted: raw.pValue,
        }],
      };
    }

    return { ...base, error: 'That method is not available for this table.' };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

/** A sentence a researcher can paste into a manuscript. */
export function methodsSentence(
  table: DataTable,
  analysis: Analysis,
  result: AnalysisResult
): string {
  if (result.error) return '';
  const columns = analysisColumns(table, analysis);
  const names = columns.map((column) => column.name);
  const engine = `AssayPlot ${APP_VERSION}`;
  // "P < 0.0001" rather than "P = < 0.0001": the operator lives in the phrase.
  const p = formatP(result.pValue).startsWith('<')
    ? `P ${formatP(result.pValue)}`
    : `P = ${formatP(result.pValue)}`;
  const postHoc = String((result.raw as any)?.postHoc ?? '');

  switch (analysis.method) {
    case 'descriptive':
      return `Values are reported as mean ± SD (${engine}).`;
    case 'onesample':
      return `${names[0]} was compared against ${analysis.options.hypothesised ?? 0} with a two-tailed one-sample t-test (${p}; ${engine}).`;
    case 'welch':
      return `${names[0]} and ${names[1]} were compared with Welch's unequal-variance t-test (two-tailed, ${p}; ${engine}).`;
    case 'student':
      return `${names[0]} and ${names[1]} were compared with Student's t-test assuming equal variances (two-tailed, ${p}; ${engine}).`;
    case 'paired':
      return `${names[0]} and ${names[1]} were compared with a paired two-tailed t-test (${p}; ${engine}).`;
    case 'mannwhitney':
      return `${names[0]} and ${names[1]} were compared with a two-tailed Mann–Whitney U test (${result.raw.exact ? 'exact' : 'normal approximation with continuity correction'}, ${p}; ${engine}).`;
    case 'wilcoxon':
      return `${names[0]} and ${names[1]} were compared with a two-tailed Wilcoxon signed-rank test (${result.raw.exact ? 'exact' : 'normal approximation'}, ${p}; ${engine}).`;
    case 'anova':
      return `Groups were compared by one-way ANOVA (${p})${postHoc ? `, followed by ${postHoc}` : ''} (${engine}).`;
    case 'kruskal':
      return `Groups were compared by the Kruskal–Wallis test (${p})${postHoc ? `, followed by ${postHoc}` : ''} (${engine}).`;
    case 'friedman':
      return `Conditions were compared by the Friedman test for repeated measures (${p}), followed by pairwise Wilcoxon signed-rank tests with Holm's correction (${engine}).`;
    case 'correlation':
      return `The association between X and ${names[0]} was quantified by Pearson's correlation coefficient (${p}; ${engine}).`;
    case 'spearman':
      return `The association between X and ${names[0]} was quantified by Spearman's rank correlation (${p}; ${engine}).`;
    case 'regression':
      return `${names[0]} was regressed on X by ordinary least squares (${p}; ${engine}).`;
    case 'doseresponse':
      return `Dose–response data were fitted with a four-parameter logistic model by least squares, giving EC50 = ${formatNumber((result.raw as any).ec50)} and a Hill slope of ${formatNumber((result.raw as any).hillSlope)} (${engine}).`;
    case 'chisq':
      return `Counts were compared with Pearson's chi-square test${(result.raw as any).yatesApplied ? " with Yates' continuity correction" : ''} (${p}; ${engine}).`;
    case 'fisher':
      return `Counts were compared with Fisher's exact test (two-sided, ${p}; ${engine}).`;
    case 'twoway': {
      const raw = result.raw as any;
      return `Data were analysed by two-way ANOVA. The row factor gave ${formatP(raw.pA).startsWith('<') ? `P ${formatP(raw.pA)}` : `P = ${formatP(raw.pA)}`}, the column factor ${formatP(raw.pB).startsWith('<') ? `P ${formatP(raw.pB)}` : `P = ${formatP(raw.pB)}`}, and their interaction ${formatP(raw.pInteraction).startsWith('<') ? `P ${formatP(raw.pInteraction)}` : `P = ${formatP(raw.pInteraction)}`} (${engine}).`;
    }
    case 'survival': {
      const raw = result.raw as any;
      const base = `Survival was estimated by the Kaplan–Meier method`;
      return raw.logRank
        ? `${base} and groups were compared with the log-rank (Mantel–Cox) test (${p}; ${engine}).`
        : `${base} (${engine}).`;
    }
    case 'normality':
      return `Normality was assessed with the Shapiro–Wilk test (${engine}).`;
    case 'variance':
      return `Equality of variances was assessed with Levene's test centred on the median (${p}; ${engine}).`;
    case 'outlier':
      return `Outliers were screened with Grubbs' test (${engine}).`;
    default:
      return '';
  }
}

export function makeColumn(name: string, role: ColumnRole = 'group'): Column {
  return { id: newId('col'), name, role };
}

export function makeTable(name: string, shape: TableShape = 'column'): DataTable {
  const columns =
    shape === 'xy' ? [makeColumn('X', 'x'), makeColumn('Y1', 'y')]
    : shape === 'grouped' ? [makeColumn('Group', 'label'), makeColumn('Control'), makeColumn('Treated')]
    : shape === 'survival' ? [makeColumn('Time', 'time'), makeColumn('Event', 'event'), makeColumn('Group', 'group')]
    : [makeColumn('Group A'), makeColumn('Group B')];
  const rows: Cell[][] = Array.from({ length: 8 }, () => columns.map(() => null));
  return { id: newId('tbl'), name, shape, columns, rows };
}

export function defaultStyle(overrides: Partial<FigureStyle> = {}): FigureStyle {
  return {
    title: '',
    xLabel: '',
    yLabel: '',
    palette: 'assayplot',
    seriesColors: {},
    errorBars: 'sd',
    showPoints: true,
    showSignificance: true,
    showLegend: true,
    grid: 'horizontal',
    frame: false,
    yMin: null,
    yMax: null,
    xMin: null,
    xMax: null,
    logY: false,
    logX: false,
    width: 520,
    height: 380,
    pointSize: 4,
    fontSize: 13,
    barWidth: 0.55,
    bins: 12,
    ...overrides,
  };
}

export function makeFigure(name: string, tableId: string, plotType: PlotType = 'bar'): Figure {
  return {
    id: newId('fig'),
    name,
    tableId,
    analysisId: null,
    plotType,
    style: defaultStyle(),
  };
}

export function makeLayout(name: string, panels: string[] = []): Layout {
  return { id: newId('lay'), name, panels, columns: 2, labelStyle: 'A', gap: 18 };
}

/** The letter or number shown on a panel, e.g. A, b, or 3. */
export function panelLabel(style: PanelLabelStyle, index: number): string {
  if (style === 'none') return '';
  if (style === '1') return String(index + 1);
  const letter = String.fromCharCode(65 + (index % 26));
  return style === 'a' ? letter.toLowerCase() : letter;
}

export function makeAnalysis(name: string, tableId: string, method: Method = 'descriptive'): Analysis {
  return { id: newId('ana'), name, tableId, method, options: { correction: 'tukey' } };
}

/** The project a first-time user sees, with real data they can immediately change. */
export function demoProject(): Project {
  const table: DataTable = {
    id: newId('tbl'),
    name: 'Cell viability',
    shape: 'column',
    columns: [
      makeColumn('Vehicle'),
      makeColumn('Drug 1 µM'),
      makeColumn('Drug 10 µM'),
    ],
    rows: [
      [92, 78, 61],
      [88, 74, 58],
      [95, 81, 66],
      [90, 76, 59],
      [87, 72, 63],
      [93, 79, 57],
    ],
  };
  const analysis: Analysis = {
    id: newId('ana'),
    name: 'Viability by dose',
    tableId: table.id,
    method: 'anova',
    options: { correction: 'tukey' },
  };
  const figure: Figure = {
    id: newId('fig'),
    name: 'Figure 1',
    tableId: table.id,
    analysisId: analysis.id,
    plotType: 'bar',
    style: defaultStyle({ yLabel: 'Viability (%)', errorBars: 'sd' }),
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    name: 'Untitled project',
    tables: [table],
    analyses: [analysis],
    figures: [figure],
    layouts: [],
  };
}

/** A blank project with one empty table, for File > New. */
export function emptyProject(name = 'Untitled project'): Project {
  const table = makeTable('Data 1');
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    name,
    tables: [table],
    analyses: [],
    figures: [],
    layouts: [],
  };
}

/** Ids of every node that depends on the given table, directly or otherwise. */
export function dependentsOfTable(project: Project, tableId: string): string[] {
  const analyses = project.analyses.filter((a) => a.tableId === tableId).map((a) => a.id);
  const figures = project.figures
    .filter((f) => f.tableId === tableId || (f.analysisId !== null && analyses.includes(f.analysisId)))
    .map((f) => f.id);
  return [...analyses, ...figures];
}
