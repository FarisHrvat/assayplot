// Figure rendering: a FigureSpec plus a table compiles to a scene, and the
// scene renders to real SVG elements.
//
// The same tree is what gets exported, so what is on screen is what lands in
// the manuscript. Marks carry a back-reference to the row they came from, which
// is what makes click-to-trace possible.

import React from 'react';
// @ts-ignore - statistics core is still plain JS.
import * as stats from '../core/stats.js';
import {
  type AnalysisResult,
  type DataTable,
  type Figure,
  columnValues,
  significanceStars,
  valueColumns,
  xColumn,
  xyPairs,
} from './model.ts';

export const PALETTES: Record<string, string[]> = {
  // Default: distinguishable in greyscale and under common colour-vision deficiency.
  statista: ['#0C6259', '#C2703D', '#3C5A99', '#7A5195', '#68843B', '#A33B4E'],
  greyscale: ['#222222', '#666666', '#999999', '#BBBBBB', '#444444', '#888888'],
  warm: ['#B3462F', '#D98E32', '#8C6D31', '#C25E7A', '#8A4B62', '#6E3B2E'],
  cool: ['#1F6F8B', '#2E9B8F', '#3D5A80', '#5E8C93', '#41668C', '#2C7A6B'],
};

export function paletteFor(name: string): string[] {
  return PALETTES[name] ?? PALETTES.statista;
}

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
function makeScale(min: number, max: number, pixelAtMin: number, pixelAtMax: number): Scale {
  const span = max - min || 1;
  return {
    min,
    max,
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

function formatTick(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 10000 || Math.abs(value) < 0.001) return value.toExponential(1);
  return String(Number(value.toFixed(6)));
}

export interface PlotProps {
  table: DataTable;
  figure: Figure;
  result?: AnalysisResult | null;
  /** Called with the source row index when a data mark is clicked. */
  onPickRow?: (rowIndex: number, columnIndex: number) => void;
  highlightRow?: number | null;
}

const MARGIN = { top: 34, right: 20, bottom: 54, left: 62 };

export function Plot({ table, figure, result, onPickRow, highlightRow }: PlotProps) {
  const { style, plotType } = figure;
  const width = style.width;
  const height = style.height;
  const plotLeft = MARGIN.left;
  const plotRight = width - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = height - MARGIN.bottom;
  const colors = paletteFor(style.palette);
  const font = style.fontSize;

  const isXy = table.shape === 'xy' && (plotType === 'scatter' || plotType === 'line');

  // -------------------------------------------------------------- XY plots
  if (isXy) {
    const x = xColumn(table);
    const series = valueColumns(table).map((column, index) => ({
      column,
      color: colors[index % colors.length],
      ...xyPairs(table, column.id),
    }));
    const allX = series.flatMap((s) => s.x);
    const allY = series.flatMap((s) => s.y);
    if (!allX.length) return <EmptyPlot width={width} height={height} message="Enter paired X and Y values" />;

    const xScale = makeScale(Math.min(...allX), Math.max(...allX), plotBottom, plotTop);
    const yLow = style.yMin ?? Math.min(...allY);
    const yHigh = style.yMax ?? Math.max(...allY);
    const pad = (yHigh - yLow) * 0.08 || 1;
    const yScale = makeScale(style.yMin ?? yLow - pad, style.yMax ?? yHigh + pad, plotBottom, plotTop);
    const xPixel = (value: number) =>
      plotLeft + ((value - xScale.min) / (xScale.max - xScale.min || 1)) * (plotRight - plotLeft);

    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={style.title || figure.name}
        style={{ fontFamily: 'inherit' }}
      >
        <Frame {...{ plotLeft, plotRight, plotTop, plotBottom, yScale, font, style, figure }} />
        <AxisX
          ticks={niceTicks(xScale.min, xScale.max)}
          toPixel={xPixel}
          plotBottom={plotBottom}
          font={font}
          label={style.xLabel || x?.name || 'X'}
          plotLeft={plotLeft}
          plotRight={plotRight}
        />
        {series.map((s) => (
          <g key={s.column.id}>
            {plotType === 'line' && s.x.length > 1 && (
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                points={s.x.map((value, index) => `${xPixel(value)},${yScale.toPixel(s.y[index])}`).join(' ')}
              />
            )}
            {s.x.map((value, index) => (
              <circle
                key={index}
                cx={xPixel(value)}
                cy={yScale.toPixel(s.y[index])}
                r={style.pointSize}
                fill={s.color}
                fillOpacity={0.85}
                stroke="#fff"
                strokeWidth={0.8}
              />
            ))}
          </g>
        ))}
        {series.length > 1 && (
          <Legend
            items={series.map((s) => ({ label: s.column.name, color: s.color }))}
            right={plotRight}
            y={plotTop - 14}
            font={font}
          />
        )}
      </svg>
    );
  }

  // ---------------------------------------------------------- group plots
  const columns = valueColumns(table);
  const groups = columns.map((column, index) => {
    const values = columnValues(table, column.id);
    const summary = values.length ? stats.descriptiveSummary(values) : null;
    return { column, values, summary, color: colors[index % colors.length], index };
  });
  const populated = groups.filter((group) => group.values.length > 0);
  if (!populated.length) {
    return <EmptyPlot width={width} height={height} message="Enter some numbers in the data table" />;
  }

  const errorFor = (summary: any): number => {
    if (!summary) return 0;
    if (style.errorBars === 'sd') return Number.isFinite(summary.sd) ? summary.sd : 0;
    if (style.errorBars === 'sem') return Number.isFinite(summary.sem) ? summary.sem : 0;
    if (style.errorBars === 'ci95') {
      const [low, high] = summary.confidenceInterval95 ?? [NaN, NaN];
      return Number.isFinite(low) ? (high - low) / 2 : 0;
    }
    return 0;
  };

  const allValues = populated.flatMap((group) => group.values);
  const errorTops = populated.map((g) => (g.summary?.mean ?? 0) + errorFor(g.summary));
  const errorBottoms = populated.map((g) => (g.summary?.mean ?? 0) - errorFor(g.summary));
  const dataLow = Math.min(...allValues, ...errorBottoms);
  const dataHigh = Math.max(...allValues, ...errorTops);

  const comparisons = (style.showSignificance && result?.comparisons) || [];
  const bracketRoom = comparisons.length ? Math.min(comparisons.length, 4) * 22 + 10 : 0;
  const span = dataHigh - dataLow || 1;
  const autoLow = plotType === 'bar' ? Math.min(0, dataLow - span * 0.05) : dataLow - span * 0.1;
  const autoHigh = dataHigh + span * 0.1;

  const yScale = makeScale(
    style.yMin ?? autoLow,
    style.yMax ?? autoHigh,
    plotBottom,
    plotTop + bracketRoom
  );

  const slotWidth = (plotRight - plotLeft) / groups.length;
  const centerOf = (index: number) => plotLeft + slotWidth * (index + 0.5);
  const bodyWidth = Math.min(slotWidth * 0.55, 64);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={style.title || figure.name}
      style={{ fontFamily: 'inherit' }}
    >
      <Frame {...{ plotLeft, plotRight, plotTop, plotBottom, yScale, font, style, figure }} />

      {groups.map((group) => {
        const { summary, values, color, index } = group;
        const center = centerOf(index);
        if (!summary) return null;
        const mean = summary.mean;
        const error = errorFor(summary);

        return (
          <g key={group.column.id}>
            {plotType === 'bar' && (
              <rect
                x={center - bodyWidth / 2}
                y={yScale.toPixel(Math.max(mean, yScale.min))}
                width={bodyWidth}
                height={Math.max(0, yScale.toPixel(yScale.min) - yScale.toPixel(mean))}
                fill={color}
                fillOpacity={0.22}
                stroke={color}
                strokeWidth={1.5}
              />
            )}

            {plotType === 'box' && <BoxMark center={center} width={bodyWidth} summary={summary} color={color} yScale={yScale} />}
            {plotType === 'violin' && <ViolinMark center={center} width={bodyWidth} values={values} color={color} yScale={yScale} />}

            {(plotType === 'dot' || plotType === 'line') && (
              <line
                x1={center - bodyWidth / 2}
                x2={center + bodyWidth / 2}
                y1={yScale.toPixel(mean)}
                y2={yScale.toPixel(mean)}
                stroke={color}
                strokeWidth={2.5}
              />
            )}

            {style.errorBars !== 'none' && error > 0 && plotType !== 'box' && plotType !== 'violin' && (
              <g stroke={color} strokeWidth={1.5} fill="none">
                <line x1={center} x2={center} y1={yScale.toPixel(mean - error)} y2={yScale.toPixel(mean + error)} />
                <line x1={center - 7} x2={center + 7} y1={yScale.toPixel(mean + error)} y2={yScale.toPixel(mean + error)} />
                <line x1={center - 7} x2={center + 7} y1={yScale.toPixel(mean - error)} y2={yScale.toPixel(mean - error)} />
              </g>
            )}

            {style.showPoints &&
              values.map((value, valueIndex) => {
                const rowIndex = findRowForValue(table, index, valueIndex);
                const isHot = highlightRow !== null && highlightRow === rowIndex;
                return (
                  <circle
                    key={valueIndex}
                    cx={center + jitter(index * 977 + valueIndex * 31 + 7, bodyWidth * 0.5)}
                    cy={yScale.toPixel(value)}
                    r={isHot ? style.pointSize + 2 : style.pointSize}
                    fill={isHot ? '#111' : color}
                    fillOpacity={plotType === 'bar' ? 0.95 : 0.8}
                    stroke="#fff"
                    strokeWidth={0.9}
                    style={{ cursor: onPickRow ? 'pointer' : 'default' }}
                    onClick={() => onPickRow?.(rowIndex, index)}
                  >
                    <title>{`${group.column.name} · row ${rowIndex + 1} · ${value}`}</title>
                  </circle>
                );
              })}
          </g>
        );
      })}

      <SignificanceBrackets
        comparisons={comparisons}
        centerOf={centerOf}
        groups={groups}
        errorFor={errorFor}
        yScale={yScale}
        plotTop={plotTop}
        font={font}
      />

      {/* category axis */}
      <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="#333" strokeWidth={1} />
      {groups.map((group, index) => (
        <text
          key={group.column.id}
          x={centerOf(index)}
          y={plotBottom + 20}
          textAnchor="middle"
          fontSize={font}
          fill="#333"
        >
          {group.column.name}
        </text>
      ))}
      {style.xLabel && (
        <text x={(plotLeft + plotRight) / 2} y={height - 10} textAnchor="middle" fontSize={font} fill="#555">
          {style.xLabel}
        </text>
      )}
    </svg>
  );
}

