// Figure rendering: a FigureSpec plus a table compiles to a scene, and the
// scene renders to real SVG elements.
//
// The same tree is what gets exported, so what is on screen is what lands in
// the manuscript. Marks carry a back-reference to the row they came from, which
// is what makes click-to-trace possible, and every text element and series is
// selectable so the figure can be edited on the figure itself rather than only
// through a side panel.

import React from 'react';
// @ts-ignore - statistics core is still plain JS.
import * as stats from '../core/stats.js';
// @ts-ignore
import { normalQuantile } from '../core/diagnostics.js';
// @ts-ignore
import * as regression from '../core/regression.js';
// @ts-ignore
import * as multivariate from '../core/multivariate.js';
// @ts-ignore
import * as designs from '../core/designs.js';
import { getSettings } from './settings.ts';
import {
  type AnalysisResult,
  type DataTable,
  type Figure,
  type FigureStyle,
  type PlotType,
  type TableShape,
  columnValues,
  predictorCandidates,
  survivalRows,
  significanceStars,
  valueColumns,
  xColumn,
  xyPairs,
} from './model.ts';

export const PALETTES: Record<string, string[]> = {
  // Default: distinguishable in greyscale and under common colour-vision deficiency.
  assayplot: ['#0C6259', '#C2703D', '#3C5A99', '#7A5195', '#68843B', '#A33B4E', '#2C7A6B', '#8A5A2B'],
  greyscale: ['#1A1A1A', '#5A5A5A', '#8C8C8C', '#B4B4B4', '#3F3F3F', '#727272', '#9E9E9E', '#C8C8C8'],
  viridis: ['#440154', '#414487', '#2A788E', '#22A884', '#7AD151', '#BBDF27', '#31688E', '#35B779'],
  warm: ['#B3462F', '#D98E32', '#8C6D31', '#C25E7A', '#8A4B62', '#6E3B2E', '#A8752F', '#7C3B2A'],
  cool: ['#1F6F8B', '#2E9B8F', '#3D5A80', '#5E8C93', '#41668C', '#2C7A6B', '#4A7FA5', '#356B7D'],
  colourblind: ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#7A5195', '#56B4E9', '#E69F00', '#333333'],
};

export function paletteFor(name: string): string[] {
  return PALETTES[name] ?? PALETTES.assayplot;
}

/** Colour for a series, honouring any override set by clicking the mark. */
function colorFor(style: FigureStyle, columnId: string, index: number): string {
  const palette = paletteFor(getSettings().colourBlindSafe ? 'colourblind' : style.palette);
  return style.seriesColors[columnId] ?? palette[index % palette.length];
}

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'star';

const SHAPES: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'star'];

/**
 * In colour-blind safe mode each series gets its own shape, so the figure is
 * still readable in greyscale or by someone who cannot separate the hues.
 */
export const shapeFor = (index: number): MarkerShape =>
  getSettings().colourBlindSafe ? SHAPES[index % SHAPES.length] : 'circle';

/** One data point, drawn as whichever shape its series was given. */
function Marker({ x, y, r, shape, fill, fillOpacity, stroke, strokeWidth, onClick, cursor, children }: {
  x: number; y: number; r: number; shape: MarkerShape;
  fill: string; fillOpacity?: number; stroke?: string; strokeWidth?: number;
  onClick?: (event: React.MouseEvent) => void; cursor?: string;
  children?: React.ReactNode;
}) {
  const common = {
    fill, fillOpacity, stroke, strokeWidth, onClick,
    style: cursor ? { cursor } : undefined,
  };
  if (shape === 'circle') return <circle cx={x} cy={y} r={r} {...common}>{children}</circle>;
  if (shape === 'square') {
    return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...common}>{children}</rect>;
  }
  if (shape === 'triangle') {
    const h = r * 1.25;
    return <polygon points={`${x},${y - h} ${x + h},${y + h * 0.7} ${x - h},${y + h * 0.7}`} {...common}>{children}</polygon>;
  }
  if (shape === 'diamond') {
    const d = r * 1.3;
    return <polygon points={`${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}`} {...common}>{children}</polygon>;
  }
  if (shape === 'cross') {
    const a = r * 0.45;
    const b = r * 1.25;
    return (
      <polygon {...common}
        points={`${x - a},${y - b} ${x + a},${y - b} ${x + a},${y - a} ${x + b},${y - a} ${x + b},${y + a} ${x + a},${y + a} ${x + a},${y + b} ${x - a},${y + b} ${x - a},${y + a} ${x - b},${y + a} ${x - b},${y - a} ${x - a},${y - a}`}>
        {children}
      </polygon>
    );
  }
  const outer = r * 1.4;
  const inner = r * 0.6;
  const points = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    return `${x + radius * Math.cos(angle)},${y + radius * Math.sin(angle)}`;
  }).join(' ');
  return <polygon points={points} {...common}>{children}</polygon>;
}

export type Selected =
  | { kind: 'title' }
  | { kind: 'xLabel' }
  | { kind: 'yLabel' }
  | { kind: 'series'; columnId: string; index: number }
  | null;

/** Deterministic jitter: seeded from the mark's identity so it never moves. */
function jitter(seed: number, spread: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * spread;
}

interface Scale {
  min: number;
  max: number;
  toPixel: (value: number) => number;
}

/**
 * Maps a data value to a pixel. `pixelAtMin` is where the minimum sits, which
 * for a vertical axis is the *bottom* of the plot and therefore the larger
 * pixel value: SVG y grows downwards.
 */
function makeScale(min: number, max: number, pixelAtMin: number, pixelAtMax: number, log = false): Scale {
  if (log && min > 0 && max > 0) {
    const lo = Math.log10(min);
    const hi = Math.log10(max);
    const span = hi - lo || 1;
    return {
      min, max,
      toPixel: (value) =>
        value <= 0 ? pixelAtMin : pixelAtMin + ((Math.log10(value) - lo) / span) * (pixelAtMax - pixelAtMin),
    };
  }
  const span = max - min || 1;
  return {
    min, max,
    toPixel: (value) => pixelAtMin + ((value - min) / span) * (pixelAtMax - pixelAtMin),
  };
}

