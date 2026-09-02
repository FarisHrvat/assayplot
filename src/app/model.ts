// The Statista document model.
//
// A project is a set of data tables, plus analyses and figures that are *bound*
// to a table by id. Nothing here touches the DOM: this module defines the
// document, the dependency edges between its nodes, and the pure functions that
// turn a specification plus a table into a result.

// @ts-ignore - the statistics core is still plain JS, ported incrementally.
import * as stats from '../core/stats.js';

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
  | 'welch'
  | 'student'
  | 'paired'
  | 'mannwhitney'
  | 'wilcoxon'
  | 'anova'
  | 'kruskal'
  | 'correlation'
  | 'spearman'
  | 'regression';

export interface AnalysisOptions {
  /** Column ids to compare. Two for a t-test, any number for ANOVA. */
  columnIds?: string[];
  /** Multiplicity correction applied to post-hoc comparisons. */
  correction?: 'none' | 'holm' | 'bh';
}

export interface Analysis {
  id: string;
  name: string;
  tableId: string;
  method: Method;
  options: AnalysisOptions;
}

export type PlotType =
  | 'dot'
  | 'bar'
  | 'box'
  | 'violin'
  | 'line'
  | 'scatter';

export type ErrorBarKind = 'none' | 'sd' | 'sem' | 'ci95';

