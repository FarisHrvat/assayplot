// The analysis report as a PDF with real, selectable text.
//
// Figures go through svgToPdf, which rasterises: line art has to be pixel
// accurate and there is no text in it to select. A report is the opposite —
// it is all text, and a reviewer needs to search it and copy from it. So this
// lays the text out directly and uses Helvetica, one of the fourteen fonts
// every PDF reader already has, which keeps the file small and needs no font
// embedding.

import type { Report } from './report.ts';

const PAGE = { width: 595.28, height: 841.89 };   // A4 in points
const MARGIN = { left: 56, right: 56, top: 64, bottom: 56 };
const CONTENT = PAGE.width - MARGIN.left - MARGIN.right;

type Style = 'title' | 'heading' | 'sub' | 'body' | 'small' | 'mono' | 'rule';

interface Line {
  text: string;
  style: Style;
  /** Column offsets, for a table row. */
  columns?: { text: string; x: number; width: number }[];
  bold?: boolean;
}

const FONT_SIZE: Record<Style, number> = {
  title: 19, heading: 13, sub: 10.5, body: 9.6, small: 8.4, mono: 8.2, rule: 4,
};
const LEADING: Record<Style, number> = {
  title: 26, heading: 20, sub: 15, body: 13.4, small: 11.8, mono: 11.4, rule: 10,
};

/**
 * Helvetica's advance widths, in units of 1/1000 em, for the printable ASCII
 * range. Measuring properly is what stops a long column name from running off
 * the edge of the page.
 */
const WIDTHS = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,
];
const BOLD_WIDTHS = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,
];

function textWidth(text: string, size: number, bold: boolean): number {
  const table = bold ? BOLD_WIDTHS : WIDTHS;
  let total = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 32;
    total += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (total / 1000) * size;
}

/** Anything outside Latin-1 is transliterated: a PDF base font has no glyph. */
function toLatin1(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/×/g, 'x')
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    .replace(/±/g, '+/-')
    .replace(/α/g, 'alpha').replace(/β/g, 'beta')
    .replace(/χ/g, 'chi').replace(/μ/g, 'u')
    .replace(/²/g, '2').replace(/³/g, '3')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

const escape = (text: string) =>
  toLatin1(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Greedy wrap at the measured width. */
function wrap(text: string, size: number, bold: boolean, width: number): string[] {
  const words = toLatin1(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size, bold) <= width || !current) current = candidate;
    else { lines.push(current); current = word; }
  }
  lines.push(current);
  return lines;
}

/** Truncates with an ellipsis so a table cell never overruns its column. */
function fit(text: string, size: number, bold: boolean, width: number): string {
  const clean = toLatin1(text);
  if (textWidth(clean, size, bold) <= width) return clean;
  let cut = clean;
  while (cut.length > 1 && textWidth(`${cut}...`, size, bold) > width) cut = cut.slice(0, -1);
  return `${cut}...`;
}

function layout(report: Report): Line[] {
  const lines: Line[] = [];
  const push = (text: string, style: Style, bold = false) => lines.push({ text, style, bold });
  const paragraph = (text: string, style: Style = 'body', bold = false) => {
    for (const line of wrap(text, FONT_SIZE[style], bold, CONTENT)) push(line, style, bold);
  };

  const table = (headers: string[], rows: string[][], weights: number[]) => {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let x = 0;
    const geometry = weights.map((weight) => {
      const width = (weight / total) * CONTENT;
      const at = x;
      x += width;
      return { at, width };
    });
    const cells = (values: string[], bold: boolean, style: Style) => ({
      text: '', style, bold,
      columns: values.map((value, index) => ({
        text: fit(value, FONT_SIZE[style], bold, geometry[index].width - 6),
        x: geometry[index].at,
        width: geometry[index].width,
      })),
    });
    lines.push(cells(headers, true, 'small'));
    lines.push({ text: '', style: 'rule' });
    for (const row of rows) lines.push(cells(row, false, 'small'));
  };

  push(`${report.project} — analysis report`, 'title', true);
  paragraph(`Generated ${report.generatedAt} by ${report.engine}.`, 'small');
  lines.push({ text: '', style: 'rule' });

  push('Data', 'heading', true);
  paragraph(
    'Each table is listed with a SHA-256 of its contents. A reviewer can recompute it to '
    + 'confirm the numbers analysed here are the numbers supplied.',
    'small'
  );
  table(
    ['Table', 'Shape', 'Rows', 'Values', 'SHA-256'],
    report.tables.map((digest) => [
      digest.name, digest.shape, String(digest.rows), String(digest.values), digest.sha256,
    ]),
    [3, 1.6, 1, 1, 6]
  );

  push('Analyses', 'heading', true);
  for (const analysis of report.analyses) {
    push(`${analysis.name} — ${analysis.method}`, 'sub', true);
    paragraph(`On ${analysis.table}${analysis.columns.length ? `, columns: ${analysis.columns.join(', ')}` : ''}.`, 'small');

    if (analysis.error) {
      paragraph(`Could not run: ${analysis.error}`, 'body');
    } else {
      if (analysis.summary.length) {
        table(
          ['', 'Value', 'Note'],
          analysis.summary.map((entry) => [entry.label, entry.value, entry.note ?? '']),
          [3, 2, 5]
        );
      }
      if (analysis.comparisons.length) {
        table(
          ['Comparison', 'P', 'Adjusted P', ''],
          analysis.comparisons.map((entry) => [entry.pair, entry.raw, entry.adjusted, entry.stars]),
          [5, 2, 2, 1]
        );
      }
      paragraph(analysis.sentence, 'body');
    }
    for (const warning of analysis.warnings) paragraph(`! ${warning}`, 'small');
    lines.push({ text: '', style: 'rule' });
  }

  if (report.figures.length) {
    push('Figures', 'heading', true);
    table(
      ['Figure', 'From', 'Plot', 'Significance from'],
      report.figures.map((figure) => [figure.name, figure.table, figure.plot, figure.boundTo ?? '—']),
      [3, 3, 2, 3]
    );
  }

  return lines;
}

