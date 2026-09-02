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
export type ColumnRole = 'group' | 'x' | 'y' | 'label' | 'ignore';

/**
 * Table shapes, following the way experiments are actually laid out rather than
 * a normalised long format. In `column` shape each column is one treatment
 * group and each row is a replicate — the layout a bench scientist already has
 * in their notebook.
 */
export type TableShape = 'column' | 'xy';

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
  | 'pie' | 'donut';

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

export interface Project {
  schemaVersion: number;
  appVersion: string;
  name: string;
  tables: DataTable[];
  analyses: Analysis[];
  figures: Figure[];
}

export const SCHEMA_VERSION = 4;
export const APP_VERSION = '0.3.0';

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// reading values out of a table
// ---------------------------------------------------------------------------

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
  return table.columns.filter((column) => column.role !== 'ignore' && column.role !== 'label');
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

// ---------------------------------------------------------------------------
// which analyses a table can actually support
// ---------------------------------------------------------------------------

export type MethodFamily =
  | 'Describe' | 'One sample' | 'Two groups' | 'Three or more groups'
  | 'X versus Y' | 'Categorical counts' | 'Assumptions and screening';

export interface MethodInfo {
  id: Method;
  label: string;
  family: MethodFamily;
  /** Plain-language statement of what the method assumes. */
  assumes: string;
  minGroups: number;
  maxGroups: number;
  requiresXy: boolean;
}

export const METHODS: MethodInfo[] = [
  { id: 'descriptive', label: 'Descriptive statistics', family: 'Describe', assumes: 'Nothing beyond numeric values.', minGroups: 1, maxGroups: Infinity, requiresXy: false },

  { id: 'onesample', label: 'One-sample t-test', family: 'One sample', assumes: 'One group of roughly normal values, compared against a fixed number you choose.', minGroups: 1, maxGroups: 1, requiresXy: false },

  { id: 'welch', label: 'Welch t-test (unequal variance)', family: 'Two groups', assumes: 'Two independent groups. Roughly normal, but variances may differ.', minGroups: 2, maxGroups: 2, requiresXy: false },
  { id: 'student', label: "Student's t-test (equal variance)", family: 'Two groups', assumes: 'Two independent groups, roughly normal, with similar variances.', minGroups: 2, maxGroups: 2, requiresXy: false },
  { id: 'paired', label: 'Paired t-test', family: 'Two groups', assumes: 'Two measurements on the same subjects, in matching row order.', minGroups: 2, maxGroups: 2, requiresXy: false },
  { id: 'mannwhitney', label: 'Mann–Whitney U', family: 'Two groups', assumes: 'Two independent groups. No distributional assumption; compares ranks.', minGroups: 2, maxGroups: 2, requiresXy: false },
  { id: 'wilcoxon', label: 'Wilcoxon signed-rank', family: 'Two groups', assumes: 'Two paired measurements, in matching row order. Compares ranks.', minGroups: 2, maxGroups: 2, requiresXy: false },

  { id: 'anova', label: 'One-way ANOVA', family: 'Three or more groups', assumes: 'Three or more independent groups, roughly normal, similar variances.', minGroups: 3, maxGroups: Infinity, requiresXy: false },
  { id: 'kruskal', label: 'Kruskal–Wallis', family: 'Three or more groups', assumes: 'Three or more independent groups. Rank-based, no normality assumed.', minGroups: 3, maxGroups: Infinity, requiresXy: false },
  { id: 'friedman', label: 'Friedman (repeated measures)', family: 'Three or more groups', assumes: 'Three or more measurements on the same subjects. Each row is one subject.', minGroups: 3, maxGroups: Infinity, requiresXy: false },

  { id: 'correlation', label: 'Pearson correlation', family: 'X versus Y', assumes: 'Paired X and Y measurements with a roughly linear relationship.', minGroups: 1, maxGroups: Infinity, requiresXy: true },
  { id: 'spearman', label: 'Spearman rank correlation', family: 'X versus Y', assumes: 'Paired X and Y. Monotone rather than linear association.', minGroups: 1, maxGroups: Infinity, requiresXy: true },
  { id: 'regression', label: 'Simple linear regression', family: 'X versus Y', assumes: 'Y depends linearly on X, with roughly constant scatter.', minGroups: 1, maxGroups: Infinity, requiresXy: true },
  { id: 'doseresponse', label: 'Dose–response curve (EC50 / IC50)', family: 'X versus Y', assumes: 'A sigmoid response to dose. X is concentration; tick “X is already log” if it is.', minGroups: 1, maxGroups: Infinity, requiresXy: true },

  { id: 'chisq', label: 'Chi-square test of counts', family: 'Categorical counts', assumes: 'Each cell is a count of independent observations, not a measurement.', minGroups: 2, maxGroups: Infinity, requiresXy: false },
  { id: 'fisher', label: "Fisher's exact test (2 × 2)", family: 'Categorical counts', assumes: 'A 2 × 2 table of counts. Exact, so it is safe with small numbers.', minGroups: 2, maxGroups: 2, requiresXy: false },

  { id: 'normality', label: 'Normality (Shapiro–Wilk)', family: 'Assumptions and screening', assumes: 'Checks each column against a normal distribution.', minGroups: 1, maxGroups: Infinity, requiresXy: false },
  { id: 'variance', label: 'Equal variances (Levene, Bartlett)', family: 'Assumptions and screening', assumes: 'Checks whether the groups have comparable spread.', minGroups: 2, maxGroups: Infinity, requiresXy: false },
  { id: 'outlier', label: "Outlier screening (Grubbs')", family: 'Assumptions and screening', assumes: 'Finds the single most extreme value in a roughly normal column.', minGroups: 1, maxGroups: Infinity, requiresXy: false },
];

