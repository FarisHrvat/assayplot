// Import and export.
//
// A project is a ZIP archive of pretty-printed JSON, so it stays greppable and
// diffable and a corrupted entry does not take the rest of the file with it.
// Migrations run forward only, from any earlier schema version to the current
// one.

import { zipSync, unzipSync, strToU8, strFromU8, zlibSync } from 'fflate';
import {
  type Cell,
  type DataTable,
  type Project,
  APP_VERSION,
  SCHEMA_VERSION,
  defaultStyle,
  newId,
} from './model.ts';

export function serializeProject(project: Project): Uint8Array {
  const pretty = (value: unknown) => strToU8(JSON.stringify(value, null, 2));

  const files: Record<string, Uint8Array> = {
    'manifest.json': pretty({
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      name: project.name,
      savedAt: new Date().toISOString(),
      counts: {
        tables: project.tables.length,
        analyses: project.analyses.length,
        figures: project.figures.length,
        layouts: project.layouts.length,
      },
    }),
    'README.txt': strToU8(
      'This is a AssayPlot project.\n\n' +
        'It is an ordinary ZIP archive of JSON files. You can open it with any\n' +
        'unzip tool and read your data without AssayPlot installed. Nothing here\n' +
        'is encrypted, obfuscated, or proprietary.\n'
    ),
  };

  for (const table of project.tables) files[`tables/${table.id}.json`] = pretty(table);
  for (const analysis of project.analyses) files[`analyses/${analysis.id}.json`] = pretty(analysis);
  for (const figure of project.figures) files[`figures/${figure.id}.json`] = pretty(figure);
  for (const layout of project.layouts) files[`layouts/${layout.id}.json`] = pretty(layout);

  return zipSync(files, { level: 6 });
}

export function deserializeProject(bytes: Uint8Array): Project {
  // Every ZIP starts "PK". Anything else is either the older prototype's plain
  // JSON project or not a project at all.
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    const text = strFromU8(bytes);
    if (!text.trimStart().startsWith('{')) {
      throw new Error('This file is not an AssayPlot project. A project is a .asp file; use Import data for spreadsheets.');
    }
    return migrate(JSON.parse(text));
  }

  const entries = unzipSync(bytes);

  const read = (path: string) => JSON.parse(strFromU8(entries[path]));
  if (!entries['manifest.json']) throw new Error('The project is missing its manifest.');
  const manifest = read('manifest.json');

  const collect = (prefix: string) =>
    Object.keys(entries)
      .filter((path) => path.startsWith(prefix) && path.endsWith('.json'))
      .sort()
      .map(read);

  return migrate({
    schemaVersion: manifest.schemaVersion,
    appVersion: manifest.appVersion,
    name: manifest.name ?? 'Untitled project',
    tables: collect('tables/'),
    analyses: collect('analyses/'),
    figures: collect('figures/'),
    layouts: collect('layouts/'),
  });
}

/**
 * Brings any earlier project forward to the current schema. Written forward
 * only: never mutate a file in place to fit an older reader.
 */