/** Human-friendly axis ticks covering [min, max]. */
function niceTicks(min: number, max: number, target = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const rawStep = span / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalised = rawStep / magnitude;
  const step = (normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1) * magnitude;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

/** Decade ticks for a log axis. */
function logTicks(min: number, max: number): number[] {
  const major: number[] = [];
  if (!(min > 0) || !(max > 0)) return major;
  for (let decade = Math.floor(Math.log10(min)); decade <= Math.ceil(Math.log10(max)); decade += 1) {
    const base = Math.pow(10, decade);
    if (base >= min * 0.999 && base <= max * 1.001) major.push(base);
  }
  return major.length ? major : [min, max];
}

function formatTick(value: number): string {
  if (value === 0) return '0';
  const absolute = Math.abs(value);
  if (absolute >= 100000 || absolute < 0.001) return value.toExponential(0).replace('e+', 'e');
  return String(Number(value.toFixed(6)));
}

const MARGIN = { top: 40, right: 26, bottom: 58, left: 66 };

export type PlotGroup = 'Compare groups' | 'Distribution' | 'X versus Y' | 'Matrix' | 'Parts of a whole' | 'Survival' | 'Agreement' | 'Model' | 'Multivariate';

export interface PlotKind {
  id: PlotType;
  label: string;
  group: PlotGroup;
  /** Which table shape the plot expects. */
  shape: TableShape;
}

export const PLOT_KINDS: PlotKind[] = [
  { id: 'bar', label: 'Bar with points', group: 'Compare groups', shape: 'column' },
  { id: 'dot', label: 'Dot plot with mean', group: 'Compare groups', shape: 'column' },
  { id: 'box', label: 'Box and whisker', group: 'Compare groups', shape: 'column' },
  { id: 'violin', label: 'Violin', group: 'Compare groups', shape: 'column' },
  { id: 'strip', label: 'Strip (jittered)', group: 'Compare groups', shape: 'column' },
  { id: 'swarm', label: 'Beeswarm', group: 'Compare groups', shape: 'column' },
  { id: 'pointrange', label: 'Mean with error bar', group: 'Compare groups', shape: 'column' },
  { id: 'lollipop', label: 'Lollipop', group: 'Compare groups', shape: 'column' },
  { id: 'paired', label: 'Before / after lines', group: 'Compare groups', shape: 'column' },

  { id: 'histogram', label: 'Histogram', group: 'Distribution', shape: 'column' },
  { id: 'density', label: 'Density curve', group: 'Distribution', shape: 'column' },
  { id: 'ecdf', label: 'Cumulative (ECDF)', group: 'Distribution', shape: 'column' },
  { id: 'qq', label: 'Q–Q plot (normality)', group: 'Distribution', shape: 'column' },

  { id: 'scatter', label: 'Scatter', group: 'X versus Y', shape: 'xy' },
  { id: 'line', label: 'Line', group: 'X versus Y', shape: 'xy' },
  { id: 'area', label: 'Area', group: 'X versus Y', shape: 'xy' },
  { id: 'step', label: 'Step', group: 'X versus Y', shape: 'xy' },
  { id: 'bubble', label: 'Bubble (2nd Y sets size)', group: 'X versus Y', shape: 'xy' },

  { id: 'heatmap', label: 'Heatmap of the table', group: 'Matrix', shape: 'column' },
  { id: 'correlation', label: 'Correlation matrix', group: 'Matrix', shape: 'column' },

  { id: 'pie', label: 'Pie', group: 'Parts of a whole', shape: 'column' },
  { id: 'donut', label: 'Donut', group: 'Parts of a whole', shape: 'column' },

  { id: 'survival', label: 'Kaplan–Meier curve', group: 'Survival', shape: 'survival' },

  { id: 'blandaltman', label: 'Bland–Altman agreement', group: 'Agreement', shape: 'column' },
  { id: 'forest', label: 'Forest plot (meta-analysis)', group: 'Agreement', shape: 'column' },

  { id: 'logisticfit', label: 'Fitted probability curve', group: 'Model', shape: 'column' },
  { id: 'roc', label: 'ROC curve', group: 'Model', shape: 'column' },
  { id: 'ancova', label: 'Parallel lines by group (ANCOVA)', group: 'Model', shape: 'xy' },
  { id: 'hazard', label: 'Hazard ratios (Cox)', group: 'Model', shape: 'survival' },
  { id: 'mrscatter', label: 'Mendelian randomisation scatter', group: 'Model', shape: 'column' },
  { id: 'outliers', label: 'Outliers (ROUT)', group: 'Model', shape: 'column' },

  { id: 'pcascore', label: 'PCA score plot', group: 'Multivariate', shape: 'column' },
  { id: 'scree', label: 'Scree plot', group: 'Multivariate', shape: 'column' },
  { id: 'dendrogram', label: 'Dendrogram with bootstrap', group: 'Multivariate', shape: 'column' },
  { id: 'clusterheatmap', label: 'Clustered heatmap', group: 'Multivariate', shape: 'column' },
  { id: 'plsscore', label: 'PLS-DA score plot', group: 'Multivariate', shape: 'column' },
  { id: 'anosimbox', label: 'ANOSIM rank dissimilarities', group: 'Multivariate', shape: 'column' },
];

export const PLOT_GROUPS: PlotGroup[] = ['Compare groups', 'Distribution', 'X versus Y', 'Matrix', 'Parts of a whole', 'Survival', 'Agreement', 'Model', 'Multivariate'];

export function plotsForShape(shape: TableShape): PlotKind[] {
  // A Grouped table plots like a Column table: its value columns are the series.
  const effective = shape === 'grouped' ? 'column' : shape;
  return PLOT_KINDS.filter((kind) => kind.shape === effective);
}

const XY_PLOTS: PlotType[] = ['scatter', 'line', 'area', 'step', 'bubble'];
const DISTRIBUTION_PLOTS: PlotType[] = ['histogram', 'density', 'ecdf', 'qq'];

export interface PlotProps {
  table: DataTable;
  figure: Figure;
  result?: AnalysisResult | null;
  /** Called with the source row index when a data mark is clicked. */
  onPickRow?: (rowIndex: number, columnIndex: number) => void;
  highlightRow?: number | null;
  /** Currently selected figure element, for direct editing. */
  selected?: Selected;
  onSelect?: (selection: Selected) => void;
  /** Set while a text element is being edited in place. */
  editing?: Selected;
  onEditText?: (value: string) => void;
  onFinishEdit?: () => void;
}

export function Plot(props: PlotProps) {
  const { table, figure, result, onPickRow, highlightRow, selected, onSelect } = props;
  const style = figure.style;
  const plotType = figure.plotType;
  const width = style.width;
  const height = style.height;
  const plotLeft = MARGIN.left;
  const plotRight = width - MARGIN.right;
  const plotTop = MARGIN.top;
  const font = style.fontSize;

  // The legend sits top-right beside the title. With more than two series it
  // would run into the title, so it moves to its own row beneath the plot and
  // the plot area gives up the height for it.
  const seriesCount = plotType === 'survival'
    ? new Set(survivalRows(table).map((subject) => subject.group)).size
    : valueColumns(table).length;
  const legendAtBottom = style.showLegend && seriesCount > 2;
  const plotBottom = height - MARGIN.bottom - (legendAtBottom ? 22 : 0);

  const legendPlacement = {
    atBottom: legendAtBottom,
    right: plotRight,
    left: plotLeft,
    y: legendAtBottom ? height - 10 : plotTop - 16,
  };

  // When the legend takes the bottom row, the axis label sits above it rather
  // than on top of it.
  const xLabelY = height - 12 - (legendAtBottom ? 18 : 0);

  const shared = { ...props, plotLeft, plotRight, plotTop, plotBottom, height, width, font, legendPlacement, xLabelY };

  const canvas = (children: React.ReactNode) => (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={style.title || figure.name}
      style={{ fontFamily: 'inherit' }}
      onClick={() => onSelect?.(null)}
    >
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      {children}
      <TitleText {...shared} />
    </svg>
  );

  if (plotType === 'survival') return canvas(<SurvivalPlot {...shared} />);
  if (plotType === 'blandaltman') return canvas(<BlandAltmanPlot {...shared} />);
  if (plotType === 'forest') return canvas(<ForestPlot {...shared} />);
  if (plotType === 'logisticfit') return canvas(<LogisticFitPlot {...shared} />);
  if (plotType === 'roc') return canvas(<RocPlot {...shared} />);
  if (plotType === 'ancova') return canvas(<AncovaPlot {...shared} />);
  if (plotType === 'hazard') return canvas(<HazardPlot {...shared} />);
  if (plotType === 'mrscatter') return canvas(<MendelianPlot {...shared} />);
  if (plotType === 'outliers') return canvas(<OutlierPlot {...shared} />);
  if (plotType === 'pcascore' || plotType === 'scree') return canvas(<PcaPlot {...shared} />);
  if (plotType === 'dendrogram' || plotType === 'clusterheatmap') return canvas(<ClusterPlot {...shared} />);
  if (plotType === 'plsscore') return canvas(<PlsPlot {...shared} />);
  if (plotType === 'anosimbox') return canvas(<AnosimPlot {...shared} />);
  if (plotType === 'heatmap' || plotType === 'correlation') return canvas(<MatrixPlot {...shared} />);
  if (plotType === 'pie' || plotType === 'donut') return canvas(<PiePlot {...shared} />);
  if (DISTRIBUTION_PLOTS.includes(plotType)) return canvas(<DistributionPlot {...shared} />);
  if (XY_PLOTS.includes(plotType)) {
    if (table.shape !== 'xy') {
      return <EmptyPlot width={width} height={height} message="This plot needs an XY table. Switch the table shape to XY." />;
    }
    const x = xColumn(table);
    const series = valueColumns(table).map((column, index) => ({
      column, index,
      color: colorFor(style, column.id, index),
      ...xyPairs(table, column.id),
    }));
    const allX = series.flatMap((entry) => entry.x);
    const allY = series.flatMap((entry) => entry.y);
    const curve = result?.fittedCurve ?? [];
    if (!allX.length) return <EmptyPlot width={width} height={height} message="Enter paired X and Y values" />;

    const xLow = style.xMin ?? Math.min(...allX, ...curve.map((point) => point.x));
    const xHigh = style.xMax ?? Math.max(...allX, ...curve.map((point) => point.x));
    const yValues = [...allY, ...curve.map((point) => point.y)];
    const pad = (Math.max(...yValues) - Math.min(...yValues)) * 0.08 || 1;
    const yLow = style.yMin ?? (plotType === 'area' ? Math.min(0, Math.min(...yValues)) : Math.min(...yValues) - pad);
    const yHigh = style.yMax ?? Math.max(...yValues) + pad;

    // A dose-response curve is unreadable on a linear X axis: everything
    // interesting happens in the first decade.
    const useLogX = style.logX && xLow > 0 && xHigh > 0;
    const xScale = makeScale(xLow, xHigh, plotLeft, plotRight, useLogX);
    const yScale = makeScale(yLow, yHigh, plotBottom, plotTop, style.logY);
    const xTicks = useLogX ? logTicks(xLow, xHigh) : niceTicks(xLow, xHigh);
    const yTicks = style.logY ? logTicks(yLow, yHigh) : niceTicks(yLow, yHigh);

    const sizeSeries = series.length > 1 ? series[1].y : [];
    const sizeMax = sizeSeries.length ? Math.max(...sizeSeries) : 1;

    return canvas(
      <>
        <Grid style={style} xTicks={xTicks} yTicks={yTicks} xScale={xScale} yScale={yScale}
          plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
        <YAxis {...shared} ticks={yTicks} yScale={yScale} />
        <XAxisNumeric {...shared} ticks={xTicks} xScale={xScale} fallbackLabel={x?.name ?? 'X'} />

        {series.map((entry) => {
          if (plotType === 'bubble' && entry.index > 0) return null;
          const points = entry.x.map((value, i) => `${xScale.toPixel(value)},${yScale.toPixel(entry.y[i])}`);
          const isSelected = selected?.kind === 'series' && selected.columnId === entry.column.id;
          return (
            <g key={entry.column.id} style={{ cursor: 'pointer' }}
              onClick={(event) => { event.stopPropagation(); onSelect?.({ kind: 'series', columnId: entry.column.id, index: entry.index }); }}>
              {plotType === 'area' && entry.x.length > 1 && (
                <polygon fill={entry.color} fillOpacity={0.22} stroke="none"
                  points={`${xScale.toPixel(entry.x[0])},${yScale.toPixel(yLow)} ${points.join(' ')} ${xScale.toPixel(entry.x[entry.x.length - 1])},${yScale.toPixel(yLow)}`} />
              )}
              {(plotType === 'line' || plotType === 'area') && entry.x.length > 1 && (
                <polyline fill="none" stroke={entry.color} strokeWidth={isSelected ? 3.5 : 2} points={points.join(' ')} />
              )}
              {plotType === 'step' && entry.x.length > 1 && (
                <polyline fill="none" stroke={entry.color} strokeWidth={isSelected ? 3.5 : 2}
                  points={entry.x.flatMap((value, i) => i === 0
                    ? [`${xScale.toPixel(value)},${yScale.toPixel(entry.y[i])}`]
                    : [`${xScale.toPixel(value)},${yScale.toPixel(entry.y[i - 1])}`,
                       `${xScale.toPixel(value)},${yScale.toPixel(entry.y[i])}`]).join(' ')} />
              )}
              {(plotType !== 'line' || style.showPoints) && entry.x.map((value, i) => {
                const radius = plotType === 'bubble' && sizeSeries[i] !== undefined
                  ? 3 + 15 * Math.sqrt(Math.max(0, sizeSeries[i]) / (sizeMax || 1))
                  : style.pointSize;
                return (
                  <Marker key={i} x={xScale.toPixel(value)} y={yScale.toPixel(entry.y[i])}
                    r={isSelected ? radius + 1 : radius} shape={shapeFor(entry.index)}
                    fill={entry.color}
                    fillOpacity={plotType === 'bubble' ? 0.5 : 0.85} stroke="#fff" strokeWidth={0.8}>
                    <title>{`${entry.column.name}: (${value}, ${entry.y[i]})`}</title>
                  </Marker>
                );
              })}
            </g>
          );
        })}

        {curve.length > 1 && (
          <polyline fill="none" stroke="#111" strokeWidth={1.8}
            points={curve.map((point) => `${xScale.toPixel(point.x)},${yScale.toPixel(point.y)}`).join(' ')} />
        )}

        {style.showLegend && series.length > 1 && (
          <Legend items={series.map((entry) => ({ label: entry.column.name, color: entry.color }))}
            placement={legendPlacement} font={font} />
        )}
      </>
    );
  }
  const columns = valueColumns(table);
  const groups = columns.map((column, index) => {
    const values = columnValues(table, column.id);
    const summary = values.length ? stats.descriptiveSummary(values) : null;
    return { column, values, summary, color: colorFor(style, column.id, index), index };
  });
  const populated = groups.filter((group) => group.values.length > 0);
  if (!populated.length) {
    return <EmptyPlot width={width} height={height} message="Enter some numbers in the data table" />;
  }

  const errorFor = (summary: any, values: number[]): number => {
    if (!summary) return 0;
    if (style.errorBars === 'sd') return Number.isFinite(summary.sd) ? summary.sd : 0;
    if (style.errorBars === 'sem') return Number.isFinite(summary.sem) ? summary.sem : 0;
    if (style.errorBars === 'ci95') {
      const [low, high] = summary.confidenceInterval95 ?? [NaN, NaN];
      return Number.isFinite(low) ? (high - low) / 2 : 0;
    }
    if (style.errorBars === 'range') {
      return values.length ? Math.max(Math.abs(summary.max - summary.mean), Math.abs(summary.mean - summary.min)) : 0;
    }
    return 0;
  };

  const allValues = populated.flatMap((group) => group.values);
  const errorTops = populated.map((group) => (group.summary?.mean ?? 0) + errorFor(group.summary, group.values));
  const errorBottoms = populated.map((group) => (group.summary?.mean ?? 0) - errorFor(group.summary, group.values));
  const dataLow = Math.min(...allValues, ...errorBottoms);
  const dataHigh = Math.max(...allValues, ...errorTops);

  const comparisons = (style.showSignificance && result?.comparisons) || [];
  const bracketRoom = comparisons.length ? Math.min(comparisons.length, 5) * 20 + 8 : 0;
  const span = dataHigh - dataLow || 1;
  const startsAtZero = plotType === 'bar' || plotType === 'lollipop';
  const autoLow = startsAtZero ? Math.min(0, dataLow - span * 0.05) : dataLow - span * 0.1;

  const yScale = makeScale(
    style.yMin ?? (style.logY ? Math.max(1e-9, dataLow * 0.7) : autoLow),
    style.yMax ?? dataHigh + span * 0.1,
    plotBottom,
    plotTop + bracketRoom,
    style.logY
  );
  const yTicks = style.logY ? logTicks(yScale.min, yScale.max) : niceTicks(yScale.min, yScale.max);

  const slotWidth = (plotRight - plotLeft) / groups.length;
  const centerOf = (index: number) => plotLeft + slotWidth * (index + 0.5);
  const bodyWidth = Math.min(slotWidth * style.barWidth, 92);
  const alwaysShowPoints = ['strip', 'swarm', 'paired'].includes(plotType);

  return canvas(
    <>
      <Grid style={style} xTicks={[]} yTicks={yTicks} xScale={null} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...shared} ticks={yTicks} yScale={yScale} />

      {plotType === 'paired' && <PairedLines table={table} groups={groups} centerOf={centerOf} yScale={yScale} />}

      {groups.map((group) => {
        const { summary, values, color, index } = group;
        if (!summary) return null;
        const center = centerOf(index);
        const average = summary.mean;
        const error = errorFor(summary, values);
        const isSelected = selected?.kind === 'series' && selected.columnId === group.column.id;
        const barTop = Math.max(average, yScale.min);

        return (
          <g key={group.column.id} style={{ cursor: 'pointer' }}
            onClick={(event) => { event.stopPropagation(); onSelect?.({ kind: 'series', columnId: group.column.id, index }); }}>

            {isSelected && (
              <rect x={center - slotWidth / 2 + 2} y={plotTop + bracketRoom - 4}
                width={slotWidth - 4} height={plotBottom - plotTop - bracketRoom + 8}
                fill="none" stroke="#0C6259" strokeWidth={1} strokeDasharray="3 3" rx={3} />
            )}

            {plotType === 'bar' && (
              <rect x={center - bodyWidth / 2} y={yScale.toPixel(barTop)} width={bodyWidth}
                height={Math.max(0, yScale.toPixel(yScale.min) - yScale.toPixel(barTop))}
                fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.5} />
            )}

            {plotType === 'lollipop' && (
              <>
                <line x1={center} x2={center} y1={yScale.toPixel(yScale.min)} y2={yScale.toPixel(average)}
                  stroke={color} strokeWidth={2} />
                <circle cx={center} cy={yScale.toPixel(average)} r={7} fill={color} />
              </>
            )}

            {plotType === 'box' && <BoxMark center={center} width={bodyWidth} summary={summary} color={color} yScale={yScale} />}
            {plotType === 'violin' && <ViolinMark center={center} width={bodyWidth} values={values} color={color} yScale={yScale} />}

            {(plotType === 'dot' || plotType === 'paired') && (
              <line x1={center - bodyWidth / 2} x2={center + bodyWidth / 2}
                y1={yScale.toPixel(average)} y2={yScale.toPixel(average)} stroke={color} strokeWidth={2.5} />
            )}

            {plotType === 'pointrange' && <circle cx={center} cy={yScale.toPixel(average)} r={5} fill={color} />}

            {style.errorBars !== 'none' && error > 0 &&
              !['box', 'violin', 'strip', 'swarm', 'paired'].includes(plotType) && (
              <g stroke={color} strokeWidth={1.5} fill="none">
                <line x1={center} x2={center} y1={yScale.toPixel(average - error)} y2={yScale.toPixel(average + error)} />
                <line x1={center - 7} x2={center + 7} y1={yScale.toPixel(average + error)} y2={yScale.toPixel(average + error)} />
                <line x1={center - 7} x2={center + 7} y1={yScale.toPixel(average - error)} y2={yScale.toPixel(average - error)} />
              </g>
            )}

            {(style.showPoints || alwaysShowPoints) && values.map((value, valueIndex) => {
              const rowIndex = findRowForValue(table, index, valueIndex);
              const isHot = highlightRow !== null && highlightRow === rowIndex;
              const offset = plotType === 'swarm'
                ? beeswarmOffset(values, valueIndex, yScale, style.pointSize)
                : plotType === 'paired'
                  ? 0
                  : jitter(index * 977 + valueIndex * 31 + 7, bodyWidth * 0.55);
              return (
                <Marker key={valueIndex} x={center + offset} y={yScale.toPixel(value)}
                  r={isHot ? style.pointSize + 2 : style.pointSize}
                  shape={shapeFor(index)}
                  fill={isHot ? '#111' : color}
                  fillOpacity={plotType === 'bar' ? 0.95 : 0.8}
                  stroke="#fff" strokeWidth={0.9}
                  onClick={(event) => { event.stopPropagation(); onPickRow?.(rowIndex, index); }}>
                  <title>{`${group.column.name} · row ${rowIndex + 1} · ${value}`}</title>
                </Marker>
              );
            })}
          </g>
        );
      })}

      <SignificanceBrackets comparisons={comparisons} centerOf={centerOf} groups={groups}
        errorFor={errorFor} yScale={yScale} plotTop={plotTop} font={font} />

      <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="#333" strokeWidth={1} />
      {groups.map((group, index) => (
        <text key={group.column.id} x={centerOf(index)} y={plotBottom + 20}
          textAnchor="middle" fontSize={font} fill="#333">
          {group.column.name}
        </text>
      ))}
      <XLabelText {...shared} x={(plotLeft + plotRight) / 2} y={xLabelY} />
    </>
  );
}

/**
 * A text element that can be selected and edited on the figure itself.
 * While editing it swaps to an HTML input inside a foreignObject; the export
 * path strips foreignObject so a mid-edit export never carries a form control.
 */