/** Maps the nth numeric value in a column back to its row in the table. */
function findRowForValue(table: DataTable, columnIndex: number, valueIndex: number): number {
  const column = valueColumns(table)[columnIndex];
  if (!column) return 0;
  const actualIndex = table.columns.findIndex((c) => c.id === column.id);
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

function Frame(props: any) {
  const { plotLeft, plotRight, plotTop, plotBottom, yScale, font, style, figure } = props;
  const ticks = niceTicks(yScale.min, yScale.max);
  return (
    <g>
      {(style.title || figure.name) && (
        <text x={plotLeft} y={18} fontSize={font + 2} fontWeight={600} fill="#111">
          {style.title || figure.name}
        </text>
      )}
      {ticks.map((tick: number) => (
        <g key={tick}>
          <line
            x1={plotLeft}
            x2={plotRight}
            y1={yScale.toPixel(tick)}
            y2={yScale.toPixel(tick)}
            stroke="#E4E8E7"
            strokeWidth={1}
          />
          <text
            x={plotLeft - 8}
            y={yScale.toPixel(tick) + 4}
            textAnchor="end"
            fontSize={font - 1}
            fill="#555"
          >
            {formatTick(tick)}
          </text>
        </g>
      ))}
      <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} stroke="#333" strokeWidth={1} />
      {style.yLabel && (
        <text
          transform={`rotate(-90) translate(${-(plotTop + plotBottom) / 2} ${14})`}
          textAnchor="middle"
          fontSize={font}
          fill="#555"
        >
          {style.yLabel}
        </text>
      )}
    </g>
  );
}