export function migrate(raw: any): Project {
  const version = Number(raw?.schemaVersion ?? 0);

  // v0-v2: the prototype's single flat table in long format.
  if (version > 0 && version < 3) {
    const rows: any[] = Array.isArray(raw?.data) ? raw.data : [];
    const groupKey = raw?.roles?.group ?? 'group';
    const valueKey = raw?.roles?.value ?? 'value';
    const groupNames = [...new Set(rows.map((row) => String(row?.[groupKey] ?? '')).filter(Boolean))];

    const columns = (groupNames.length ? groupNames : ['Group A']).map((name) => ({
      id: newId('col'),
      name,
      role: 'group' as const,
    }));
    const perGroup = columns.map((_, index) =>
      rows
        .filter((row) => String(row?.[groupKey] ?? '') === (groupNames[index] ?? ''))
        .map((row) => {
          const value = Number(row?.[valueKey]);
          return Number.isFinite(value) ? value : null;
        })
    );
    const depth = Math.max(1, ...perGroup.map((values) => values.length));
    const table: DataTable = {
      id: newId('tbl'),
      name: raw?.projectTitle ?? 'Imported data',
      shape: 'column',
      columns,
      rows: Array.from({ length: depth }, (_, rowIndex) =>
        perGroup.map((values) => (values[rowIndex] ?? null) as Cell)
      ),
    };
    return {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      name: raw?.projectTitle ?? 'Imported project',
      tables: [table],
      analyses: [],
      figures: [],
      layouts: [],
    };
  }

  // Current schema: fill in anything a newer field expects.
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: raw.appVersion ?? APP_VERSION,
    name: raw.name ?? 'Untitled project',
    tables: (raw.tables ?? []).map((table: any) => ({
      id: table.id ?? newId('tbl'),
      name: table.name ?? 'Data',
      shape: table.shape === 'xy' ? 'xy' : 'column',
      columns: (table.columns ?? []).map((column: any) => ({
        id: column.id ?? newId('col'),
        name: column.name ?? 'Column',
        role: column.role ?? 'group',
      })),
      rows: (table.rows ?? []).map((row: any[]) => row.map((cell) => (cell === undefined ? null : cell))),
    })),
    analyses: (raw.analyses ?? []).map((analysis: any) => ({
      id: analysis.id ?? newId('ana'),
      name: analysis.name ?? 'Analysis',
      tableId: analysis.tableId,
      method: analysis.method ?? 'descriptive',
      options: analysis.options ?? { correction: 'holm' },
    })),
    figures: (raw.figures ?? []).map((figure: any) => ({
      id: figure.id ?? newId('fig'),
      name: figure.name ?? 'Figure',
      tableId: figure.tableId,
      analysisId: figure.analysisId ?? null,
      plotType: figure.plotType ?? 'bar',
      style: defaultStyle(figure.style ?? {}),
    })),
    // Added in schema 5; older projects simply have none.
    layouts: (raw.layouts ?? []).map((layout: any) => ({
      id: layout.id ?? newId('lay'),
      name: layout.name ?? 'Layout',
      panels: Array.isArray(layout.panels) ? layout.panels : [],
      columns: Math.max(1, Number(layout.columns) || 2),
      labelStyle: ['A', 'a', '1', 'none'].includes(layout.labelStyle) ? layout.labelStyle : 'A',
      gap: Number.isFinite(Number(layout.gap)) ? Number(layout.gap) : 18,
      // Added in 0.7. A layout saved before free arrangement has none, and
      // stays on the grid until someone drags a panel.
      frames: Array.isArray(layout.frames)
        ? layout.frames.map((frame: any) =>
            frame && [frame.x, frame.y, frame.width, frame.height].every((value) => Number.isFinite(Number(value)))
              ? { x: Number(frame.x), y: Number(frame.y), width: Number(frame.width), height: Number(frame.height) }
              : null)
        : undefined,
    })),
  };
}

export type DecimalMark = '.' | ',';

export interface TextFormat {
  delimiter: string;
  decimal: DecimalMark;
}

const CANDIDATE_DELIMITERS = ['\t', ';', ',', '|'];

function splitOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) count += 1;
  }
  return count;
}

/**
 * Picks the delimiter that splits every line into the same number of fields.
 * Counting occurrences is not enough: a European file using ';' is full of
 * commas that are decimal marks, and would otherwise look comma-separated.
 */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  if (!lines.length) return ',';

  // Tried in order of how unambiguous each one is. A tab is never a decimal
  // mark or a thousands separator, a semicolon almost never is, and a comma is
  // both in half of Europe. The first candidate that splits every line the
  // same way wins, so a comma is only chosen when nothing better fits.
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => splitOutsideQuotes(line, delimiter));
    if (counts[0] > 0 && counts.every((count) => count === counts[0])) return delimiter;
  }

  // Nothing was consistent - a ragged file. Fall back to whichever appears most.
  let best = ',';
  let bestCount = 0;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const total = lines.reduce((sum, line) => sum + splitOutsideQuotes(line, delimiter), 0);
    if (total > bestCount) {
      bestCount = total;
      best = delimiter;
    }
  }
  return best;
}

/**
 * Works out whether numbers are written 1,234.56 or 1.234,56.
 *
 * Getting this wrong is not a cosmetic problem: read as US, the Italian "1,5"
 * becomes 15, and every value in the file is silently wrong by a factor of ten
 * or a hundred.
 */