function EditableText({
  value, placeholder, fallback, x, y, anchor, fontSize, fontWeight, fill, transform,
  kind, selected, editing, onSelect, onEditText, onFinishEdit, boxWidth,
}: any) {
  const isSelected = selected?.kind === kind;
  const isEditing = editing?.kind === kind;
  // A fallback (the X column's own name, say) is real content and is exported;
  // a placeholder is only a hint about where to click.
  const effective = value || fallback || '';
  const shown = effective || placeholder;

  if (isEditing) {
    return (
      <foreignObject x={x - (anchor === 'middle' ? boxWidth / 2 : 4)} y={y - fontSize - 5}
        width={boxWidth} height={fontSize + 16} transform={transform}>
        <input
          autoFocus
          defaultValue={value}
          placeholder={placeholder}
          // Select the existing text so typing replaces the label, which is
          // what clicking straight onto a title implies.
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onEditText?.(event.target.value)}
          onBlur={() => onFinishEdit?.()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') onFinishEdit?.();
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
          style={{
            width: '100%', boxSizing: 'border-box',
            fontSize: `${fontSize}px`, fontWeight: fontWeight ?? 400, fontFamily: 'inherit',
            border: '1px solid #0C6259', borderRadius: 3, padding: '1px 4px', background: '#fff',
            textAlign: anchor === 'middle' ? 'center' : 'left',
          }}
        />
      </foreignObject>
    );
  }

  const boxLeft = anchor === 'middle' ? x - boxWidth / 2 : x - 4;
  const boxSpan = anchor === 'middle' ? boxWidth : Math.max(44, shown.length * fontSize * 0.62) + 8;

  // A placeholder is an editing affordance, not part of the figure. It is drawn
  // only where the figure can actually be clicked, and is tagged so the export
  // path can strip it: nobody wants "X axis label" in a submitted figure.
  const isPlaceholder = !effective;
  if (isPlaceholder && !onSelect) return null;

  return (
    <g transform={transform} style={{ cursor: onSelect ? 'text' : 'default' }}
      onClick={(event) => { if (!onSelect) return; event.stopPropagation(); onSelect({ kind }); }}>
      {isSelected && (
        <rect x={boxLeft} y={y - fontSize - 3} width={boxSpan} height={fontSize + 9}
          fill="#0C625914" stroke="#0C6259" strokeWidth={1} strokeDasharray="3 2" rx={3} />
      )}
      <text x={x} y={y} textAnchor={anchor} fontSize={fontSize} fontWeight={fontWeight}
        fill={isPlaceholder ? '#A6B2AF' : fill}
        data-placeholder={isPlaceholder ? 'true' : undefined}>
        {shown}
      </text>
    </g>
  );
}

function TitleText(props: any) {
  const { figure, plotLeft, selected, editing, onSelect, onEditText, onFinishEdit } = props;
  return (
    <EditableText
      kind="title" value={figure.style.title} placeholder={figure.name}
      x={plotLeft} y={22} anchor="start"
      fontSize={figure.style.fontSize + 3} fontWeight={600} fill="#111" boxWidth={280}
      selected={selected} editing={editing}
      onSelect={onSelect} onEditText={onEditText} onFinishEdit={onFinishEdit}
    />
  );
}

function XLabelText(props: any) {
  const { figure, x, y, fallbackLabel, selected, editing, onSelect, onEditText, onFinishEdit } = props;
  return (
    <EditableText
      kind="xLabel" value={figure.style.xLabel} placeholder="X axis label"
      fallback={fallbackLabel}
      x={x} y={y} anchor="middle"
      fontSize={figure.style.fontSize} fontWeight={400} fill="#555" boxWidth={220}
      selected={selected} editing={editing}
      onSelect={onSelect} onEditText={onEditText} onFinishEdit={onFinishEdit}
    />
  );
}

function Grid({ style, xTicks, yTicks, xScale, yScale, plotLeft, plotRight, plotTop, plotBottom }: any) {
  const showHorizontal = style.grid === 'horizontal' || style.grid === 'both';
  const showVertical = style.grid === 'vertical' || style.grid === 'both';
  return (
    <g>
      {style.frame && (
        <rect x={plotLeft} y={plotTop} width={plotRight - plotLeft} height={plotBottom - plotTop}
          fill="none" stroke="#C9D3D1" strokeWidth={1} />
      )}
      {showHorizontal && yTicks.map((tick: number) => (
        <line key={`h${tick}`} x1={plotLeft} x2={plotRight}
          y1={yScale.toPixel(tick)} y2={yScale.toPixel(tick)} stroke="#E4E8E7" strokeWidth={1} />
      ))}
      {showVertical && xScale && xTicks.map((tick: number) => (
        <line key={`v${tick}`} x1={xScale.toPixel(tick)} x2={xScale.toPixel(tick)}
          y1={plotTop} y2={plotBottom} stroke="#E4E8E7" strokeWidth={1} />
      ))}
    </g>
  );
}

function YAxis(props: any) {
  const { ticks, yScale, plotLeft, plotTop, plotBottom, font, figure, fallbackLabel, selected, editing, onSelect, onEditText, onFinishEdit } = props;
  return (
    <g>
      {ticks.map((tick: number) => (
        <g key={tick}>
          <line x1={plotLeft - 4} x2={plotLeft} y1={yScale.toPixel(tick)} y2={yScale.toPixel(tick)} stroke="#333" />
          <text x={plotLeft - 9} y={yScale.toPixel(tick) + 4} textAnchor="end" fontSize={font - 1} fill="#555">
            {formatTick(tick)}
          </text>
        </g>
      ))}
      <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} stroke="#333" strokeWidth={1} />
      <EditableText
        kind="yLabel" value={figure.style.yLabel} placeholder="Y axis label"
        fallback={fallbackLabel}
        x={0} y={0} anchor="middle"
        transform={`translate(16 ${(plotTop + plotBottom) / 2}) rotate(-90)`}
        fontSize={font} fontWeight={400} fill="#555" boxWidth={220}
        selected={selected} editing={editing}
        onSelect={onSelect} onEditText={onEditText} onFinishEdit={onFinishEdit}
      />
    </g>
  );
}

function XAxisNumeric(props: any) {
  const { ticks, xScale, plotLeft, plotRight, plotBottom, height, font, xLabelY } = props;
  return (
    <g>
      <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="#333" />
      {ticks.map((tick: number) => (
        <g key={tick}>
          <line x1={xScale.toPixel(tick)} x2={xScale.toPixel(tick)} y1={plotBottom} y2={plotBottom + 4} stroke="#333" />
          <text x={xScale.toPixel(tick)} y={plotBottom + 18} textAnchor="middle" fontSize={font - 1} fill="#555">
            {formatTick(tick)}
          </text>
        </g>
      ))}
      <XLabelText {...props} x={(plotLeft + plotRight) / 2} y={xLabelY ?? height - 12} />
    </g>
  );
}

function BoxMark({ center, width, summary, color, yScale }: any) {
  const { q1, q3, median, min, max } = summary;
  if (![q1, q3, median].every(Number.isFinite)) return null;
  return (
    <g stroke={color} strokeWidth={1.5} fill="none">
      <line x1={center} x2={center} y1={yScale.toPixel(min)} y2={yScale.toPixel(q1)} />
      <line x1={center} x2={center} y1={yScale.toPixel(q3)} y2={yScale.toPixel(max)} />
      <line x1={center - width / 4} x2={center + width / 4} y1={yScale.toPixel(min)} y2={yScale.toPixel(min)} />
      <line x1={center - width / 4} x2={center + width / 4} y1={yScale.toPixel(max)} y2={yScale.toPixel(max)} />
      <rect x={center - width / 2} y={yScale.toPixel(q3)} width={width}
        height={Math.max(1, yScale.toPixel(q1) - yScale.toPixel(q3))} fill={color} fillOpacity={0.18} />
      <line x1={center - width / 2} x2={center + width / 2}
        y1={yScale.toPixel(median)} y2={yScale.toPixel(median)} strokeWidth={2.5} />
    </g>
  );
}

function kernelDensity(values: number[], at: number, bandwidth: number): number {
  return values.reduce((sum, value) => {
    const z = (at - value) / bandwidth;
    return sum + Math.exp(-0.5 * z * z);
  }, 0) / (values.length * bandwidth * Math.sqrt(2 * Math.PI));
}

/** Silverman's rule of thumb, floored so a degenerate sample still draws. */
function bandwidthFor(values: number[]): number {
  const sd = Math.sqrt(stats.variance(values));
  const spread = Math.max(...values) - Math.min(...values);
  const rule = 1.06 * (Number.isFinite(sd) && sd > 0 ? sd : spread / 4) * Math.pow(values.length, -0.2);
  return rule > 0 ? rule : (spread || 1) / 8;
}

function ViolinMark({ center, width, values, color, yScale }: any) {
  if (values.length < 3) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const steps = 40;
  const bandwidth = bandwidthFor(values);
  const points: { value: number; d: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const value = low + ((high - low) * i) / steps;
    points.push({ value, d: kernelDensity(values, value, bandwidth) });
  }
  const peak = Math.max(...points.map((point) => point.d)) || 1;
  const half = width / 2;
  const left = points.map((point) => `${center - (point.d / peak) * half},${yScale.toPixel(point.value)}`);
  const right = [...points].reverse().map((point) => `${center + (point.d / peak) * half},${yScale.toPixel(point.value)}`);
  return <polygon points={[...left, ...right].join(' ')} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.5} />;
}

/** Places tied points side by side instead of scattering them randomly. */
function beeswarmOffset(values: number[], index: number, yScale: Scale, pointSize: number): number {
  const y = yScale.toPixel(values[index]);
  let rank = 0;
  for (let i = 0; i < index; i += 1) {
    if (Math.abs(yScale.toPixel(values[i]) - y) < pointSize * 2) rank += 1;
  }
  return (rank % 2 === 0 ? 1 : -1) * Math.ceil(rank / 2) * pointSize * 2.1;
}

/** Joins each row across groups, for before/after designs. */
function PairedLines({ table, groups, centerOf, yScale }: any) {
  const indices = groups.map((group: any) => table.columns.findIndex((column: any) => column.id === group.column.id));
  return (
    <g>
      {table.rows.map((row: any[], rowIndex: number) => {
        const points: string[] = [];
        indices.forEach((columnIndex: number, position: number) => {
          const cell = row[columnIndex];
          const value = cell === null || cell === '' ? null : Number(cell);
          if (value !== null && Number.isFinite(value)) points.push(`${centerOf(position)},${yScale.toPixel(value)}`);
        });
        if (points.length < 2) return null;
        return <polyline key={rowIndex} points={points.join(' ')} fill="none" stroke="#9AA8A5" strokeWidth={1} />;
      })}
    </g>
  );
}

function DistributionPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font, selected, onSelect } = props;
  const style: FigureStyle = figure.style;
  const plotType: PlotType = figure.plotType;
  const columns = valueColumns(table);
  const series = columns
    .map((column, index) => ({ column, index, values: columnValues(table, column.id), color: colorFor(style, column.id, index) }))
    .filter((entry) => entry.values.length > 1);
  if (!series.length) return <EmptyPlot width={style.width} height={style.height} message="Enter at least two numbers in a column" />;

  const legend = style.showLegend && series.length > 1
    ? <Legend items={series.map((entry) => ({ label: entry.column.name, color: entry.color }))}
        placement={props.legendPlacement} font={font} />
    : null;
  if (plotType === 'qq') {
    const points = series.flatMap((entry) => {
      const sorted = [...entry.values].sort((a, b) => a - b);
      return sorted.map((value, i) => ({
        theoretical: normalQuantile((i + 0.5) / sorted.length),
        sample: value, color: entry.color, columnId: entry.column.id, index: entry.index,
      }));
    });
    const theoretical = points.map((point) => point.theoretical);
    const sample = points.map((point) => point.sample);
    const xScale = makeScale(Math.min(...theoretical), Math.max(...theoretical), plotLeft, plotRight);
    const yScale = makeScale(Math.min(...sample), Math.max(...sample), plotBottom, plotTop);
    const xTicks = niceTicks(xScale.min, xScale.max);
    const yTicks = niceTicks(yScale.min, yScale.max);

    // Reference line through the first and third quartiles, as R's qqline does.
    const sorted = [...series[0].values].sort((a, b) => a - b);
    const quantile = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
    const slope = (quantile(0.75) - quantile(0.25)) / (normalQuantile(0.75) - normalQuantile(0.25));
    const intercept = quantile(0.25) - slope * normalQuantile(0.25);

    return (
      <>
        <Grid style={style} xTicks={xTicks} yTicks={yTicks} xScale={xScale} yScale={yScale}
          plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
        <YAxis {...props} ticks={yTicks} yScale={yScale} />
        <XAxisNumeric {...props} ticks={xTicks} xScale={xScale} fallbackLabel="Normal quantile" />
        <line x1={xScale.toPixel(xScale.min)} y1={yScale.toPixel(intercept + slope * xScale.min)}
          x2={xScale.toPixel(xScale.max)} y2={yScale.toPixel(intercept + slope * xScale.max)}
          stroke="#999" strokeWidth={1.2} strokeDasharray="4 3" />
        {points.map((point, i) => (
          <circle key={i} cx={xScale.toPixel(point.theoretical)} cy={yScale.toPixel(point.sample)}
            r={style.pointSize} fill={point.color} fillOpacity={0.8} stroke="#fff" strokeWidth={0.7}
            style={{ cursor: 'pointer' }}
            onClick={(event) => { event.stopPropagation(); onSelect?.({ kind: 'series', columnId: point.columnId, index: point.index }); }} />
        ))}
        {legend}
      </>
    );
  }

  const allValues = series.flatMap((entry) => entry.values);
  const low = style.xMin ?? Math.min(...allValues);
  const high = style.xMax ?? Math.max(...allValues);
  const xScale = makeScale(low, high, plotLeft, plotRight);
  const xTicks = niceTicks(low, high);
  if (plotType === 'ecdf') {
    const yScale = makeScale(0, 1, plotBottom, plotTop);
    const yTicks = [0, 0.25, 0.5, 0.75, 1];
    return (
      <>
        <Grid style={style} xTicks={xTicks} yTicks={yTicks} xScale={xScale} yScale={yScale}
          plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
        <YAxis {...props} ticks={yTicks} yScale={yScale} />
        <XAxisNumeric {...props} ticks={xTicks} xScale={xScale} fallbackLabel="Value" />
        {series.map((entry) => {
          const sorted = [...entry.values].sort((a, b) => a - b);
          const points: string[] = [`${xScale.toPixel(low)},${yScale.toPixel(0)}`];
          sorted.forEach((value, i) => {
            points.push(`${xScale.toPixel(value)},${yScale.toPixel(i / sorted.length)}`);
            points.push(`${xScale.toPixel(value)},${yScale.toPixel((i + 1) / sorted.length)}`);
          });
          points.push(`${xScale.toPixel(high)},${yScale.toPixel(1)}`);
          const isSelected = selected?.kind === 'series' && selected.columnId === entry.column.id;
          return (
            <polyline key={entry.column.id} points={points.join(' ')} fill="none"
              stroke={entry.color} strokeWidth={isSelected ? 3.5 : 2} style={{ cursor: 'pointer' }}
              onClick={(event) => { event.stopPropagation(); onSelect?.({ kind: 'series', columnId: entry.column.id, index: entry.index }); }} />
          );
        })}
        {legend}
      </>
    );
  }
  const binCount = Math.max(3, Math.min(60, style.bins));
  const binWidth = (high - low) / binCount || 1;

  const histograms = series.map((entry) => {
    const counts = new Array(binCount).fill(0);
    entry.values.forEach((value) => {
      const bin = Math.min(binCount - 1, Math.max(0, Math.floor((value - low) / binWidth)));
      counts[bin] += 1;
    });
    return { ...entry, counts };
  });

  const densities = series.map((entry) => {
    const bandwidth = bandwidthFor(entry.values);
    return {
      ...entry,
      curve: Array.from({ length: 120 }, (_, i) => {
        const at = low + ((high - low) * i) / 119;
        return { at, d: kernelDensity(entry.values, at, bandwidth) };
      }),
    };
  });

  const peak = plotType === 'histogram'
    ? Math.max(...histograms.flatMap((entry) => entry.counts), 1)
    : Math.max(...densities.flatMap((entry) => entry.curve.map((point) => point.d)), 1e-9);

  const yScale = makeScale(0, peak * 1.1, plotBottom, plotTop);
  const yTicks = niceTicks(0, peak * 1.1);

  return (
    <>
      <Grid style={style} xTicks={xTicks} yTicks={yTicks} xScale={xScale} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={yTicks} yScale={yScale} />
      <XAxisNumeric {...props} ticks={xTicks} xScale={xScale} fallbackLabel="Value" />

      {plotType === 'histogram' && histograms.map((entry) => (
        <g key={entry.column.id} style={{ cursor: 'pointer' }}
          onClick={(event) => { event.stopPropagation(); onSelect?.({ kind: 'series', columnId: entry.column.id, index: entry.index }); }}>
          {entry.counts.map((count: number, bin: number) => count ? (
            <rect key={bin}
              x={xScale.toPixel(low + bin * binWidth) + 0.5}
              y={yScale.toPixel(count)}
              width={Math.max(1, xScale.toPixel(low + (bin + 1) * binWidth) - xScale.toPixel(low + bin * binWidth) - 1)}
              height={yScale.toPixel(0) - yScale.toPixel(count)}
              fill={entry.color} fillOpacity={series.length > 1 ? 0.45 : 0.65}
              stroke={entry.color} strokeWidth={1} />
          ) : null)}
        </g>
      ))}

      {plotType === 'density' && densities.map((entry) => {
        const isSelected = selected?.kind === 'series' && selected.columnId === entry.column.id;
        const line = entry.curve.map((point) => `${xScale.toPixel(point.at)},${yScale.toPixel(point.d)}`);
        return (
          <g key={entry.column.id} style={{ cursor: 'pointer' }}
            onClick={(event) => { event.stopPropagation(); onSelect?.({ kind: 'series', columnId: entry.column.id, index: entry.index }); }}>
            <polygon points={`${xScale.toPixel(low)},${yScale.toPixel(0)} ${line.join(' ')} ${xScale.toPixel(high)},${yScale.toPixel(0)}`}
              fill={entry.color} fillOpacity={0.18} />
            <polyline points={line.join(' ')} fill="none" stroke={entry.color} strokeWidth={isSelected ? 3.5 : 2} />
          </g>
        );
      })}

      {legend}
    </>
  );
}