function AxisX({ ticks, toPixel, plotBottom, font, label, plotLeft, plotRight }: any) {
  return (
    <g>
      <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="#333" />
      {ticks.map((tick: number) => (
        <text key={tick} x={toPixel(tick)} y={plotBottom + 18} textAnchor="middle" fontSize={font - 1} fill="#555">
          {formatTick(tick)}
        </text>
      ))}
      <text x={(plotLeft + plotRight) / 2} y={plotBottom + 40} textAnchor="middle" fontSize={font} fill="#555">
        {label}
      </text>
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
      <rect
        x={center - width / 2}
        y={yScale.toPixel(q3)}
        width={width}
        height={Math.max(1, yScale.toPixel(q1) - yScale.toPixel(q3))}
        fill={color}
        fillOpacity={0.18}
      />
      <line x1={center - width / 2} x2={center + width / 2} y1={yScale.toPixel(median)} y2={yScale.toPixel(median)} strokeWidth={2.5} />
    </g>
  );
}

function ViolinMark({ center, width, values, color, yScale }: any) {
  if (values.length < 3) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const steps = 28;
  const spread = (high - low) || 1;
  const bandwidth = spread / 5;
  const density = (at: number) =>
    values.reduce((sum: number, value: number) => {
      const z = (at - value) / bandwidth;
      return sum + Math.exp(-0.5 * z * z);
    }, 0) / (values.length * bandwidth);

  const points: { value: number; d: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const value = low + (spread * i) / steps;
    points.push({ value, d: density(value) });
  }
  const peak = Math.max(...points.map((p) => p.d)) || 1;
  const half = width / 2;
  const left = points.map((p) => `${center - (p.d / peak) * half},${yScale.toPixel(p.value)}`);
  const right = [...points].reverse().map((p) => `${center + (p.d / peak) * half},${yScale.toPixel(p.value)}`);

  return <polygon points={[...left, ...right].join(' ')} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.5} />;
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
    const top = Math.max(
      group.summary.max ?? -Infinity,
      (group.summary.mean ?? 0) + errorFor(group.summary)
    );
    return yScale.toPixel(top);
  };

  // Shortest spans first, so nested comparisons stack tidily from the inside out.
  const ordered = [...comparisons]
    .filter((c: any) => Number.isFinite(c.pAdjusted))
    .sort((a: any, b: any) => Math.abs(a.indexA - a.indexB) - Math.abs(b.indexA - b.indexB))
    .slice(0, 6);

  const occupied: { from: number; to: number; y: number }[] = [];

  return (
    <g>
      {ordered.map((comparison: any, index: number) => {
        const from = Math.min(comparison.indexA, comparison.indexB);
        const to = Math.max(comparison.indexA, comparison.indexB);
        let y = Math.min(topOf(from), topOf(to)) - 16;
        for (const bracket of occupied) {
          const overlaps = !(bracket.to < from || bracket.from > to);
          if (overlaps) y = Math.min(y, bracket.y - 20);
        }
        y = Math.max(y, plotTop + 4);
        occupied.push({ from, to, y });

        const x1 = centerOf(from);
        const x2 = centerOf(to);
        const label = significanceStars(comparison.pAdjusted);

        return (
          <g key={index} stroke="#333" strokeWidth={1.2} fill="none">
            <path d={`M ${x1} ${y + 6} L ${x1} ${y} L ${x2} ${y} L ${x2} ${y + 6}`} />
            <text
              x={(x1 + x2) / 2}
              y={label === 'ns' ? y - 4 : y - 1}
              textAnchor="middle"
              fontSize={label === 'ns' ? font - 2 : font + 3}
              fill="#333"
              stroke="none"
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Right-aligned so it never collides with the title at the top left. */
function Legend({ items, right, y, font }: any) {
  const slot = 104;
  const start = right - items.length * slot;
  return (
    <g>
      {items.map((item: any, index: number) => (
        <g key={item.label} transform={`translate(${start + index * slot} ${y})`}>
          <circle cx={5} cy={-4} r={4} fill={item.color} />
          <text x={15} y={0} fontSize={font - 1} fill="#444">
            {item.label}
          </text>
        </g>
      ))}
    </g>
  );
}

function EmptyPlot({ width, height, message }: { width: number; height: number; message: string }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={message}>
      <rect x={0} y={0} width={width} height={height} fill="none" stroke="#DDE3E1" strokeDasharray="4 4" />
      <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={13} fill="#8A9895">
        {message}
      </text>
    </svg>
  );
}