export function detectDecimal(text: string, delimiter: string): DecimalMark {
  const fields = text
    .split(/\r?\n/)
    .slice(0, 200)
    .flatMap((line) => line.split(delimiter))
    .map((field) => field.trim().replace(/^"|"$/g, ''))
    .filter((field) => /^[+-]?[\d.,]+$/.test(field) && /\d/.test(field));

  let european = 0;
  let american = 0;

  for (const field of fields) {
    const lastComma = field.lastIndexOf(',');
    const lastDot = field.lastIndexOf('.');

    if (lastComma >= 0 && lastDot >= 0) {
      // Whichever comes last is the decimal mark.
      if (lastComma > lastDot) european += 2;
      else american += 2;
      continue;
    }
    if (lastComma >= 0) {
      const after = field.length - lastComma - 1;
      // Exactly three digits after a lone comma is ambiguous: 1,234 could be
      // either. Anything else is decisive.
      if (after !== 3) european += 1;
      continue;
    }
    if (lastDot >= 0) {
      const after = field.length - lastDot - 1;
      if (after !== 3) american += 1;
    }
  }

  // A semicolon-separated file is European by convention; it exists precisely
  // because the comma is taken.
  if (delimiter === ';' && european >= american) return ',';
  return european > american ? ',' : '.';
}

export function detectFormat(text: string): TextFormat {
  const delimiter = detectDelimiter(text);
  return { delimiter, decimal: detectDecimal(text, delimiter) };
}

/** Splits delimited text, honouring quoted fields and embedded delimiters. */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === delimiter) { row.push(field); field = ''; continue; }
    if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (character === '\r') continue;
    field += character;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((line) => line.some((cell) => cell.trim().length));
}

/** Reads one field, given which mark this file uses for the decimal point. */
export function parseNumber(text: string, decimal: DecimalMark): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const normalised = decimal === ','
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed.replace(/,/g, '');

  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(normalised)) return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

function toCell(text: string, decimal: DecimalMark): Cell {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = parseNumber(trimmed, decimal);
  return value === null ? trimmed : value;
}

/** Parses a clipboard payload into a rectangular block for paste. */
export function parseClipboard(text: string): Cell[][] {
  const trimmed = text.replace(/\s+$/, '');
  const { delimiter, decimal } = detectFormat(trimmed);
  return parseDelimited(trimmed, delimiter).map((row) => row.map((cell) => toCell(cell, decimal)));
}

/**
 * Builds a table from delimited text. The first row is treated as a header when
 * it is non-numeric, which is the case for nearly every file a lab exports.
 */
export function tableFromDelimited(text: string, name: string): DataTable {
  const { delimiter, decimal } = detectFormat(text);
  const rows = parseDelimited(text, delimiter);
  if (!rows.length) throw new Error('That file has no readable rows.');

  const firstRowIsHeader = rows[0].some(
    (cell) => cell.trim() && parseNumber(cell, decimal) === null
  );
  const header = firstRowIsHeader ? rows[0] : rows[0].map((_, index) => `Column ${index + 1}`);
  const body = firstRowIsHeader ? rows.slice(1) : rows;
  const width = Math.max(header.length, ...body.map((row) => row.length));

  const columns = Array.from({ length: width }, (_, index) => ({
    id: newId('col'),
    name: (header[index] ?? `Column ${index + 1}`).trim() || `Column ${index + 1}`,
    role: 'group' as const,
  }));

  return {
    id: newId('tbl'),
    name,
    shape: 'column',
    columns,
    rows: body.map((row) => Array.from({ length: width }, (_, index) => toCell(row[index] ?? '', decimal))),
  };
}

/**
 * Reads the first worksheet of an Excel workbook into a table. Handles .xlsx,
 * .xls, and .ods, since the parser covers all three.
 */