export interface LayoutPanel {
  figure: Figure;
  table: DataTable;
  result: AnalysisResult | null;
}

/**
 * Composes several figures into one publication panel.
 *
 * Each panel is a nested <svg> with its own viewport, so every figure keeps its
 * own coordinate system and nothing has to be re-laid-out. The composite
 * serialises and rasterises through exactly the same path as a single figure.
 */
export function LayoutFigure({
  panels, columns, gap, labelStyle, labelFor,
}: {
  panels: LayoutPanel[];
  columns: number;
  gap: number;
  labelStyle: string;
  labelFor: (index: number) => string;
}) {
  if (!panels.length) {
    return <EmptyPlot width={520} height={200} message="Add figures to this layout from the panel on the right" />;
  }

  const perRow = Math.max(1, columns);
  const rows = Math.ceil(panels.length / perRow);
  const labelRoom = labelStyle === 'none' ? 0 : 20;

  // Column widths and row heights follow the largest panel in each, so panels
  // stay aligned to a grid rather than overlapping.
  const columnWidths: number[] = [];
  const rowHeights: number[] = [];
  panels.forEach((panel, index) => {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, panel.figure.style.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, panel.figure.style.height + labelRoom);
  });

  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0) + gap * (perRow - 1);
  const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0) + gap * (rows - 1);

  const offsetX = (column: number) =>
    columnWidths.slice(0, column).reduce((sum, width) => sum + width + gap, 0);
  const offsetY = (row: number) =>
    rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0);

  return (
    <svg viewBox={`0 0 ${totalWidth} ${totalHeight}`} width={totalWidth} height={totalHeight}
      role="img" aria-label="Multi-panel figure" style={{ fontFamily: 'inherit' }}>
      <rect x={0} y={0} width={totalWidth} height={totalHeight} fill="#ffffff" />
      {panels.map((panel, index) => {
        const column = index % perRow;
        const row = Math.floor(index / perRow);
        const x = offsetX(column);
        const y = offsetY(row);
        const label = labelFor(index);
        return (
          <g key={`${panel.figure.id}-${index}`} transform={`translate(${x} ${y})`}>
            {label && (
              <text x={0} y={14} fontSize={17} fontWeight={700} fill="#111">{label}</text>
            )}
            <svg x={0} y={labelRoom} width={panel.figure.style.width} height={panel.figure.style.height}
              viewBox={`0 0 ${panel.figure.style.width} ${panel.figure.style.height}`}>
              <Plot table={panel.table} figure={panel.figure} result={panel.result} />
            </svg>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Kaplan-Meier step curves, one per group, with censoring ticks. Survival is
 * constant between event times and drops at each one, so the curve is drawn as
 * a staircase rather than interpolated - joining the points with straight lines
 * would imply a smooth decline that the estimator does not claim.
 */
/**
 * Difference against average, with the bias and the 95% limits of agreement.
 * Two methods can correlate perfectly and still disagree by a constant amount,
 * which is what this shows and a scatter of one against the other hides.
 */
function BlandAltmanPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font, height } = props;
  const style: FigureStyle = figure.style;
  const columns = valueColumns(table);
  if (columns.length < 2) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs two columns: the same subjects measured by two methods" />;
  }

  const first = columnValues(table, columns[0].id);
  const second = columnValues(table, columns[1].id);
  const n = Math.min(first.length, second.length);
  if (n < 3) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs at least three subjects measured by both methods" />;
  }

  const differences = Array.from({ length: n }, (_, i) => first[i] - second[i]);
  const averages = Array.from({ length: n }, (_, i) => (first[i] + second[i]) / 2);
  const bias = differences.reduce((sum, value) => sum + value, 0) / n;
  const sd = Math.sqrt(differences.reduce((sum, value) => sum + (value - bias) ** 2, 0) / (n - 1));
  const upper = bias + 1.96 * sd;
  const lower = bias - 1.96 * sd;

  const xLow = style.xMin ?? Math.min(...averages);
  const xHigh = style.xMax ?? Math.max(...averages);
  const pad = Math.max(sd * 0.6, (Math.max(...differences) - Math.min(...differences)) * 0.15, 1e-9);
  const yLow = style.yMin ?? Math.min(lower, ...differences) - pad;
  const yHigh = style.yMax ?? Math.max(upper, ...differences) + pad;

  const xScale = makeScale(xLow, xHigh, plotLeft, plotRight);
  const yScale = makeScale(yLow, yHigh, plotBottom, plotTop);
  const colour = colorFor(style, columns[0].id, 0);

  const band = (value: number, label: string, dash: string) => (
    <g key={label}>
      <line x1={plotLeft} x2={plotRight} y1={yScale.toPixel(value)} y2={yScale.toPixel(value)}
        stroke="#666" strokeWidth={1.2} strokeDasharray={dash} />
      <text x={plotRight - 2} y={yScale.toPixel(value) - 4} textAnchor="end" fontSize={font - 2} fill="#666">
        {label} {formatTick(Number(value.toFixed(4)))}
      </text>
    </g>
  );

  return (
    <>
      <Grid style={style} xTicks={niceTicks(xLow, xHigh)} yTicks={niceTicks(yLow, yHigh)}
        xScale={xScale} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={niceTicks(yLow, yHigh)} yScale={yScale} />
      <XAxisNumeric {...props} ticks={niceTicks(xLow, xHigh)} xScale={xScale}
        fallbackLabel={`Mean of ${columns[0].name} and ${columns[1].name}`} />

      {band(upper, '+1.96 SD', '6 3')}
      {band(bias, 'bias', 'none')}
      {band(lower, '−1.96 SD', '6 3')}

      {averages.map((value, i) => (
        <Marker key={i} x={xScale.toPixel(value)} y={yScale.toPixel(differences[i])}
          r={style.pointSize} shape={shapeFor(0)} fill={colour} fillOpacity={0.8}
          stroke="#fff" strokeWidth={0.8}>
          <title>{`subject ${i + 1}: difference ${differences[i].toFixed(4)}`}</title>
        </Marker>
      ))}
    </>
  );
}

/**
 * Forest plot: one row per study, its effect and confidence interval, with the
 * pooled estimate as a diamond. Expects the effect in the first column and its
 * standard error in the second.
 */
function ForestPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font } = props;
  const style: FigureStyle = figure.style;
  const columns = valueColumns(table);
  if (columns.length < 2) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs two columns: the effect, and its standard error" />;
  }

  const effects = columnValues(table, columns[0].id);
  const errors = columnValues(table, columns[1].id);
  const n = Math.min(effects.length, errors.length);
  if (n < 2 || errors.slice(0, n).some((value) => !(value > 0))) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs at least two studies, each with a standard error above zero" />;
  }

  const studies = Array.from({ length: n }, (_, i) => ({
    effect: effects[i],
    low: effects[i] - 1.96 * errors[i],
    high: effects[i] + 1.96 * errors[i],
    weight: 1 / errors[i] ** 2,
  }));
  const totalWeight = studies.reduce((sum, study) => sum + study.weight, 0);
  const pooled = studies.reduce((sum, study) => sum + study.weight * study.effect, 0) / totalWeight;
  const pooledError = Math.sqrt(1 / totalWeight);

  const xLow = style.xMin ?? Math.min(...studies.map((study) => study.low), pooled - 1.96 * pooledError);
  const xHigh = style.xMax ?? Math.max(...studies.map((study) => study.high), pooled + 1.96 * pooledError);
  const xScale = makeScale(xLow, xHigh, plotLeft, plotRight);

  const rows = n + 1;
  const step = (plotBottom - plotTop) / rows;
  const rowY = (index: number) => plotTop + step * (index + 0.5);
  const maxWeight = Math.max(...studies.map((study) => study.weight));

  return (
    <>
      <Grid style={style} xTicks={niceTicks(xLow, xHigh)} yTicks={[]} xScale={xScale} yScale={makeScale(0, 1, plotBottom, plotTop)}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />

      {/* No-effect line, wherever zero falls. */}
      {xLow < 0 && xHigh > 0 && (
        <line x1={xScale.toPixel(0)} x2={xScale.toPixel(0)} y1={plotTop} y2={plotBottom}
          stroke="#999" strokeWidth={1} strokeDasharray="4 3" />
      )}

      {studies.map((study, index) => {
        const y = rowY(index);
        const size = 3 + 7 * Math.sqrt(study.weight / maxWeight);
        const colour = colorFor(style, columns[0].id, 0);
        return (
          <g key={index}>
            <line x1={xScale.toPixel(study.low)} x2={xScale.toPixel(study.high)} y1={y} y2={y}
              stroke={colour} strokeWidth={1.4} />
            <rect x={xScale.toPixel(study.effect) - size} y={y - size}
              width={size * 2} height={size * 2} fill={colour}>
              <title>{`study ${index + 1}: ${study.effect.toFixed(4)} (${study.low.toFixed(4)} to ${study.high.toFixed(4)})`}</title>
            </rect>
            <text x={plotLeft - 8} y={y + 4} textAnchor="end" fontSize={font - 2} fill="#555">
              {index + 1}
            </text>
          </g>
        );
      })}

      {/* Pooled estimate. */}
      {(() => {
        const y = rowY(n);
        const left = xScale.toPixel(pooled - 1.96 * pooledError);
        const right = xScale.toPixel(pooled + 1.96 * pooledError);
        const middle = xScale.toPixel(pooled);
        return (
          <g>
            <polygon points={`${left},${y} ${middle},${y - 7} ${right},${y} ${middle},${y + 7}`}
              fill="#111">
              <title>{`pooled: ${pooled.toFixed(4)}`}</title>
            </polygon>
            <text x={plotLeft - 8} y={y + 4} textAnchor="end" fontSize={font - 2} fontWeight={600} fill="#333">
              pooled
            </text>
          </g>
        );
      })()}

      <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="#333" />
      {niceTicks(xLow, xHigh).map((tick) => (
        <text key={tick} x={xScale.toPixel(tick)} y={plotBottom + 18} textAnchor="middle"
          fontSize={font - 1} fill="#555">{formatTick(tick)}</text>
      ))}
      <XLabelText {...props} x={(plotLeft + plotRight) / 2} y={props.xLabelY} fallbackLabel="Effect" />
    </>
  );
}

function SurvivalPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, height, font, selected, onSelect } = props;
  const style: FigureStyle = figure.style;
  const subjects = survivalRows(table);
  if (subjects.length < 2) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Enter a time and a 0/1 event for at least two subjects" />;
  }

  const names = [...new Set(subjects.map((subject) => subject.group))];
  const palette = paletteFor(style.palette);
  const groups = names.map((name, index) => {
    const inGroup = subjects.filter((subject) => subject.group === name)
      .sort((a, b) => a.time - b.time);
    // Kaplan-Meier product-limit estimate.
    const steps: { time: number; survival: number }[] = [{ time: 0, survival: 1 }];
    let survival = 1;
    const eventTimes = [...new Set(inGroup.filter((s) => s.event === 1).map((s) => s.time))].sort((a, b) => a - b);
    for (const time of eventTimes) {
      const atRisk = inGroup.filter((subject) => subject.time >= time).length;
      const events = inGroup.filter((subject) => subject.time === time && subject.event === 1).length;
      if (atRisk > 0) survival *= 1 - events / atRisk;
      steps.push({ time, survival });
    }
    const censored = inGroup.filter((subject) => subject.event === 0);
    const survivalAt = (time: number) => {
      let value = 1;
      for (const step of steps) if (step.time <= time) value = step.survival;
      return value;
    };
    return {
      name, index,
      color: style.seriesColors[name] ?? palette[index % palette.length],
      steps,
      censored: censored.map((subject) => ({ time: subject.time, survival: survivalAt(subject.time) })),
      lastTime: Math.max(...inGroup.map((subject) => subject.time)),
    };
  });

  const maxTime = style.xMax ?? Math.max(...subjects.map((subject) => subject.time));
  const xScale = makeScale(style.xMin ?? 0, maxTime, plotLeft, plotRight);
  const yScale = makeScale(style.yMin ?? 0, style.yMax ?? 1, plotBottom, plotTop);
  const xTicks = niceTicks(xScale.min, maxTime);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <>
      <Grid style={style} xTicks={xTicks} yTicks={yTicks} xScale={xScale} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={yTicks} yScale={yScale} />
      <XAxisNumeric {...props} ticks={xTicks} xScale={xScale} fallbackLabel="Time" />

      {groups.map((group) => {
        const isSelected = selected?.kind === 'series' && selected.columnId === group.name;
        const points: string[] = [];
        group.steps.forEach((step, index) => {
          if (index > 0) points.push(`${xScale.toPixel(step.time)},${yScale.toPixel(group.steps[index - 1].survival)}`);
          points.push(`${xScale.toPixel(step.time)},${yScale.toPixel(step.survival)}`);
        });
        // Carry the curve flat to the last follow-up time.
        const final = group.steps[group.steps.length - 1];
        if (group.lastTime > final.time) {
          points.push(`${xScale.toPixel(group.lastTime)},${yScale.toPixel(final.survival)}`);
        }
        return (
          <g key={group.name} style={{ cursor: 'pointer' }}
            onClick={(event) => { event.stopPropagation(); onSelect?.({ kind: 'series', columnId: group.name, index: group.index }); }}>
            <polyline points={points.join(' ')} fill="none"
              stroke={group.color} strokeWidth={isSelected ? 3.5 : 2} />
            {group.censored.map((mark, index) => (
              <line key={index}
                x1={xScale.toPixel(mark.time)} x2={xScale.toPixel(mark.time)}
                y1={yScale.toPixel(mark.survival) - 5} y2={yScale.toPixel(mark.survival) + 5}
                stroke={group.color} strokeWidth={1.6}>
                <title>{`Censored at ${mark.time}`}</title>
              </line>
            ))}
          </g>
        );
      })}

      {style.showLegend && groups.length > 1 && (
        <Legend items={groups.map((group) => ({ label: group.name, color: group.color }))}
          placement={props.legendPlacement} font={font} />
      )}
    </>
  );
}

/** Green-white-red diverging ramp, symmetric about zero. */
function divergingColor(t: number): string {
  const clamped = Math.max(-1, Math.min(1, t));
  if (clamped >= 0) {
    const k = clamped;
    return `rgb(${Math.round(255 - 20 * k)},${Math.round(255 - 145 * k)},${Math.round(255 - 150 * k)})`;
  }
  const k = -clamped;
  return `rgb(${Math.round(255 - 60 * k)},${Math.round(255 - 145 * k)},${Math.round(255 - 190 * k)})`;
}

function MatrixPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font } = props;
  const style: FigureStyle = figure.style;
  const columns = valueColumns(table);

  if (figure.plotType === 'correlation') {
    const series = columns.map((column) => columnValues(table, column.id));
    const k = columns.length;
    if (k < 2) return <EmptyPlot width={style.width} height={style.height} message="A correlation matrix needs at least two columns" />;

    const cell = Math.min((plotRight - plotLeft) / k, (plotBottom - plotTop) / k);
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k; j += 1) {
        const n = Math.min(series[i].length, series[j].length);
        const a = series[i].slice(0, n);
        const b = series[j].slice(0, n);
        // Correlation is undefined when either column is constant, which is
        // common enough in a matrix that it is worth checking rather than
        // catching.
        const defined = n >= 3 && stats.variance(a) > 0 && stats.variance(b) > 0;
        const r = defined ? stats.pearsonCorrelation(a, b).r : NaN;
        cells.push(
          <g key={`${i}-${j}`}>
            <rect x={plotLeft + j * cell} y={plotTop + i * cell} width={cell - 1} height={cell - 1}
              fill={Number.isFinite(r) ? divergingColor(r) : '#EEE'} stroke="#fff" />
            <text x={plotLeft + j * cell + cell / 2} y={plotTop + i * cell + cell / 2 + 4}
              textAnchor="middle" fontSize={Math.min(font, cell / 3.2)}
              fill={Number.isFinite(r) && Math.abs(r) > 0.6 ? '#fff' : '#333'}>
              {Number.isFinite(r) ? r.toFixed(2) : '—'}
            </text>
          </g>
        );
      }
    }
    return (
      <>
        {cells}
        {columns.map((column, i) => (
          <text key={`row${column.id}`} x={plotLeft - 6} y={plotTop + i * cell + cell / 2 + 4}
            textAnchor="end" fontSize={font - 2} fill="#444">{column.name}</text>
        ))}
        {columns.map((column, j) => (
          <text key={`col${column.id}`} x={plotLeft + j * cell + cell / 2} y={plotTop + k * cell + 15}
            textAnchor="middle" fontSize={font - 2} fill="#444">{column.name}</text>
        ))}
      </>
    );
  }

  const rows = table.rows.length;
  const k = columns.length;
  if (!rows || !k) return <EmptyPlot width={style.width} height={style.height} message="Enter some numbers in the data table" />;
  const values = columns.flatMap((column) => columnValues(table, column.id));
  if (!values.length) return <EmptyPlot width={style.width} height={style.height} message="Enter some numbers in the data table" />;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const cellWidth = (plotRight - plotLeft) / k;
  const cellHeight = Math.min(28, (plotBottom - plotTop) / rows);

  return (
    <>
      {table.rows.map((row: any[], rowIndex: number) =>
        columns.map((column, columnIndex) => {
          const raw = row[table.columns.findIndex((entry: any) => entry.id === column.id)];
          const value = raw === null || raw === '' ? null : Number(raw);
          const t = value === null || !Number.isFinite(value) ? null : (2 * (value - low)) / (high - low || 1) - 1;
          return (
            <rect key={`${rowIndex}-${columnIndex}`}
              x={plotLeft + columnIndex * cellWidth} y={plotTop + rowIndex * cellHeight}
              width={cellWidth - 1} height={cellHeight - 1}
              fill={t === null ? '#F0F2F1' : divergingColor(t)} stroke="#fff">
              <title>{`${column.name} · row ${rowIndex + 1} · ${value ?? 'blank'}`}</title>
            </rect>
          );
        })
      )}
      {columns.map((column, columnIndex) => (
        <text key={column.id} x={plotLeft + columnIndex * cellWidth + cellWidth / 2}
          y={plotTop + rows * cellHeight + 15} textAnchor="middle" fontSize={font - 2} fill="#444">
          {column.name}
        </text>
      ))}
    </>
  );
}

function PiePlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font, selected, onSelect } = props;
  const style: FigureStyle = figure.style;
  const slices = valueColumns(table)
    .map((column, index) => ({
      column, index,
      value: columnValues(table, column.id).reduce((sum, value) => sum + value, 0),
      color: colorFor(style, column.id, index),
    }))
    .filter((slice) => slice.value > 0);

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (!total) return <EmptyPlot width={style.width} height={style.height} message="Pie charts need a positive total in each column" />;

  const cx = (plotLeft + plotRight) / 2;
  const cy = (plotTop + plotBottom) / 2;
  const radius = Math.min(plotRight - plotLeft, plotBottom - plotTop) / 2 - 6;
  const inner = figure.plotType === 'donut' ? radius * 0.55 : 0;

  let angle = -Math.PI / 2;
  const wedges = slices.map((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const at = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    const d = inner > 0
      ? `M ${at(radius, angle)} A ${radius} ${radius} 0 ${large} 1 ${at(radius, end)} L ${at(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${at(inner, angle)} Z`
      : `M ${cx},${cy} L ${at(radius, angle)} A ${radius} ${radius} 0 ${large} 1 ${at(radius, end)} Z`;
    const mid = angle + sweep / 2;
    const labelRadius = inner > 0 ? (radius + inner) / 2 : radius * 0.65;
    const isSelected = selected?.kind === 'series' && selected.columnId === slice.column.id;
    angle = end;
    return (
      <g key={slice.column.id} style={{ cursor: 'pointer' }}
        onClick={(event) => { event.stopPropagation(); onSelect?.({ kind: 'series', columnId: slice.column.id, index: slice.index }); }}>
        <path d={d} fill={slice.color} fillOpacity={0.85}
          stroke={isSelected ? '#111' : '#fff'} strokeWidth={isSelected ? 2.5 : 1.5} />
        <text x={cx + labelRadius * Math.cos(mid)} y={cy + labelRadius * Math.sin(mid) + 4}
          textAnchor="middle" fontSize={font - 1} fill="#fff" fontWeight={600}>
          {((slice.value / total) * 100).toFixed(0)}%
        </text>
      </g>
    );
  });

  return (
    <>
      {wedges}
      {style.showLegend && (
        <Legend items={slices.map((slice) => ({ label: slice.column.name, color: slice.color }))}
          placement={{ ...props.legendPlacement, atBottom: true, y: plotBottom + 30 }} font={font} />
      )}
    </>
  );
}

/**
 * Significance brackets, stacked so they never collide. Each bracket sits above
 * the tallest mark it spans, and above every bracket already drawn beneath it.
 */
