// Import and export.
//
// A project is a ZIP archive of pretty-printed JSON, so it stays greppable and
// diffable and a corrupted entry does not take the rest of the file with it.
// Migrations run forward only, from any earlier schema version to the current
// one.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  type Cell,
  type DataTable,
  type Project,
  APP_VERSION,
  SCHEMA_VERSION,
  defaultStyle,
  newId,
} from './model.ts';

// ---------------------------------------------------------------------------
// project container
// ---------------------------------------------------------------------------

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
      },
    }),
    'README.txt': strToU8(
      'This is a Statista project.\n\n' +
        'It is an ordinary ZIP archive of JSON files. You can open it with any\n' +
        'unzip tool and read your data without Statista installed. Nothing here\n' +
        'is encrypted, obfuscated, or proprietary.\n'
    ),
  };

  for (const table of project.tables) files[`tables/${table.id}.json`] = pretty(table);
  for (const analysis of project.analyses) files[`analyses/${analysis.id}.json`] = pretty(analysis);
  for (const figure of project.figures) files[`figures/${figure.id}.json`] = pretty(figure);

  return zipSync(files, { level: 6 });
}

export function deserializeProject(bytes: Uint8Array): Project {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    // A plain .json project from the older prototype is still worth accepting.
    try {
      return migrate(JSON.parse(strFromU8(bytes)));
    } catch {
      throw new Error('This file is not a Statista project.');
    }
  }

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
  });
}

/**
 * Brings any earlier project forward to the current schema. Written forward
 * only: never mutate a file in place to fit an older reader.
 */
export function migrate(raw: any): Project {
  const version = Number(raw?.schemaVersion ?? 0);

  // v0-v2: the prototype's single flat table in long format.
  if (version < 3) {
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
  };
}

// ---------------------------------------------------------------------------
// delimited text
// ---------------------------------------------------------------------------

export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length) ?? '';
  const counts = [
    { delimiter: '\t', count: (line.match(/\t/g) ?? []).length },
    { delimiter: ',', count: (line.match(/,/g) ?? []).length },
    { delimiter: ';', count: (line.match(/;/g) ?? []).length },
  ];
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].delimiter : ',';
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

function toCell(text: string): Cell {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : trimmed;
}

/** Parses a clipboard payload into a rectangular block for paste. */
export function parseClipboard(text: string): Cell[][] {
  return parseDelimited(text.replace(/\s+$/, '')).map((row) => row.map(toCell));
}

/**
 * Builds a table from delimited text. The first row is treated as a header when
 * it is non-numeric, which is the case for nearly every file a lab exports.
 */
export function tableFromDelimited(text: string, name: string): DataTable {
  const rows = parseDelimited(text);
  if (!rows.length) throw new Error('That file has no readable rows.');

  const firstRowIsHeader = rows[0].some((cell) => cell.trim() && !Number.isFinite(Number(cell)));
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
    rows: body.map((row) => Array.from({ length: width }, (_, index) => toCell(row[index] ?? ''))),
  };
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

// ---------------------------------------------------------------------------
// downloads
// ---------------------------------------------------------------------------

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