export async function tableFromWorkbook(bytes: ArrayBuffer, name: string): Promise<DataTable> {
  // Loaded on demand: the spreadsheet parser is by far the largest dependency,
  // and most sessions never open a workbook.
  const XLSX = await import('xlsx');
  const book = XLSX.read(bytes, { type: 'array' });
  const sheetName = book.SheetNames[0];
  if (!sheetName) throw new Error('That workbook has no worksheets.');
  const sheet = book.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, blankrows: false, raw: true });
  if (!grid.length) throw new Error(`The worksheet "${sheetName}" is empty.`);

  const width = Math.max(...grid.map((row) => row.length));
  const firstRowIsHeader = grid[0].some(
    (cell) => cell !== null && cell !== undefined && cell !== '' && typeof cell !== 'number'
  );
  const header = firstRowIsHeader ? grid[0] : [];
  const body = firstRowIsHeader ? grid.slice(1) : grid;

  const columns = Array.from({ length: width }, (_, index) => ({
    id: newId('col'),
    name: String(header[index] ?? `Column ${index + 1}`).trim() || `Column ${index + 1}`,
    role: 'group' as const,
  }));

  return {
    id: newId('tbl'),
    name: book.SheetNames.length > 1 ? `${name} · ${sheetName}` : name,
    shape: 'column',
    columns,
    rows: body.map((row) =>
      Array.from({ length: width }, (_, index) => {
        const cell = row[index];
        if (cell === null || cell === undefined || cell === '') return null;
        if (typeof cell === 'number') return cell;
        // A workbook stores real numbers as numbers, so anything still a string
        // here is text the sheet itself did not treat as numeric.
        return String(cell);
      })
    ),
  };
}

/** Every extension the importer accepts, for the file dialog and error text. */
export const IMPORT_EXTENSIONS = ['.csv', '.tsv', '.txt', '.tab', '.dat', '.xlsx', '.xls', '.xlsm', '.ods'];

const WORKBOOK_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.ods'];

/** Dispatches on file extension, so one importer handles every supported format. */
export interface ImportResult {
  table: DataTable;
  /** Null for a workbook, where the format is not in question. */
  format: TextFormat | null;
}

export async function tableFromFile(file: File): Promise<DataTable> {
  return (await importFile(file)).table;
}

/** As tableFromFile, but also says how a text file was read. */
export async function importFile(file: File): Promise<ImportResult> {
  const name = file.name.replace(/\.[^.]+$/, '');
  const lower = file.name.toLowerCase();
  const extension = lower.slice(lower.lastIndexOf('.'));

  if (WORKBOOK_EXTENSIONS.some((candidate) => lower.endsWith(candidate))) {
    return { table: await tableFromWorkbook(await file.arrayBuffer(), name), format: null };
  }
  if (IMPORT_EXTENSIONS.includes(extension) || extension === '') {
    const text = await file.text();
    return { table: tableFromDelimited(text, name), format: detectFormat(text) };
  }
  throw new Error(
    `AssayPlot cannot read "${extension}" files. Supported: ${IMPORT_EXTENSIONS.join(', ')}.`
  );
}

export function tableToCsv(table: DataTable): string {
  const escape = (value: Cell) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [table.columns.map((column) => escape(column.name)).join(',')];
  for (const row of table.rows) {
    lines.push(table.columns.map((_, index) => escape(row[index] ?? null)).join(','));
  }
  return lines.join('\n');
}

/**
 * The project file extension. Projects were `.assayplot` up to 0.4.0; those
 * still open, because the format inside has not changed.
 */
export const PROJECT_EXTENSION = 'asp';
export const PROJECT_EXTENSIONS = ['asp', 'assayplot'];
export const PROJECT_FILTER = [
  { name: 'AssayPlot project', extensions: PROJECT_EXTENSIONS },
];

export function download(filename: string, data: BlobPart, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Serialises a live SVG node, inlining the font so the file stands alone. */
export function svgSource(node: SVGSVGElement): string {
  const clone = node.cloneNode(true) as SVGSVGElement;
  // An in-place edit renders an HTML <input> inside a foreignObject, and unset
  // labels render a grey placeholder. Neither belongs in an exported figure.
  clone.querySelectorAll('foreignObject').forEach((node) => node.remove());
  clone.querySelectorAll('[data-placeholder]').forEach((node) => node.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', '100%');
  background.setAttribute('height', '100%');
  background.setAttribute('fill', '#ffffff');
  clone.insertBefore(background, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/**
 * Rasterises an SVG at a chosen DPI. Journals specify widths in millimetres, so
 * the caller passes the physical width and the scale follows from it.
 */
export async function svgToPng(node: SVGSVGElement, dpi = 300): Promise<Blob> {
  const source = svgSource(node);
  const width = Number(node.getAttribute('width')) || node.clientWidth || 520;
  const height = Number(node.getAttribute('height')) || node.clientHeight || 360;
  const scale = dpi / 96;

  const image = new Image();
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The figure could not be rasterised.'));
    image.src = svgUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))), 'image/png');
  });
}