/** Splits laid-out lines into pages, keeping a heading with what follows it. */
function paginate(lines: Line[]): Line[][] {
  const usable = PAGE.height - MARGIN.top - MARGIN.bottom;
  const pages: Line[][] = [];
  let page: Line[] = [];
  let used = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const height = LEADING[line.style];
    // A heading at the foot of a page belongs at the head of the next one.
    const orphan =
      (line.style === 'heading' || line.style === 'sub') &&
      used + height + LEADING.body * 2 > usable;

    if (used + height > usable || orphan) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(line);
    used += height;
  }
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}

/** Builds the PDF byte stream. */
export function reportToPdf(report: Report): Uint8Array {
  const pages = paginate(layout(report));
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const write = (text: string) => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string) => {
    offsets[id] = length;
    write(`${id} 0 obj\n${body}\nendobj\n`);
  };

  const pageCount = pages.length;
  // 1 catalog, 2 pages, 3 regular font, 4 bold font, then a content stream and
  // a page object for each page.
  const contentId = (index: number) => 5 + index * 2;
  const pageId = (index: number) => 6 + index * 2;

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`
  );
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pages.forEach((page, index) => {
    let y = PAGE.height - MARGIN.top;
    const parts: string[] = [];

    for (const line of page) {
      const size = FONT_SIZE[line.style];
      y -= LEADING[line.style];

      if (line.style === 'rule' && !line.columns) {
        parts.push(
          `0.82 0.84 0.83 RG 0.6 w ${MARGIN.left} ${(y + 6).toFixed(2)} m ` +
          `${(PAGE.width - MARGIN.right).toFixed(2)} ${(y + 6).toFixed(2)} l S`
        );
        continue;
      }

      const font = line.bold ? '/F2' : '/F1';
      const grey = line.style === 'small' ? '0.32 0.34 0.33 rg' : '0.09 0.11 0.10 rg';

      if (line.columns) {
        for (const cell of line.columns) {
          if (!cell.text) continue;
          parts.push(
            `BT ${grey} ${font} ${size} Tf ` +
            `${(MARGIN.left + cell.x).toFixed(2)} ${y.toFixed(2)} Td (${escape(cell.text)}) Tj ET`
          );
        }
        continue;
      }

      if (!line.text) continue;
      parts.push(
        `BT ${grey} ${font} ${size} Tf ${MARGIN.left} ${y.toFixed(2)} Td (${escape(line.text)}) Tj ET`
      );
    }

    parts.push(
      `BT 0.55 0.58 0.57 rg /F1 8 Tf ${(PAGE.width - MARGIN.right - 40).toFixed(2)} ` +
      `${(MARGIN.bottom - 24).toFixed(2)} Td (${index + 1} of ${pageCount}) Tj ET`
    );

    const stream = parts.join('\n');
    object(contentId(index), `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
    object(
      pageId(index),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId(index)} 0 R >>`
    );
  });

  const total = 5 + pageCount * 2;
  const startxref = length;
  write(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id += 1) {
    write(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}