export const METHOD_FAMILIES: MethodFamily[] = [
  'Describe', 'One sample', 'Two groups', 'Three or more groups',
  'X versus Y', 'Categorical counts', 'Assumptions and screening',
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
  const isXy = table.shape === 'xy';
  return METHODS.map((info) => {
    if (info.requiresXy && !isXy) {
      return { info, usable: false, why: 'Needs an XY table with an X column.' };
    }
    if (!info.requiresXy && isXy && info.id !== 'descriptive') {
      return { info, usable: false, why: 'Group comparisons need a Column table.' };
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

// ---------------------------------------------------------------------------
// running an analysis
// ---------------------------------------------------------------------------

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

export function runAnalysis(table: DataTable, analysis: Analysis): AnalysisResult {
  const base: AnalysisResult = { ...EMPTY, method: methodInfo(analysis.method).label };

  try {
    const columns = analysisColumns(table, analysis);
    const method = analysis.method;
    const labels = columns.map((column) => column.name);

    // ---------------------------------------------------------- describe
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

    // -------------------------------------------------------- one sample
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

    // ----------------------------------------------- assumption checking
    if (method === 'normality') {
      const rows = columns.map((column) => {
        const values = columnValues(table, column.id);
        try {
          const result: any = diagnostics.shapiroWilk(values);
          return [column.name, result.n, formatNumber(result.statistic), formatP(result.pValue),
            result.pValue < 0.05 ? 'departs from normal' : 'no detectable departure'];
        } catch (error) {
          return [column.name, values.length, '—', '—', error instanceof Error ? error.message : 'not testable'];
        }
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
        try {
          const result: any = diagnostics.grubbsTest(values);
          return [column.name, values.length, formatNumber(result.value), formatNumber(result.statistic, 3),
            formatP(result.pValue), result.isOutlier ? 'flagged' : '—'];
        } catch (error) {
          return [column.name, values.length, '—', '—', '—', error instanceof Error ? error.message : 'not testable'];
        }
      });
      return {
        ...base,
        raw: { columns: rows },
        tables: [{ title: "Grubbs' test per column", columns: ['Column', 'n', 'Most extreme', 'G', 'P value', 'Verdict'], rows }],
        warnings: ['Removing a value because a test flagged it changes the meaning of every p-value you compute afterwards. If you exclude it, say so in the paper and give the reason.'],
      };
    }

    // ------------------------------------------------ categorical counts
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

    // ------------------------------------------------------------ XY
    if (method === 'correlation' || method === 'spearman' || method === 'regression' || method === 'doseresponse') {
      const target = columns[0];
      if (!target) return { ...base, error: 'Choose a Y column to model.' };
      const { x, y } = xyPairs(table, target.id);
      if (x.length < 3) return { ...base, error: 'Needs at least three complete XY pairs.' };

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
        const logX = analysis.options.logX ?? false;
        const dose = logX ? x : x.map((value) => (value > 0 ? Math.log10(value) : NaN));
        const usable = dose
          .map((value, index) => ({ value, y: y[index] }))
          .filter((entry) => Number.isFinite(entry.value));
        if (usable.length < 4) {
          return { ...base, error: 'A four-parameter fit needs at least four points at positive concentrations.' };
        }
        const raw: any = stats.fitFourParameterLogistic(
          usable.map((entry) => entry.value),
          usable.map((entry) => entry.y)
        );
        const low = Math.min(...usable.map((entry) => entry.value));
        const high = Math.max(...usable.map((entry) => entry.value));
        const curve = Array.from({ length: 120 }, (_, i) => {
          const at = low + ((high - low) * i) / 119;
          const value = raw.bottom + (raw.top - raw.bottom) / (1 + Math.pow(10, (raw.logEC50 - at) * raw.hillSlope));
          return { x: logX ? at : Math.pow(10, at), y: value };
        });
        return {
          ...base,
          raw,
          fittedCurve: curve,
          summary: [
            { label: 'EC50 / IC50', value: formatNumber(Math.pow(10, raw.logEC50)), note: 'in the units of X' },
            { label: 'log EC50', value: formatNumber(raw.logEC50) },
            { label: 'Hill slope', value: formatNumber(raw.hillSlope) },
            { label: 'Top / Bottom', value: `${formatNumber(raw.top)} / ${formatNumber(raw.bottom)}` },
            { label: 'R²', value: formatNumber(raw.r2) },
          ],
          warnings: [
            'This fit reports no confidence intervals on its parameters yet, and does not compare alternative models. Treat the EC50 as a point estimate.',
            ...(logX ? [] : ['X was log10-transformed for the fit; values at or below zero were dropped.']),
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

    // ----------------------------------------------- repeated measures
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

    // ------------------------------------------- three or more groups
    if (method === 'anova' || method === 'kruskal') {
      const groups = columns.map((column) => columnValues(table, column.id));
      if (groups.length < 3) return { ...base, error: 'Needs at least three data columns.' };
      if (groups.some((values) => values.length < 2)) {
        return { ...base, error: 'Every column needs at least two numeric values.' };
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

    // ------------------------------------------------------ two groups
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
        warnings.push('Ties are present, so the exact test is unavailable. A normal approximation with continuity correction was used, matching R.');
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

// ---------------------------------------------------------------------------
// methods text
// ---------------------------------------------------------------------------

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
      return `Dose–response data were fitted with a four-parameter logistic model by least squares, giving EC50 = ${formatNumber(Math.pow(10, (result.raw as any).logEC50))} and a Hill slope of ${formatNumber((result.raw as any).hillSlope)} (${engine}).`;
    case 'chisq':
      return `Counts were compared with Pearson's chi-square test${(result.raw as any).yatesApplied ? " with Yates' continuity correction" : ''} (${p}; ${engine}).`;
    case 'fisher':
      return `Counts were compared with Fisher's exact test (two-sided, ${p}; ${engine}).`;
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

// ---------------------------------------------------------------------------
// document construction
// ---------------------------------------------------------------------------

export function makeColumn(name: string, role: ColumnRole = 'group'): Column {
  return { id: newId('col'), name, role };
}

export function makeTable(name: string, shape: TableShape = 'column'): DataTable {
  const columns = shape === 'xy'
    ? [makeColumn('X', 'x'), makeColumn('Y1', 'y')]
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
  };
}

// ---------------------------------------------------------------------------
// dependency edges
// ---------------------------------------------------------------------------

/** Ids of every node that depends on the given table, directly or otherwise. */
export function dependentsOfTable(project: Project, tableId: string): string[] {
  const analyses = project.analyses.filter((a) => a.tableId === tableId).map((a) => a.id);
  const figures = project.figures
    .filter((f) => f.tableId === tableId || (f.analysisId !== null && analyses.includes(f.analysisId)))
    .map((f) => f.id);
  return [...analyses, ...figures];
}