/** Human-readable name for a delimiter, for telling the user what was read. */
export function describeFormat(format: TextFormat): string {
  const delimiter =
    format.delimiter === '\t' ? 'tab' :
    format.delimiter === ';' ? 'semicolon' :
    format.delimiter === '|' ? 'pipe' : 'comma';
  const decimal = format.decimal === ',' ? 'comma decimals' : 'dot decimals';
  return `${delimiter} separated, ${decimal}`;
}

export const PAGE_SIZES = {
  fit: { label: 'Fit the figure', width: 0, height: 0 },
  a4: { label: 'A4 portrait', width: 595.28, height: 841.89 },
  a4landscape: { label: 'A4 landscape', width: 841.89, height: 595.28 },
  letter: { label: 'US Letter portrait', width: 612, height: 792 },
  letterlandscape: { label: 'US Letter landscape', width: 792, height: 612 },
} as const;

export type PageSize = keyof typeof PAGE_SIZES;

/**
 * Writes a PDF containing the figure on a white page.
 *
 * The figure is rasterised at the chosen DPI and embedded losslessly as
 * Flate-compressed RGB, rather than as JPEG, because a figure is line art and
 * JPEG artefacts around thin strokes look like data. Text is not live: a PDF
 * with editable text needs the fonts embedded, which is a much larger job.
 * Export SVG when the text has to stay editable.
 */
export async function svgToPdf(
  node: SVGSVGElement,
  dpi: number,
  page: PageSize = 'fit'
): Promise<Blob> {
  const source = svgSource(node);
  const width = Number(node.getAttribute('width')) || node.clientWidth || 520;
  const height = Number(node.getAttribute('height')) || node.clientHeight || 380;
  const scale = dpi / 96;
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The figure could not be rasterised.'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });

  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, pixelWidth, pixelHeight);
  context.drawImage(image, 0, 0, pixelWidth, pixelHeight);

  // Drop the alpha channel: the page behind is white and PDF wants RGB.
  const rgba = context.getImageData(0, 0, pixelWidth, pixelHeight).data;
  const rgb = new Uint8Array(pixelWidth * pixelHeight * 3);
  for (let i = 0, out = 0; i < rgba.length; i += 4) {
    rgb[out] = rgba[i];
    rgb[out + 1] = rgba[i + 1];
    rgb[out + 2] = rgba[i + 2];
    out += 3;
  }
  const compressed = zlibSync(rgb, { level: 9 });

  // A PDF point is 1/72 inch, so the drawn size is the pixel size at this DPI.
  const drawnWidth = (pixelWidth / dpi) * 72;
  const drawnHeight = (pixelHeight / dpi) * 72;

  const sheet = PAGE_SIZES[page];
  const pageWidth = sheet.width || drawnWidth;
  const pageHeight = sheet.height || drawnHeight;
  const margin = sheet.width ? 36 : 0;
  const fit = Math.min(1, (pageWidth - margin * 2) / drawnWidth, (pageHeight - margin * 2) / drawnHeight);
  const drawWidth = drawnWidth * fit;
  const drawHeight = drawnHeight * fit;
  const x = (pageWidth - drawWidth) / 2;
  const y = (pageHeight - drawHeight) / 2;

  const content = `q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;

  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] ` +
      '/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let position = 0;
  const push = (part: Uint8Array | string) => {
    const data = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(data);
    position += data.length;
  };

  push('%PDF-1.4\n');
  bodies.forEach((body, index) => {
    offsets[index] = position;
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  offsets[4] = position;
  push(
    '5 0 obj\n' +
    `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\n` +
    'stream\n'
  );
  push(compressed);
  push('\nendstream\nendobj\n');

  const xrefAt = position;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