export interface FigureStyle {
  title: string;
  xLabel: string;
  yLabel: string;
  palette: string;
  errorBars: ErrorBarKind;
  showPoints: boolean;
  showSignificance: boolean;
  yMin: number | null;
  yMax: number | null;
  width: number;
  height: number;
  pointSize: number;
  fontSize: number;
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

export const SCHEMA_VERSION = 3;
export const APP_VERSION = '0.2.0';

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

/** Numeric values in one column, with blanks and non-numeric entries dropped. */
export function columnValues(table: DataTable, columnId: string): number[] {
  const index = columnIndex(table, columnId);
  if (index < 0) return [];
  const values: number[] = [];
  for (const row of table.rows) {
    const cell = row[index];
    if (cell === null || cell === undefined || cell === '') continue;
    const value = typeof cell === 'number' ? cell : Number(cell);
    if (Number.isFinite(value)) values.push(value);
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
  const numeric = (cell: Cell): number | null => {
    if (cell === null || cell === undefined || cell === '') return null;
    const value = typeof cell === 'number' ? cell : Number(cell);
    return Number.isFinite(value) ? value : null;
  };
  for (const row of table.rows) {
    const xv = numeric(row[xIndex]);
    const yv = numeric(row[yIndex]);
    if (xv !== null && yv !== null) {
      xs.push(xv);
      ys.push(yv);
    }
  }
  return { x: xs, y: ys };
}

// ---------------------------------------------------------------------------
// which analyses a table can actually support
// ---------------------------------------------------------------------------

export interface MethodInfo {
  id: Method;
  label: string;
  /** Plain-language statement of what the method assumes. */
  assumes: string;
  minGroups: number;
  maxGroups: number;
  requiresXy: boolean;
}

export const METHODS: MethodInfo[] = [
  { id: 'descriptive', label: 'Descriptive statistics', assumes: 'Nothing beyond numeric values.', minGroups: 1, maxGroups: Infinity, requiresXy: false },
  { id: 'welch', label: 'Welch t-test (unequal variance)', assumes: 'Two independent groups. Roughly normal, but variances may differ.', minGroups: 2, maxGroups: 2, requiresXy: false },
  { id: 'student', label: "Student's t-test (equal variance)", assumes: 'Two independent groups, roughly normal, with similar variances.', minGroups: 2, maxGroups: 2, requiresXy: false },
  { id: 'paired', label: 'Paired t-test', assumes: 'Two measurements on the same subjects, in matching row order.', minGroups: 2, maxGroups: 2, requiresXy: false },
  { id: 'mannwhitney', label: 'Mann–Whitney U', assumes: 'Two independent groups. No distributional assumption; compares ranks.', minGroups: 2, maxGroups: 2, requiresXy: false },
  { id: 'wilcoxon', label: 'Wilcoxon signed-rank', assumes: 'Two paired measurements, in matching row order. Compares ranks.', minGroups: 2, maxGroups: 2, requiresXy: false },
  { id: 'anova', label: 'One-way ANOVA', assumes: 'Three or more independent groups, roughly normal, similar variances.', minGroups: 3, maxGroups: Infinity, requiresXy: false },
  { id: 'kruskal', label: 'Kruskal–Wallis', assumes: 'Three or more independent groups. Rank-based, no normality assumed.', minGroups: 3, maxGroups: Infinity, requiresXy: false },
  { id: 'correlation', label: 'Pearson correlation', assumes: 'Paired X and Y measurements with a roughly linear relationship.', minGroups: 1, maxGroups: Infinity, requiresXy: true },
  { id: 'spearman', label: 'Spearman rank correlation', assumes: 'Paired X and Y. Monotone rather than linear association.', minGroups: 1, maxGroups: Infinity, requiresXy: true },
  { id: 'regression', label: 'Simple linear regression', assumes: 'Y depends linearly on X, with roughly constant scatter.', minGroups: 1, maxGroups: Infinity, requiresXy: true },
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
      return { info, usable: false, why: `Needs at least ${info.minGroups} data columns; this table has ${groups}.` };
    }
    if (groups > info.maxGroups) {
      return { info, usable: false, why: `Compares exactly ${info.maxGroups} columns. Choose which two below.` };
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
}

export interface AnalysisResult {
  method: string;
  /** Headline figures shown in the results panel, in display order. */
  summary: { label: string; value: string; note?: string }[];
  /** Full result object from the statistics core, for the details view. */
  raw: Record<string, unknown>;
  pValue: number | null;
  comparisons: Comparison[];
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

export function runAnalysis(table: DataTable, analysis: Analysis): AnalysisResult {
  const empty: AnalysisResult = {
    method: methodInfo(analysis.method).label,
    summary: [],
    raw: {},
    pValue: null,
    comparisons: [],
    warnings: [],
    error: null,
  };

  try {
    const columns = analysisColumns(table, analysis);
    const method = analysis.method;

    if (method === 'descriptive') {
      const rows = columns.map((column) => ({
        column,
        stat: stats.descriptiveSummary(columnValues(table, column.id)),
      }));
      return {
        ...empty,
        raw: { columns: rows.map((entry) => ({ name: entry.column.name, ...entry.stat })) },
        summary: rows.map((entry) => ({
          label: entry.column.name,
          value: `${formatNumber(entry.stat.mean)} ± ${formatNumber(entry.stat.sd)}`,
          note: `n = ${entry.stat.n}, median ${formatNumber(entry.stat.median)}`,
        })),
      };
    }

    if (method === 'correlation' || method === 'spearman' || method === 'regression') {
      const target = columns[0];
      if (!target) return { ...empty, error: 'Choose a Y column to model.' };
      const { x, y } = xyPairs(table, target.id);
      if (x.length < 3) return { ...empty, error: 'Needs at least three complete XY pairs.' };

      if (method === 'regression') {
        const raw: any = stats.linearRegression(x, y);
        return {
          ...empty,
          raw,
          pValue: raw.pValue ?? null,
          summary: [
            { label: 'Slope', value: formatNumber(raw.slope), note: `95% CI ${formatNumber(raw.slopeConfidenceInterval95?.[0])} to ${formatNumber(raw.slopeConfidenceInterval95?.[1])}` },
            { label: 'Intercept', value: formatNumber(raw.intercept) },
            { label: 'R²', value: formatNumber(raw.r2) },
            { label: 'n', value: String(raw.n) },
          ],
        };
      }

      const raw: any = method === 'correlation'
        ? stats.pearsonCorrelation(x, y)
        : stats.spearmanCorrelation(x, y);
      const coefficient = method === 'correlation' ? raw.r : raw.rho;
      return {
        ...empty,
        raw,
        pValue: raw.pValue,
        summary: [
          { label: method === 'correlation' ? 'r' : 'rho', value: formatNumber(coefficient) },
          { label: 'P value', value: formatP(raw.pValue), note: raw.pApproach as string | undefined },
          { label: 'n', value: String(raw.n) },
        ],
      };
    }

    // Group comparisons from here on.
    const groups = columns.map((column) => columnValues(table, column.id));
    const labels = columns.map((column) => column.name);

    if (method === 'anova' || method === 'kruskal') {
      if (groups.length < 3) return { ...empty, error: 'Needs at least three data columns.' };
      if (groups.some((values) => values.length < 2)) {
        return { ...empty, error: 'Every column needs at least two numeric values.' };
      }
      const raw: any = method === 'anova' ? stats.oneWayAnova(groups) : stats.kruskalWallis(groups);

      // Post-hoc pairwise comparisons with the chosen correction.
      const pairs: { i: number; j: number; p: number }[] = [];
      for (let i = 0; i < groups.length; i += 1) {
        for (let j = i + 1; j < groups.length; j += 1) {
          const test = method === 'anova'
            ? stats.welchTTest(groups[i], groups[j])
            : stats.mannWhitney(groups[i], groups[j]);
          pairs.push({ i, j, p: test.pValue });
        }
      }
      const correction = analysis.options.correction ?? 'holm';
      const rawPs = pairs.map((pair) => pair.p);
      const adjusted = correction === 'holm'
        ? stats.holmAdjust(rawPs)
        : correction === 'bh'
          ? stats.benjaminiHochberg(rawPs)
          : rawPs;

      return {
        ...empty,
        raw,
        pValue: raw.pValue,
        method: methodInfo(method).label,
        comparisons: pairs.map((pair, index) => ({
          labelA: labels[pair.i],
          labelB: labels[pair.j],
          indexA: pair.i,
          indexB: pair.j,
          pValue: pair.p,
          pAdjusted: adjusted[index],
        })),
        summary: [
          { label: method === 'anova' ? 'F' : 'H', value: formatNumber(raw.statistic) },
          { label: 'P value', value: formatP(raw.pValue), note: 'overall test' },
          { label: 'Groups', value: String(groups.length) },
        ],
        warnings: correction === 'none'
          ? ['Pairwise p-values are uncorrected. With multiple comparisons this inflates the false-positive rate.']
          : [],
      };
    }

    // Two-group tests.
    if (groups.length !== 2) {
      return { ...empty, error: 'Select exactly two columns to compare.' };
    }
    const [a, b] = groups;
    if (a.length < 2 || b.length < 2) {
      return { ...empty, error: 'Each column needs at least two numeric values.' };
    }

    const paired = method === 'paired' || method === 'wilcoxon';
    if (paired && a.length !== b.length) {
      return { ...empty, error: `Paired tests need equal numbers of values (${a.length} vs ${b.length}). Each row must be one subject.` };
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
      ...empty,
      raw,
      pValue: raw.pValue,
      method: raw.method ?? methodInfo(method).label,
      summary,
      warnings,
      comparisons: [{
        labelA: labels[0],
        labelB: labels[1],
        indexA: 0,
        indexB: 1,
        pValue: raw.pValue,
        pAdjusted: raw.pValue,
      }],
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
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
  const engine = `Statista ${APP_VERSION}`;
  // "P < 0.0001" rather than "P = < 0.0001": the operator lives in the phrase.
  const p = formatP(result.pValue).startsWith('<')
    ? `P ${formatP(result.pValue)}`
    : `P = ${formatP(result.pValue)}`;

  switch (analysis.method) {
    case 'descriptive':
      return `Values are reported as mean ± SD (${engine}).`;
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
    case 'anova': {
      const correction = analysis.options.correction ?? 'holm';
      const label = correction === 'holm' ? "Holm's step-down correction" : correction === 'bh' ? 'the Benjamini–Hochberg procedure' : 'no correction';
      return `Groups were compared by one-way ANOVA (${p}), followed by pairwise Welch t-tests with ${label} (${engine}).`;
    }
    case 'kruskal': {
      const correction = analysis.options.correction ?? 'holm';
      const label = correction === 'holm' ? "Holm's step-down correction" : correction === 'bh' ? 'the Benjamini–Hochberg procedure' : 'no correction';
      return `Groups were compared by the Kruskal–Wallis test (${p}), followed by pairwise Mann–Whitney tests with ${label} (${engine}).`;
    }
    case 'correlation':
      return `The association between X and ${names[0]} was quantified by Pearson's correlation coefficient (${p}; ${engine}).`;
    case 'spearman':
      return `The association between X and ${names[0]} was quantified by Spearman's rank correlation (${p}; ${engine}).`;
    case 'regression':
      return `${names[0]} was regressed on X by ordinary least squares (${p}; ${engine}).`;
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
    ? [makeColumn('X', 'x'), makeColumn('Y', 'y')]
    : [makeColumn('Group A'), makeColumn('Group B')];
  const rows: Cell[][] = Array.from({ length: 8 }, () => columns.map(() => null));
  return { id: newId('tbl'), name, shape, columns, rows };
}

export function defaultStyle(overrides: Partial<FigureStyle> = {}): FigureStyle {
  return {
    title: '',
    xLabel: '',
    yLabel: '',
    palette: 'statista',
    errorBars: 'sd',
    showPoints: true,
    showSignificance: true,
    yMin: null,
    yMax: null,
    width: 520,
    height: 360,
    pointSize: 4,
    fontSize: 13,
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
  return { id: newId('ana'), name, tableId, method, options: { correction: 'holm' } };
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
    options: { correction: 'holm' },
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
