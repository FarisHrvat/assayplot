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
import {
  type AnalysisResult,
  type DataTable,
  type Figure,
  type FigureStyle,
  type PlotType,
  type TableShape,
  columnValues,
  survivalRows,
  significanceStars,
  valueColumns,
  xColumn,
  xyPairs,
} from './model.ts';

// ---------------------------------------------------------------------------
// palettes
// ---------------------------------------------------------------------------

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
  const palette = paletteFor(style.palette);
  return style.seriesColors[columnId] ?? palette[index % palette.length];
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

export type Selected =
  | { kind: 'title' }
  | { kind: 'xLabel' }
  | { kind: 'yLabel' }
  | { kind: 'series'; columnId: string; index: number }
  | null;

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// plot catalogue
// ---------------------------------------------------------------------------

export type PlotGroup = 'Compare groups' | 'Distribution' | 'X versus Y' | 'Matrix' | 'Parts of a whole' | 'Survival';

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
];

export const PLOT_GROUPS: PlotGroup[] = ['Compare groups', 'Distribution', 'X versus Y', 'Matrix', 'Parts of a whole', 'Survival'];

export function plotsForShape(shape: TableShape): PlotKind[] {
  // A Grouped table plots like a Column table: its value columns are the series.
  const effective = shape === 'grouped' ? 'column' : shape;
  return PLOT_KINDS.filter((kind) => kind.shape === effective);
}

const XY_PLOTS: PlotType[] = ['scatter', 'line', 'area', 'step', 'bubble'];
const DISTRIBUTION_PLOTS: PlotType[] = ['histogram', 'density', 'ecdf', 'qq'];

// ---------------------------------------------------------------------------
// the component
// ---------------------------------------------------------------------------

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

  const shared = { ...props, plotLeft, plotRight, plotTop, plotBottom, height, width, font, legendPlacement };

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
  if (plotType === 'heatmap' || plotType === 'correlation') return canvas(<MatrixPlot {...shared} />);
  if (plotType === 'pie' || plotType === 'donut') return canvas(<PiePlot {...shared} />);
  if (DISTRIBUTION_PLOTS.includes(plotType)) return canvas(<DistributionPlot {...shared} />);

  // ------------------------------------------------------------- XY plots
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

    const xScale = makeScale(xLow, xHigh, plotLeft, plotRight);
    const yScale = makeScale(yLow, yHigh, plotBottom, plotTop, style.logY);
    const xTicks = niceTicks(xLow, xHigh);
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
                  <circle key={i} cx={xScale.toPixel(value)} cy={yScale.toPixel(entry.y[i])}
                    r={isSelected ? radius + 1 : radius} fill={entry.color}
                    fillOpacity={plotType === 'bubble' ? 0.5 : 0.85} stroke="#fff" strokeWidth={0.8}>
                    <title>{`${entry.column.name}: (${value}, ${entry.y[i]})`}</title>
                  </circle>
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

  // ----------------------------------------------------------- group plots
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
                <circle key={valueIndex} cx={center + offset} cy={yScale.toPixel(value)}
                  r={isHot ? style.pointSize + 2 : style.pointSize}
                  fill={isHot ? '#111' : color}
                  fillOpacity={plotType === 'bar' ? 0.95 : 0.8}
                  stroke="#fff" strokeWidth={0.9}
                  onClick={(event) => { event.stopPropagation(); onPickRow?.(rowIndex, index); }}>
                  <title>{`${group.column.name} · row ${rowIndex + 1} · ${value}`}</title>
                </circle>
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
      <XLabelText {...shared} x={(plotLeft + plotRight) / 2} y={height - 12} />
    </>
  );
}

// ---------------------------------------------------------------------------
// editable text
// ---------------------------------------------------------------------------

/**
 * A text element that can be selected and edited on the figure itself.
 * While editing it swaps to an HTML input inside a foreignObject; the export
 * path strips foreignObject so a mid-edit export never carries a form control.
 */
function EditableText({
  value, placeholder, x, y, anchor, fontSize, fontWeight, fill, transform,
  kind, selected, editing, onSelect, onEditText, onFinishEdit, boxWidth,
}: any) {
  const isSelected = selected?.kind === kind;
  const isEditing = editing?.kind === kind;
  const shown = value || placeholder;

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

  return (
    <g transform={transform} style={{ cursor: 'text' }}
      onClick={(event) => { event.stopPropagation(); onSelect?.({ kind }); }}>
      {isSelected && (
        <rect x={boxLeft} y={y - fontSize - 3} width={boxSpan} height={fontSize + 9}
          fill="#0C625914" stroke="#0C6259" strokeWidth={1} strokeDasharray="3 2" rx={3} />
      )}
      <text x={x} y={y} textAnchor={anchor} fontSize={fontSize} fontWeight={fontWeight}
        fill={value ? fill : '#A6B2AF'}>
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
      kind="xLabel" value={figure.style.xLabel} placeholder={fallbackLabel || 'X axis label'}
      x={x} y={y} anchor="middle"
      fontSize={figure.style.fontSize} fontWeight={400} fill="#555" boxWidth={220}
      selected={selected} editing={editing}
      onSelect={onSelect} onEditText={onEditText} onFinishEdit={onFinishEdit}
    />
  );
}

// ---------------------------------------------------------------------------
// axes and grid
// ---------------------------------------------------------------------------

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
  const { ticks, yScale, plotLeft, plotTop, plotBottom, font, figure, selected, editing, onSelect, onEditText, onFinishEdit } = props;
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
  const { ticks, xScale, plotLeft, plotRight, plotBottom, height, font } = props;
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
      <XLabelText {...props} x={(plotLeft + plotRight) / 2} y={height - 12} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// marks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// distribution plots
// ---------------------------------------------------------------------------

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

  // ------------------------------------------------------------------ Q-Q
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

  // ----------------------------------------------------------------- ECDF
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

  // ---------------------------------------------------- histogram, density
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

// ---------------------------------------------------------------------------
// survival
// ---------------------------------------------------------------------------

/**
 * Kaplan-Meier step curves, one per group, with censoring ticks. Survival is
 * constant between event times and drops at each one, so the curve is drawn as
 * a staircase rather than interpolated - joining the points with straight lines
 * would imply a smooth decline that the estimator does not claim.
 */
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

// ---------------------------------------------------------------------------
// matrices
// ---------------------------------------------------------------------------

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
        let r = NaN;
        if (n >= 3) {
          try { r = stats.pearsonCorrelation(series[i].slice(0, n), series[j].slice(0, n)).r; } catch { r = NaN; }
        }
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

// ---------------------------------------------------------------------------
// parts of a whole
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// annotations
// ---------------------------------------------------------------------------

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
          <circle cx={5} cy={-4} r={4} fill={item.color} />
          <text x={15} y={0} fontSize={font - 1} fill="#444">{item.label}</text>
        </g>
      ))}
    </g>
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