function SignificanceBrackets({ comparisons, centerOf, groups, errorFor, yScale, plotTop, font }: any) {
  if (!comparisons.length) return null;

  const topOf = (index: number) => {
    const group = groups[index];
    if (!group?.summary) return yScale.toPixel(yScale.max);
    const top = Math.max(group.summary.max ?? -Infinity, (group.summary.mean ?? 0) + errorFor(group.summary, group.values));
    return yScale.toPixel(top);
  };

  // Shortest spans first, so nested comparisons stack tidily from the inside out.
  const ordered = [...comparisons]
    .filter((entry: any) => Number.isFinite(entry.pAdjusted))
    .sort((a: any, b: any) => Math.abs(a.indexA - a.indexB) - Math.abs(b.indexA - b.indexB))
    .slice(0, 8);

  const occupied: { from: number; to: number; y: number }[] = [];

  return (
    <g>
      {ordered.map((comparison: any, index: number) => {
        const from = Math.min(comparison.indexA, comparison.indexB);
        const to = Math.max(comparison.indexA, comparison.indexB);
        let y = Math.min(topOf(from), topOf(to)) - 16;
        for (const bracket of occupied) {
          if (!(bracket.to < from || bracket.from > to)) y = Math.min(y, bracket.y - 19);
        }
        y = Math.max(y, plotTop + 4);
        occupied.push({ from, to, y });

        const x1 = centerOf(from);
        const x2 = centerOf(to);
        const label = significanceStars(comparison.pAdjusted);

        return (
          <g key={index} stroke="#333" strokeWidth={1.2} fill="none">
            <path d={`M ${x1} ${y + 6} L ${x1} ${y} L ${x2} ${y} L ${x2} ${y + 6}`} />
            <text x={(x1 + x2) / 2} y={label === 'ns' ? y - 4 : y - 1} textAnchor="middle"
              fontSize={label === 'ns' ? font - 2 : font + 3} fill="#333" stroke="none">
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Right-aligned beside the title when it fits there, otherwise centred on its
 * own row beneath the plot. Either way it never overlaps the title.
 */
function Legend({ items, placement, font }: any) {
  const slot = Math.min(104, Math.max(64, (placement.right - placement.left) / items.length));
  const total = items.length * slot;
  const start = placement.atBottom
    ? (placement.left + placement.right) / 2 - total / 2
    : placement.right - total;
  return (
    <g>
      {items.map((item: any, index: number) => (
        <g key={item.label} transform={`translate(${start + index * slot} ${placement.y})`}>
          <Marker x={5} y={-4} r={4} shape={shapeFor(item.shapeIndex ?? index)} fill={item.color} />
          <text x={15} y={0} fontSize={font - 1} fill="#444">{item.label}</text>
        </g>
      ))}
    </g>
  );
}

/**
 * Picks the columns a model plot needs: a 0/1 outcome and a numeric predictor.
 * Which column is which is inferred rather than configured, so a figure keeps
 * working when its analysis is deleted.
 */
function binaryOutcomeAndPredictor(table: DataTable) {
  const columns = valueColumns(table);
  const values = columns.map((column) => columnValues(table, column.id));
  const outcomeIndex = values.findIndex(
    (column) => column.length > 3 && column.every((value) => value === 0 || value === 1) &&
      column.some((value) => value === 1) && column.some((value) => value === 0)
  );
  if (outcomeIndex < 0) return null;
  const predictorIndex = columns.findIndex((_, index) => index !== outcomeIndex);
  if (predictorIndex < 0) return null;

  const rows: { y: number; x: number }[] = [];
  const outcomeAt = columnIndexIn(table, columns[outcomeIndex].id);
  const predictorAt = columnIndexIn(table, columns[predictorIndex].id);
  for (const row of table.rows) {
    const y = Number(row[outcomeAt]);
    const x = Number(row[predictorAt]);
    if (row[outcomeAt] === null || row[predictorAt] === null) continue;
    if (!Number.isFinite(y) || !Number.isFinite(x)) continue;
    rows.push({ y, x });
  }
  return { outcome: columns[outcomeIndex], predictor: columns[predictorIndex], rows };
}

const columnIndexIn = (table: DataTable, columnId: string) =>
  table.columns.findIndex((column) => column.id === columnId);

/**
 * Observed 0/1 outcomes against a predictor, with the fitted logistic curve
 * through them. The points are nudged off the 0 and 1 lines so that ties are
 * visible rather than stacked into a single mark.
 */
function LogisticFitPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font } = props;
  const style: FigureStyle = figure.style;
  const picked = binaryOutcomeAndPredictor(table);
  if (!picked || picked.rows.length < 4) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs a column of 0s and 1s and a numeric predictor column" />;
  }

  let fit: any;
  try {
    fit = regression.logisticRegression([picked.rows.map((row) => row.x)], picked.rows.map((row) => row.y), [picked.predictor.name]);
  } catch (problem) {
    return <EmptyPlot width={style.width} height={style.height}
      message={problem instanceof Error ? problem.message : 'The model could not be fitted'} />;
  }

  const xs = picked.rows.map((row) => row.x);
  const xLow = style.xMin ?? Math.min(...xs);
  const xHigh = style.xMax ?? Math.max(...xs);
  const xScale = makeScale(xLow, xHigh, plotLeft, plotRight);
  const yScale = makeScale(0, 1, plotBottom, plotTop);
  const colour = colorFor(style, picked.outcome.id, 0);

  const [intercept, slope] = fit.terms.map((term: any) => term.estimate);
  const curve = Array.from({ length: 121 }, (_, i) => {
    const x = xLow + ((xHigh - xLow) * i) / 120;
    return `${xScale.toPixel(x)},${yScale.toPixel(1 / (1 + Math.exp(-(intercept + slope * x))))}`;
  }).join(' ');

  const half = -intercept / slope;

  return (
    <>
      <Grid style={style} xTicks={niceTicks(xLow, xHigh)} yTicks={[0, 0.25, 0.5, 0.75, 1]}
        xScale={xScale} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={[0, 0.25, 0.5, 0.75, 1]} yScale={yScale}
        fallbackLabel={`Probability of ${picked.outcome.name}`} />
      <XAxisNumeric {...props} ticks={niceTicks(xLow, xHigh)} xScale={xScale} fallbackLabel={picked.predictor.name} />

      {half > xLow && half < xHigh && (
        <g>
          <line x1={xScale.toPixel(half)} x2={xScale.toPixel(half)} y1={yScale.toPixel(0.5)} y2={plotBottom}
            stroke="#999" strokeWidth={1} strokeDasharray="4 3" />
          <text x={xScale.toPixel(half)} y={plotTop - 4} textAnchor="middle" fontSize={font - 2} fill="#666">
            50% at {formatTick(Number(half.toFixed(3)))}
          </text>
        </g>
      )}

      <polyline points={curve} fill="none" stroke={colour} strokeWidth={2} />

      {picked.rows.map((row, index) => (
        <Marker key={index} x={xScale.toPixel(row.x)}
          y={yScale.toPixel(row.y === 1 ? 0.97 : 0.03)}
          r={style.pointSize} shape={shapeFor(row.y)} fill={colour} fillOpacity={0.7}
          stroke="#fff" strokeWidth={0.8}>
          <title>{`${picked.predictor.name} ${row.x}, ${picked.outcome.name} ${row.y}`}</title>
        </Marker>
      ))}
    </>
  );
}

/**
 * ROC curve for a single predictor against a 0/1 outcome, with the area under
 * it. Thresholds are the observed values, so the curve is the empirical one
 * rather than a smoothed fit.
 */
function RocPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font } = props;
  const style: FigureStyle = figure.style;
  const picked = binaryOutcomeAndPredictor(table);
  if (!picked || picked.rows.length < 4) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs a column of 0s and 1s and a numeric predictor column" />;
  }

  const positives = picked.rows.filter((row) => row.y === 1).map((row) => row.x);
  const negatives = picked.rows.filter((row) => row.y === 0).map((row) => row.x);
  if (!positives.length || !negatives.length) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs at least one case and one control" />;
  }

  const thresholds = [Infinity, ...[...new Set(picked.rows.map((row) => row.x))].sort((a, b) => b - a)];
  const points = thresholds.map((threshold) => ({
    fpr: negatives.filter((value) => value >= threshold).length / negatives.length,
    tpr: positives.filter((value) => value >= threshold).length / positives.length,
  }));
  points.push({ fpr: 1, tpr: 1 });

  // Trapezoidal area under the empirical curve, which equals the Mann-Whitney
  // statistic scaled by the two group sizes.
  let area = 0;
  for (let i = 1; i < points.length; i += 1) {
    area += ((points[i].fpr - points[i - 1].fpr) * (points[i].tpr + points[i - 1].tpr)) / 2;
  }
  const auc = Math.max(area, 1 - area);

  const xScale = makeScale(0, 1, plotLeft, plotRight);
  const yScale = makeScale(0, 1, plotBottom, plotTop);
  const colour = colorFor(style, picked.predictor.id, 0);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <>
      <Grid style={style} xTicks={ticks} yTicks={ticks} xScale={xScale} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={ticks} yScale={yScale} fallbackLabel="Sensitivity" />
      <XAxisNumeric {...props} ticks={ticks} xScale={xScale} fallbackLabel="1 − specificity" />

      <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotTop}
        stroke="#BBB" strokeWidth={1} strokeDasharray="5 4" />
      <polyline fill="none" stroke={colour} strokeWidth={2}
        points={points.map((point) => `${xScale.toPixel(point.fpr)},${yScale.toPixel(point.tpr)}`).join(' ')} />

      <text x={plotRight - 6} y={plotBottom - 8} textAnchor="end" fontSize={font} fill="#444">
        AUC = {auc.toFixed(3)}
      </text>
    </>
  );
}

/**
 * The picture behind ANCOVA: each Y column is a group, the X column is the
 * covariate, and the lines share the pooled within-group slope. Parallel lines
 * are the assumption, so drawing them is also the way to check it.
 */
function AncovaPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, legendPlacement } = props;
  const style: FigureStyle = figure.style;
  const covariate = xColumn(table);
  const groups = valueColumns(table)
    .map((column, index) => ({ column, index, ...xyPairs(table, column.id) }))
    .filter((group) => group.x.length > 1);

  if (!covariate || groups.length < 2) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs an X column for the covariate and two or more Y columns, one per group" />;
  }

  let fit: any;
  try {
    fit = regression.ancova(groups.map((group) => group.y), groups.map((group) => group.x));
  } catch (problem) {
    return <EmptyPlot width={style.width} height={style.height}
      message={problem instanceof Error ? problem.message : 'The model could not be fitted'} />;
  }

  const allX = groups.flatMap((group) => group.x);
  const allY = groups.flatMap((group) => group.y);
  const xLow = style.xMin ?? Math.min(...allX);
  const xHigh = style.xMax ?? Math.max(...allX);
  const yPad = (Math.max(...allY) - Math.min(...allY)) * 0.08 || 1;
  const yLow = style.yMin ?? Math.min(...allY) - yPad;
  const yHigh = style.yMax ?? Math.max(...allY) + yPad;
  const xScale = makeScale(xLow, xHigh, plotLeft, plotRight);
  const yScale = makeScale(yLow, yHigh, plotBottom, plotTop);

  const grandX = allX.reduce((sum, value) => sum + value, 0) / allX.length;

  return (
    <>
      <Grid style={style} xTicks={niceTicks(xLow, xHigh)} yTicks={niceTicks(yLow, yHigh)}
        xScale={xScale} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={niceTicks(yLow, yHigh)} yScale={yScale} />
      <XAxisNumeric {...props} ticks={niceTicks(xLow, xHigh)} xScale={xScale} fallbackLabel={covariate.name} />

      <line x1={xScale.toPixel(grandX)} x2={xScale.toPixel(grandX)} y1={plotTop} y2={plotBottom}
        stroke="#CCC" strokeWidth={1} strokeDasharray="4 3" />

      {groups.map((group, index) => {
        const colour = colorFor(style, group.column.id, group.index);
        const adjusted = fit.adjustedMeans[index].adjusted;
        const at = (x: number) => adjusted + fit.slope * (x - grandX);
        return (
          <g key={group.column.id}>
            <line x1={xScale.toPixel(xLow)} y1={yScale.toPixel(at(xLow))}
              x2={xScale.toPixel(xHigh)} y2={yScale.toPixel(at(xHigh))}
              stroke={colour} strokeWidth={2} />
            {group.x.map((x, i) => (
              <Marker key={i} x={xScale.toPixel(x)} y={yScale.toPixel(group.y[i])}
                r={style.pointSize} shape={shapeFor(index)} fill={colour} fillOpacity={0.75}
                stroke="#fff" strokeWidth={0.8}>
                <title>{`${group.column.name}: ${covariate.name} ${x}, value ${group.y[i]}`}</title>
              </Marker>
            ))}
          </g>
        );
      })}

      {style.showLegend && (
        <Legend placement={legendPlacement} font={props.font}
          items={groups.map((group, index) => ({
            label: group.column.name,
            color: colorFor(style, group.column.id, group.index),
            shapeIndex: index,
          }))} />
      )}
    </>
  );
}

/**
 * Hazard ratios from a Cox model, one row per predictor, on a log scale so that
 * a doubling and a halving sit the same distance from no effect.
 */
function HazardPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font } = props;
  const style: FigureStyle = figure.style;
  const predictors = predictorCandidates(table).filter(
    (column) => columnValues(table, column.id).length > 0
  );
  if (!predictors.length) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Add a numeric predictor column to the survival table" />;
  }

  const timeAt = table.columns.findIndex((column: any) => column.role === 'time');
  const eventAt = table.columns.findIndex((column: any) => column.role === 'event');
  const predictorAt = predictors.map((column) => columnIndexIn(table, column.id));
  const rows: { time: number; event: number; x: number[] }[] = [];
  for (const row of table.rows) {
    const time = Number(row[timeAt]);
    const event = Number(row[eventAt]);
    const x = predictorAt.map((index) => Number(row[index]));
    if (row[timeAt] === null || row[eventAt] === null) continue;
    if (!Number.isFinite(time) || !Number.isFinite(event) || x.some((value) => !Number.isFinite(value))) continue;
    rows.push({ time, event: event === 1 ? 1 : 0, x });
  }

  let fit: any;
  try {
    fit = regression.coxRegression(rows, predictors.map((column) => column.name));
  } catch (problem) {
    return <EmptyPlot width={style.width} height={style.height}
      message={problem instanceof Error ? problem.message : 'The model could not be fitted'} />;
  }

  const terms = fit.terms.map((term: any) => ({
    label: term.term,
    ratio: term.hazardRatio,
    low: term.hazardRatioConfidenceInterval95[0],
    high: term.hazardRatioConfidenceInterval95[1],
    pValue: term.pValue,
  }));

  const logLow = Math.min(...terms.map((term: any) => Math.log(term.low)));
  const logHigh = Math.max(...terms.map((term: any) => Math.log(term.high)));
  const span = Math.max(Math.abs(logLow), Math.abs(logHigh)) * 1.15 || 1;
  const xScale = makeScale(-span, span, plotLeft, plotRight);
  const ticks = [-span, -span / 2, 0, span / 2, span];

  const step = (plotBottom - plotTop) / terms.length;
  const rowY = (index: number) => plotTop + step * (index + 0.5);

  return (
    <>
      <Grid style={style} xTicks={ticks} yTicks={[]} xScale={xScale} yScale={makeScale(0, 1, plotBottom, plotTop)}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />

      <line x1={xScale.toPixel(0)} x2={xScale.toPixel(0)} y1={plotTop} y2={plotBottom}
        stroke="#999" strokeWidth={1} strokeDasharray="4 3" />

      {terms.map((term: any, index: number) => {
        const colour = colorFor(style, predictors[index]?.id ?? term.label, index);
        return (
          <g key={term.label}>
            <line x1={xScale.toPixel(Math.log(term.low))} x2={xScale.toPixel(Math.log(term.high))}
              y1={rowY(index)} y2={rowY(index)} stroke={colour} strokeWidth={1.6} />
            <Marker x={xScale.toPixel(Math.log(term.ratio))} y={rowY(index)}
              r={style.pointSize + 1} shape={shapeFor(index)} fill={colour} stroke="#fff" strokeWidth={0.8}>
              <title>{`${term.label}: HR ${term.ratio.toFixed(3)} (${term.low.toFixed(3)} to ${term.high.toFixed(3)})`}</title>
            </Marker>
            <text x={plotLeft - 6} y={rowY(index) + font / 3} textAnchor="end" fontSize={font} fill="#333">
              {term.label}
            </text>
            <text x={plotRight - 2} y={rowY(index) - 6} textAnchor="end" fontSize={font - 2} fill="#666">
              {term.ratio.toFixed(2)} ({term.low.toFixed(2)}–{term.high.toFixed(2)}) {significanceStars(term.pValue)}
            </text>
          </g>
        );
      })}

      <g>
        <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="#333" />
        {ticks.map((tick) => (
          <text key={tick} x={xScale.toPixel(tick)} y={plotBottom + font + 4} textAnchor="middle" fontSize={font - 1} fill="#555">
            {formatTick(Number(Math.exp(tick).toPrecision(2)))}
          </text>
        ))}
        <text x={(plotLeft + plotRight) / 2} y={props.xLabelY} textAnchor="middle" fontSize={font} fill="#333">
          {style.xLabel || 'Hazard ratio (log scale)'}
        </text>
      </g>
    </>
  );
}

/**
 * Splits a table into a numeric matrix and, where one exists, the column of
 * text that names each row's group. Which column that is has to be inferred:
 * a figure outlives the analysis it was drawn beside.
 */
function matrixAndLabels(table: DataTable) {
  const numeric: { column: any; index: number }[] = [];
  let labels: { column: any; index: number } | null = null;

  table.columns.forEach((column, index) => {
    if (['ignore', 'time', 'event'].includes(column.role)) return;
    const values = table.rows.map((row) => row[index]).filter((value) => value !== null && value !== '');
    if (!values.length) return;
    const numericShare = values.filter((value) => Number.isFinite(Number(value))).length / values.length;
    if (numericShare > 0.8) numeric.push({ column, index });
    else if (!labels) labels = { column, index };
  });

  const rows: number[][] = [];
  const rowLabels: string[] = [];
  const sourceRows: number[] = [];
  table.rows.forEach((row, rowIndex) => {
    const values = numeric.map((entry) => {
      const cell = row[entry.index];
      return cell === null || cell === '' ? null : Number(cell);
    });
    if (values.some((value) => value === null || !Number.isFinite(value))) return;
    rows.push(values as number[]);
    rowLabels.push(labels ? String(row[(labels as any).index] ?? '') : `${rowIndex + 1}`);
    sourceRows.push(rowIndex);
  });

  return {
    rows,
    variables: numeric.map((entry) => entry.column),
    labelColumn: labels as any,
    rowLabels,
    sourceRows,
    groups: labels ? rowLabels : null,
  };
}

/**
 * Principal components, either as a score plot with the loadings drawn over it
 * or as the scree that says how many components are worth reading. Both are
 * the same fit, so they share a component.
 */
function PcaPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font, legendPlacement } = props;
  const style: FigureStyle = figure.style;
  const data = matrixAndLabels(table);

  if (data.variables.length < 2 || data.rows.length < 3) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs at least two numeric columns and three complete rows" />;
  }

  let fit: any;
  try {
    fit = multivariate.pca(data.rows, { scale: true });
  } catch (problem) {
    return <EmptyPlot width={style.width} height={style.height}
      message={problem instanceof Error ? problem.message : 'The components could not be found'} />;
  }

  if (figure.plotType === 'scree') {
    const shares = fit.explained;
    const step = (plotRight - plotLeft) / shares.length;
    // Fixed at 0 to 1 rather than to the tallest bar, so the cumulative curve
    // drawn over the bars can be read off the same axis.
    const yScale = makeScale(0, 1, plotBottom, plotTop);
    const ticks = [0, 0.25, 0.5, 0.75, 1];

    return (
      <>
        <Grid style={style} xTicks={[]} yTicks={ticks} xScale={makeScale(0, 1, plotLeft, plotRight)} yScale={yScale}
          plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
        <YAxis {...props} ticks={ticks} yScale={yScale} fallbackLabel="Share of the variance" />

        {/* The average eigenvalue: components above it carry more than their share. */}
        <line x1={plotLeft} x2={plotRight} y1={yScale.toPixel(1 / fit.variables)} y2={yScale.toPixel(1 / fit.variables)}
          stroke="#999" strokeWidth={1} strokeDasharray="4 3" />

        {shares.map((share: number, index: number) => (
          <g key={index}>
            <rect x={plotLeft + index * step + step * 0.15} y={yScale.toPixel(share)}
              width={step * 0.7} height={plotBottom - yScale.toPixel(share)}
              fill={colorFor(style, `pc${index}`, index)}>
              <title>{`PC${index + 1}: ${(share * 100).toFixed(1)}% of the variance`}</title>
            </rect>
            <text x={plotLeft + index * step + step / 2} y={plotBottom + font + 4}
              textAnchor="middle" fontSize={font - 1} fill="#555">PC{index + 1}</text>
          </g>
        ))}
        {/* Cumulative variance, on the same scale as the bars. */}
        <polyline fill="none" stroke="#555" strokeWidth={1.4}
          points={fit.cumulative.map((value: number, index: number) =>
            `${plotLeft + index * step + step / 2},${yScale.toPixel(value)}`).join(' ')} />
        {fit.cumulative.map((value: number, index: number) => (
          <circle key={index} cx={plotLeft + index * step + step / 2} cy={yScale.toPixel(value)}
            r={2.5} fill="#555" />
        ))}
        <text x={(plotLeft + plotRight) / 2} y={props.xLabelY} textAnchor="middle" fontSize={font} fill="#333">
          {style.xLabel || 'Component'}
        </text>
      </>
    );
  }

  const xs = fit.scores.map((row: number[]) => row[0]);
  const ys = fit.scores.map((row: number[]) => row[1]);
  const pad = (list: number[]) => (Math.max(...list) - Math.min(...list)) * 0.1 || 1;
  const xLow = style.xMin ?? Math.min(...xs) - pad(xs);
  const xHigh = style.xMax ?? Math.max(...xs) + pad(xs);
  const yLow = style.yMin ?? Math.min(...ys) - pad(ys);
  const yHigh = style.yMax ?? Math.max(...ys) + pad(ys);
  const xScale = makeScale(xLow, xHigh, plotLeft, plotRight);
  const yScale = makeScale(yLow, yHigh, plotBottom, plotTop);

  const groups = data.groups ? [...new Set(data.groups)] : ['All'];
  const groupIndex = (row: number) => (data.groups ? groups.indexOf(data.groups[row]) : 0);
  const arrowScale = Math.min(xHigh - xLow, yHigh - yLow) * 0.4;

  return (
    <>
      <Grid style={style} xTicks={niceTicks(xLow, xHigh)} yTicks={niceTicks(yLow, yHigh)}
        xScale={xScale} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={niceTicks(yLow, yHigh)} yScale={yScale}
        fallbackLabel={`PC2 (${(fit.explained[1] * 100).toFixed(1)}%)`} />
      <XAxisNumeric {...props} ticks={niceTicks(xLow, xHigh)} xScale={xScale}
        fallbackLabel={`PC1 (${(fit.explained[0] * 100).toFixed(1)}%)`} />

      {xLow < 0 && xHigh > 0 && (
        <line x1={xScale.toPixel(0)} x2={xScale.toPixel(0)} y1={plotTop} y2={plotBottom} stroke="#DDD" />
      )}
      {yLow < 0 && yHigh > 0 && (
        <line x1={plotLeft} x2={plotRight} y1={yScale.toPixel(0)} y2={yScale.toPixel(0)} stroke="#DDD" />
      )}

      {/* Loading arrows: which variables pull in which direction. Two variables
          that load almost identically would write their names on top of each
          other, so the labels are pushed apart afterwards. */}
      {(() => {
        const arrows = data.variables.map((variable: any, index: number) => {
          const dx = fit.loadings[index][0] * arrowScale;
          const dy = fit.loadings[index][1] * arrowScale;
          return {
            variable,
            tipX: xScale.toPixel(dx),
            tipY: yScale.toPixel(dy),
            labelX: xScale.toPixel(dx) + (dx >= 0 ? 4 : -4),
            labelY: yScale.toPixel(dy) + (dy >= 0 ? -4 : font),
            anchor: (dx >= 0 ? 'start' : 'end') as 'start' | 'end',
          };
        });

        const spacing = font + 1;
        ['start', 'end'].forEach((side) => {
          arrows.filter((arrow) => arrow.anchor === side)
            .sort((a, b) => a.labelY - b.labelY)
            .forEach((arrow, position, sorted) => {
              if (position === 0) return;
              const previous = sorted[position - 1].labelY;
              if (arrow.labelY - previous < spacing) arrow.labelY = previous + spacing;
            });
        });

        return arrows.map((arrow) => (
          <g key={arrow.variable.id}>
            <line x1={xScale.toPixel(0)} y1={yScale.toPixel(0)} x2={arrow.tipX} y2={arrow.tipY}
              stroke="#8A9895" strokeWidth={1.2} />
            <text x={arrow.labelX} y={arrow.labelY} textAnchor={arrow.anchor}
              fontSize={font - 2} fill="#6B7A77">{arrow.variable.name}</text>
          </g>
        ));
      })()}

      {fit.scores.map((row: number[], index: number) => {
        const which = groupIndex(index);
        return (
          <Marker key={index} x={xScale.toPixel(row[0])} y={yScale.toPixel(row[1])}
            r={style.pointSize + 0.5} shape={shapeFor(which)}
            fill={colorFor(style, groups[which], which)} fillOpacity={0.85}
            stroke="#fff" strokeWidth={0.8}>
            <title>{`${data.rowLabels[index]}: PC1 ${row[0].toFixed(2)}, PC2 ${row[1].toFixed(2)}`}</title>
          </Marker>
        );
      })}

      {style.showLegend && data.groups && (
        <Legend placement={legendPlacement} font={font}
          items={groups.map((name, index) => ({ label: name, color: colorFor(style, name, index), shapeIndex: index }))} />
      )}
    </>
  );
}

/**
 * A dendrogram, with bootstrap support written on each branch, or the same tree
 * drawn beside a heatmap so the rows are ordered by similarity rather than by
 * the order they were typed in.
 */
function ClusterPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font } = props;
  const style: FigureStyle = figure.style;
  const data = matrixAndLabels(table);

  if (data.variables.length < 2 || data.rows.length < 3) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs at least two numeric columns and three complete rows" />;
  }

  let tree: any;
  try {
    tree = multivariate.bootstrapSupport(data.rows, {
      metric: 'euclidean',
      linkage: 'average',
      replicates: 200,
      random: seededRandom(data.rows.flat()),
    });
  } catch (problem) {
    return <EmptyPlot width={style.width} height={style.height}
      message={problem instanceof Error ? problem.message : 'The tree could not be built'} />;
  }

  const n = tree.n;
  const heatmap = figure.plotType === 'clusterheatmap';
  // Leaf names are written to the right of the tree, so the tree has to stop
  // short of the edge by roughly the width of the longest one.
  const longest = data.rowLabels.reduce((worst, label) => Math.max(worst, label.length), 0);
  const labelWidth = Math.min(140, longest * (font - 2) * 0.58 + 8);
  const treeRight = heatmap
    ? plotLeft + (plotRight - plotLeft - labelWidth) * 0.34
    : plotRight - labelWidth;
  const maxHeight = Math.max(...tree.heights);
  const heightScale = makeScale(0, maxHeight, treeRight, plotLeft + 4);
  const leafStep = (plotBottom - plotTop) / n;
  const leafY = (leaf: number) => plotTop + leafStep * (tree.order.indexOf(leaf) + 0.5);

  // Each merge is drawn as a bracket. Positions are resolved bottom up, so a
  // node always knows where its children ended up.
  const nodeY: number[] = [];
  const branches: React.ReactNode[] = [];
  tree.merges.forEach((merge: number[], index: number) => {
    const [left, right] = merge;
    const yLeft = left < 0 ? leafY(-left - 1) : nodeY[left - 1];
    const yRight = right < 0 ? leafY(-right - 1) : nodeY[right - 1];
    const xLeft = left < 0 ? heightScale.toPixel(0) : heightScale.toPixel(tree.heights[left - 1]);
    const xRight = right < 0 ? heightScale.toPixel(0) : heightScale.toPixel(tree.heights[right - 1]);
    const x = heightScale.toPixel(tree.heights[index]);
    nodeY[index] = (yLeft + yRight) / 2;

    const support = tree.support[index];
    branches.push(
      <g key={index}>
        <path d={`M ${xLeft} ${yLeft} L ${x} ${yLeft} L ${x} ${yRight} L ${xRight} ${yRight}`}
          fill="none" stroke={support >= 0.7 ? '#3C6E63' : '#B9C4C1'} strokeWidth={support >= 0.7 ? 1.6 : 1.1} />
        {index >= n - 6 && (
          <text x={x - 3} y={nodeY[index] - 3} textAnchor="end" fontSize={font - 3}
            fill={support >= 0.7 ? '#3C6E63' : '#9AA8A5'}>
            {(support * 100).toFixed(0)}
          </text>
        )}
      </g>
    );
  });

  const labels = tree.order.map((leaf: number, position: number) => (
    <text key={leaf} x={heatmap ? treeRight + 3 : treeRight + 4}
      y={plotTop + leafStep * (position + 0.5) + 3}
      textAnchor="start" fontSize={Math.min(font - 2, leafStep)} fill="#555">
      {data.rowLabels[leaf]}
    </text>
  ));

  if (!heatmap) {
    return (
      <>
        {branches}
        {labels}
        <text x={(plotLeft + treeRight) / 2} y={props.xLabelY} textAnchor="middle" fontSize={font} fill="#333">
          {style.xLabel || 'Distance'}
        </text>
      </>
    );
  }

  // Heatmap panel, rows in the tree's order so neighbouring rows are similar.
  const gridLeft = treeRight + labelWidth;
  const cellWidth = (plotRight - gridLeft) / data.variables.length;
  const flat = data.rows.flat();
  const low = Math.min(...flat);
  const high = Math.max(...flat);

  return (
    <>
      {branches}
      {labels}
      {tree.order.map((leaf: number, position: number) =>
        data.variables.map((variable: any, columnIndex: number) => {
          const value = data.rows[leaf][columnIndex];
          const t = (2 * (value - low)) / (high - low || 1) - 1;
          return (
            <rect key={`${leaf}-${columnIndex}`}
              x={gridLeft + columnIndex * cellWidth} y={plotTop + position * leafStep}
              width={Math.max(cellWidth - 1, 1)} height={Math.max(leafStep - 1, 1)}
              fill={divergingColor(t)} stroke="#fff" strokeWidth={0.4}>
              <title>{`${data.rowLabels[leaf]} · ${variable.name} · ${value}`}</title>
            </rect>
          );
        })
      )}
      {data.variables.map((variable: any, columnIndex: number) => (
        <text key={variable.id} x={gridLeft + columnIndex * cellWidth + cellWidth / 2}
          y={plotTop + n * leafStep + 14} textAnchor="middle" fontSize={font - 2} fill="#444">
          {variable.name}
        </text>
      ))}
    </>
  );
}

/** A generator seeded from the data, so the same table always draws the same tree. */
function seededRandom(values: number[]) {
  let state = 2166136261;
  for (const value of values) state = Math.imul(state ^ (Math.round(value * 1e6) | 0), 16777619);
  state >>>= 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** PLS-DA scores: the projection that best separates the classes, by design. */
function PlsPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font, legendPlacement } = props;
  const style: FigureStyle = figure.style;
  const data = matrixAndLabels(table);

  if (!data.groups) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs a text column naming each sample's class" />;
  }
  if (data.variables.length < 2 || data.rows.length < 4) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs at least two numeric columns and four complete rows" />;
  }

  let fit: any;
  try {
    fit = multivariate.plsda(data.rows, data.groups, { components: 2 });
  } catch (problem) {
    return <EmptyPlot width={style.width} height={style.height}
      message={problem instanceof Error ? problem.message : 'The model could not be fitted'} />;
  }

  const xs = fit.scores.map((row: number[]) => row[0] ?? 0);
  const ys = fit.scores.map((row: number[]) => row[1] ?? 0);
  const pad = (list: number[]) => (Math.max(...list) - Math.min(...list)) * 0.12 || 1;
  const xLow = style.xMin ?? Math.min(...xs) - pad(xs);
  const xHigh = style.xMax ?? Math.max(...xs) + pad(xs);
  const yLow = style.yMin ?? Math.min(...ys) - pad(ys);
  const yHigh = style.yMax ?? Math.max(...ys) + pad(ys);
  const xScale = makeScale(xLow, xHigh, plotLeft, plotRight);
  const yScale = makeScale(yLow, yHigh, plotBottom, plotTop);
  const classes: string[] = fit.classes;

  return (
    <>
      <Grid style={style} xTicks={niceTicks(xLow, xHigh)} yTicks={niceTicks(yLow, yHigh)}
        xScale={xScale} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={niceTicks(yLow, yHigh)} yScale={yScale} fallbackLabel="Component 2" />
      <XAxisNumeric {...props} ticks={niceTicks(xLow, xHigh)} xScale={xScale} fallbackLabel="Component 1" />

      {fit.scores.map((row: number[], index: number) => {
        const which = classes.indexOf(data.groups![index]);
        return (
          <Marker key={index} x={xScale.toPixel(row[0] ?? 0)} y={yScale.toPixel(row[1] ?? 0)}
            r={style.pointSize + 0.5} shape={shapeFor(which)}
            fill={colorFor(style, classes[which], which)} fillOpacity={0.85}
            stroke="#fff" strokeWidth={0.8}>
            <title>{`${data.rowLabels[index]} · ${data.groups![index]}`}</title>
          </Marker>
        );
      })}

      {/* The number that matters is the cross-validated one, so it goes on the figure. */}
      <text x={plotRight - 4} y={plotTop + font} textAnchor="end" fontSize={font - 1}
        fill={fit.accuracy > fit.baseline ? '#3C6E63' : '#B4544A'}>
        {(fit.accuracy * 100).toFixed(0)}% correct, leave-one-out ({(fit.baseline * 100).toFixed(0)}% by guessing)
      </text>

      {style.showLegend && (
        <Legend placement={legendPlacement} font={font}
          items={classes.map((name, index) => ({ label: name, color: colorFor(style, name, index), shapeIndex: index }))} />
      )}
    </>
  );
}

/**
 * The picture ANOSIM's R is computed from: the rank dissimilarities within
 * groups against those between them. If the left box sits below the right one,
 * R is positive and the groups separate.
 */
function AnosimPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font } = props;
  const style: FigureStyle = figure.style;
  const data = matrixAndLabels(table);

  if (!data.groups) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs a text column naming each sample's group" />;
  }
  if (data.rows.length < 4 || data.variables.length < 1) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs at least four complete rows and one numeric column" />;
  }

  let result: any;
  try {
    result = multivariate.anosim(data.rows, data.groups, {
      permutations: 999,
      random: seededRandom(data.rows.flat()),
    });
  } catch (problem) {
    return <EmptyPlot width={style.width} height={style.height}
      message={problem instanceof Error ? problem.message : 'R could not be computed'} />;
  }

  const distance = multivariate.distanceMatrix(data.rows, 'euclidean');
  const flat: { value: number; within: boolean }[] = [];
  for (let i = 0; i < data.rows.length - 1; i += 1) {
    for (let j = i + 1; j < data.rows.length; j += 1) {
      flat.push({ value: distance[i][j], within: data.groups[i] === data.groups[j] });
    }
  }
  const order = flat.map((entry, index) => ({ ...entry, index })).sort((a, b) => a.value - b.value);
  order.forEach((entry, rank) => { flat[entry.index].value = rank + 1; });

  const boxes = [
    { label: 'Within groups', values: flat.filter((entry) => entry.within).map((entry) => entry.value) },
    { label: 'Between groups', values: flat.filter((entry) => !entry.within).map((entry) => entry.value) },
  ].filter((box) => box.values.length > 0);

  const yScale = makeScale(0, flat.length, plotBottom, plotTop);
  const ticks = niceTicks(0, flat.length);
  const step = (plotRight - plotLeft) / boxes.length;

  const quantile = (sorted: number[], q: number) => {
    const position = q * (sorted.length - 1);
    const low = Math.floor(position);
    const high = Math.min(low + 1, sorted.length - 1);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
  };

  return (
    <>
      <Grid style={style} xTicks={[]} yTicks={ticks} xScale={makeScale(0, 1, plotLeft, plotRight)} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={ticks} yScale={yScale} fallbackLabel="Rank of the dissimilarity" />

      {boxes.map((box, index) => {
        const sorted = box.values.slice().sort((a, b) => a - b);
        const median = quantile(sorted, 0.5);
        const lower = quantile(sorted, 0.25);
        const upper = quantile(sorted, 0.75);
        const centre = plotLeft + step * (index + 0.5);
        const width = Math.min(step * 0.5, 70);
        const colour = colorFor(style, box.label, index);
        return (
          <g key={box.label}>
            <line x1={centre} x2={centre} y1={yScale.toPixel(sorted[0])} y2={yScale.toPixel(sorted[sorted.length - 1])}
              stroke="#666" strokeWidth={1} />
            <rect x={centre - width / 2} y={yScale.toPixel(upper)}
              width={width} height={Math.max(yScale.toPixel(lower) - yScale.toPixel(upper), 1)}
              fill={colour} fillOpacity={0.55} stroke={colour} strokeWidth={1.4} />
            <line x1={centre - width / 2} x2={centre + width / 2}
              y1={yScale.toPixel(median)} y2={yScale.toPixel(median)} stroke="#2A3634" strokeWidth={1.8} />
            <text x={centre} y={plotBottom + font + 4} textAnchor="middle" fontSize={font - 1} fill="#555">
              {box.label}
            </text>
          </g>
        );
      })}

      <text x={plotRight - 4} y={plotTop + font} textAnchor="end" fontSize={font - 1} fill="#444">
        R = {result.statistic.toFixed(3)}, P = {result.pValue < 0.001 ? '< 0.001' : result.pValue.toFixed(3)}
      </text>
    </>
  );
}

/**
 * Mendelian randomisation: each instrument's effect on the exposure against its
 * effect on the outcome, with the two estimators drawn through them. An Egger
 * line that misses the origin is what pleiotropy looks like.
 */
function MendelianPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font, legendPlacement } = props;
  const style: FigureStyle = figure.style;
  const columns = valueColumns(table);
  if (columns.length < 3) {
    return <EmptyPlot width={style.width} height={style.height}
      message="Needs three columns: effect on the exposure, effect on the outcome, and the standard error of the second" />;
  }

  const indices = columns.slice(0, 3).map((column) => table.columns.findIndex((entry: any) => entry.id === column.id));
  const instruments: { exposureBeta: number; outcomeBeta: number; outcomeSe: number }[] = [];
  for (const row of table.rows) {
    const [bx, by, se] = indices.map((index) => Number(row[index]));
    if (indices.some((index) => row[index] === null || row[index] === '')) continue;
    if (![bx, by, se].every(Number.isFinite) || !(se > 0)) continue;
    instruments.push({ exposureBeta: bx, outcomeBeta: by, outcomeSe: se });
  }

  let fit: any;
  try {
    fit = designs.mendelianRandomization(instruments);
  } catch (problem) {
    return <EmptyPlot width={style.width} height={style.height}
      message={problem instanceof Error ? problem.message : 'The estimate could not be computed'} />;
  }

  const oriented = instruments.map((row) => (row.exposureBeta < 0
    ? { ...row, exposureBeta: -row.exposureBeta, outcomeBeta: -row.outcomeBeta } : row));
  const xs = oriented.map((row) => row.exposureBeta);
  const ys = oriented.map((row) => row.outcomeBeta);
  const xLow = style.xMin ?? Math.min(0, ...xs);
  const xHigh = style.xMax ?? Math.max(...xs) * 1.05;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.15 || 1;
  const yLow = style.yMin ?? Math.min(0, ...ys.map((value, i) => value - 1.96 * oriented[i].outcomeSe)) - yPad;
  const yHigh = style.yMax ?? Math.max(...ys.map((value, i) => value + 1.96 * oriented[i].outcomeSe)) + yPad;
  const xScale = makeScale(xLow, xHigh, plotLeft, plotRight);
  const yScale = makeScale(yLow, yHigh, plotBottom, plotTop);

  const lines = [
    { label: 'Inverse-variance weighted', intercept: 0, slope: fit.ivw.estimate, dash: 'none' },
    { label: 'MR-Egger', intercept: fit.egger.intercept, slope: fit.egger.slope, dash: '6 3' },
    { label: 'Weighted median', intercept: 0, slope: fit.weightedMedian, dash: '2 3' },
  ];

  return (
    <>
      <Grid style={style} xTicks={niceTicks(xLow, xHigh)} yTicks={niceTicks(yLow, yHigh)}
        xScale={xScale} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={niceTicks(yLow, yHigh)} yScale={yScale}
        fallbackLabel={`Effect on the outcome (${columns[1].name})`} />
      <XAxisNumeric {...props} ticks={niceTicks(xLow, xHigh)} xScale={xScale}
        fallbackLabel={`Effect on the exposure (${columns[0].name})`} />

      {yLow < 0 && yHigh > 0 && (
        <line x1={plotLeft} x2={plotRight} y1={yScale.toPixel(0)} y2={yScale.toPixel(0)} stroke="#DDD" />
      )}

      {lines.map((line, index) => (
        <line key={line.label}
          x1={xScale.toPixel(xLow)} y1={yScale.toPixel(line.intercept + line.slope * xLow)}
          x2={xScale.toPixel(xHigh)} y2={yScale.toPixel(line.intercept + line.slope * xHigh)}
          stroke={colorFor(style, line.label, index)} strokeWidth={1.8} strokeDasharray={line.dash} />
      ))}

      {oriented.map((row, index) => (
        <g key={index}>
          <line x1={xScale.toPixel(row.exposureBeta)} x2={xScale.toPixel(row.exposureBeta)}
            y1={yScale.toPixel(row.outcomeBeta - 1.96 * row.outcomeSe)}
            y2={yScale.toPixel(row.outcomeBeta + 1.96 * row.outcomeSe)}
            stroke="#8A9895" strokeWidth={1} />
          <Marker x={xScale.toPixel(row.exposureBeta)} y={yScale.toPixel(row.outcomeBeta)}
            r={style.pointSize} shape={shapeFor(0)} fill="#3C6E63" stroke="#fff" strokeWidth={0.8}>
            <title>{`instrument ${index + 1}: ratio estimate ${(row.outcomeBeta / row.exposureBeta).toFixed(3)}`}</title>
          </Marker>
        </g>
      ))}

      {style.showLegend && (
        <Legend placement={legendPlacement} font={font}
          items={lines.map((line, index) => ({ label: line.label, color: colorFor(style, line.label, index), shapeIndex: index }))} />
      )}
    </>
  );
}

/**
 * Every value in the table with the ones ROUT flags ringed, and the robust
 * centre and spread it judged them against drawn behind. Seeing which points
 * were flagged, and how far out they were, is the decision the method leaves
 * to you.
 */
function OutlierPlot(props: any) {
  const { table, figure, plotLeft, plotRight, plotTop, plotBottom, font, onPickRow } = props;
  const style: FigureStyle = figure.style;
  const columns = valueColumns(table);
  if (!columns.length) {
    return <EmptyPlot width={style.width} height={style.height} message="Enter some numbers in the data table" />;
  }

  const series = columns.map((column, index) => {
    const values = columnValues(table, column.id);
    let result: any = null;
    if (values.length >= 4) {
      try {
        result = designs.routOutliers(values, { q: 0.01 });
      } catch {
        result = null;
      }
    }
    return { column, index, values, result };
  });

  const everything = series.flatMap((entry) => entry.values);
  if (!everything.length) {
    return <EmptyPlot width={style.width} height={style.height} message="Enter some numbers in the data table" />;
  }
  const pad = (Math.max(...everything) - Math.min(...everything)) * 0.08 || 1;
  const yLow = style.yMin ?? Math.min(...everything) - pad;
  const yHigh = style.yMax ?? Math.max(...everything) + pad;
  const yScale = makeScale(yLow, yHigh, plotBottom, plotTop);
  const ticks = niceTicks(yLow, yHigh);
  const step = (plotRight - plotLeft) / series.length;

  return (
    <>
      <Grid style={style} xTicks={[]} yTicks={ticks} xScale={makeScale(0, 1, plotLeft, plotRight)} yScale={yScale}
        plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} />
      <YAxis {...props} ticks={ticks} yScale={yScale} />

      {series.map((entry) => {
        const centre = plotLeft + step * (entry.index + 0.5);
        const width = Math.min(step * 0.55, 90);
        const colour = colorFor(style, entry.column.id, entry.index);
        const flagged = new Set<number>(entry.result ? entry.result.outliers.map((outlier: any) => outlier.index) : []);

        return (
          <g key={entry.column.id}>
            {entry.result && (
              <>
                <rect x={centre - width / 2} y={yScale.toPixel(entry.result.centre + entry.result.robustScale)}
                  width={width}
                  height={Math.max(yScale.toPixel(entry.result.centre - entry.result.robustScale)
                    - yScale.toPixel(entry.result.centre + entry.result.robustScale), 1)}
                  fill={colour} fillOpacity={0.12} />
                <line x1={centre - width / 2} x2={centre + width / 2}
                  y1={yScale.toPixel(entry.result.centre)} y2={yScale.toPixel(entry.result.centre)}
                  stroke={colour} strokeWidth={1.6} />
              </>
            )}
            {entry.values.map((value, position) => {
              const jitter = ((position * 2654435761) % 1000) / 1000 - 0.5;
              const x = centre + jitter * width * 0.6;
              const isOutlier = flagged.has(position);
              return (
                <Marker key={position} x={x} y={yScale.toPixel(value)}
                  r={style.pointSize + (isOutlier ? 1.5 : 0)}
                  shape={shapeFor(entry.index)}
                  fill={isOutlier ? '#B4544A' : colour}
                  fillOpacity={isOutlier ? 1 : 0.6}
                  stroke={isOutlier ? '#7A2E27' : '#fff'} strokeWidth={isOutlier ? 1.6 : 0.7}
                  onClick={() => onPickRow?.(findRowForValue(table, entry.index, position), entry.index)}>
                  <title>{`${entry.column.name} · ${value}${isOutlier ? ' · flagged as an outlier' : ''}`}</title>
                </Marker>
              );
            })}
            <text x={centre} y={plotBottom + font + 4} textAnchor="middle" fontSize={font - 1} fill="#555">
              {entry.column.name}
            </text>
          </g>
        );
      })}
    </>
  );
}

function EmptyPlot({ width, height, message }: { width: number; height: number; message: string }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={message}>
      <rect x={0} y={0} width={width} height={height} fill="#fff" stroke="#DDE3E1" strokeDasharray="4 4" />
      <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={13} fill="#8A9895">{message}</text>
    </svg>
  );
}

/** Maps the nth numeric value in a column back to its row in the table. */
function findRowForValue(table: DataTable, columnIndex: number, valueIndex: number): number {
  const column = valueColumns(table)[columnIndex];
  if (!column) return 0;
  const actualIndex = table.columns.findIndex((entry) => entry.id === column.id);
  let seen = 0;
  for (let row = 0; row < table.rows.length; row += 1) {
    const cell = table.rows[row][actualIndex];
    if (cell === null || cell === undefined || cell === '') continue;
    if (!Number.isFinite(Number(cell))) continue;
    if (seen === valueIndex) return row;
    seen += 1;
  }
  return 0;
}
