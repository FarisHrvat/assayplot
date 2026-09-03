import { type Report, reportToMarkdown } from './report.ts';

const VERSION = '2022-06-28';
const TOKEN_KEY = 'assayplot.notion.token';
const PARENT_KEY = 'assayplot.notion.parent';

export interface NotionSettings {
  token: string;
  parentPageId: string;
}

export function loadSettings(): NotionSettings {
  try {
    return {
      token: localStorage.getItem(TOKEN_KEY) ?? '',
      parentPageId: localStorage.getItem(PARENT_KEY) ?? '',
    };
  } catch {
    return { token: '', parentPageId: '' };
  }
}

export function saveSettings(settings: NotionSettings) {
  try {
    localStorage.setItem(TOKEN_KEY, settings.token);
    localStorage.setItem(PARENT_KEY, settings.parentPageId);
  } catch {
    /* not remembered */
  }
}

export function forgetSettings() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PARENT_KEY);
  } catch {
    /* nothing to forget */
  }
}

export const runningInDesktop = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Notion sends no CORS headers, so a webview cannot call its API directly. In
 * the desktop app the request goes out through Rust, restricted to
 * api.notion.com by the capability in src-tauri/capabilities.
 */
async function request(path: string, token: string, body: unknown) {
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  const response = await tauriFetch(`https://api.notion.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as { message?: string } | null)?.message ?? `Notion returned ${response.status}.`;
    throw new Error(message);
  }
  return payload as { id: string; url?: string };
}

/** A Notion page id is a UUID; people paste whole URLs, so pull it out of one. */
export function normalisePageId(input: string): string | null {
  const cleaned = input.trim();
  const hex = cleaned.replace(/-/g, '').match(/[0-9a-f]{32}/i);
  if (!hex) return null;
  const id = hex[0];
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

const text = (content: string, annotations: Record<string, boolean> = {}) => ({
  type: 'text' as const,
  text: { content: content.slice(0, 2000) },
  annotations,
});

/**
 * Turns the report's Markdown into Notion blocks. Only the subset the report
 * actually emits is handled: headings, paragraphs, bullets, quotes, tables and
 * horizontal rules.
 */
function toBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (line.startsWith('# ')) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: [text(line.slice(2))] } });
    } else if (line.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [text(line.slice(3))] } });
    } else if (line.startsWith('### ')) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: [text(line.slice(4))] } });
    } else if (line.startsWith('- ')) {
      blocks.push({
        object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [text(line.slice(2).replace(/`/g, ''))] },
      });
    } else if (line.startsWith('> ')) {
      blocks.push({ object: 'block', type: 'callout', callout: { rich_text: [text(line.slice(2))], icon: { emoji: '⚠️' } } });
    } else if (line === '---') {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    } else if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-+:?$/.test(cell) || cell === '')) rows.push(cells);
        i += 1;
      }
      i -= 1;
      if (!rows.length) continue;
      const width = Math.max(...rows.map((row) => row.length));
      blocks.push({
        object: 'block', type: 'table',
        table: {
          table_width: width,
          has_column_header: true,
          children: rows.map((row) => ({
            object: 'block', type: 'table_row',
            table_row: {
              cells: Array.from({ length: width }, (_, column) => [text(row[column] ?? '')]),
            },
          })),
        },
      });
    } else {
      blocks.push({
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [text(line.replace(/\*\*/g, '').replace(/`/g, ''))] },
      });
    }
  }
  return blocks;
}

/**
 * Creates a page under the chosen parent and fills it with the report. Notion
 * accepts 100 blocks per request, so longer reports are appended in batches.
 */
export async function sendToNotion(report: Report, settings: NotionSettings): Promise<string> {
  const parent = normalisePageId(settings.parentPageId);
  if (!parent) throw new Error('That does not look like a Notion page ID or URL.');
  if (!settings.token.trim()) throw new Error('A Notion integration token is needed.');

  const blocks = toBlocks(reportToMarkdown(report));

  const page = await request('pages', settings.token, {
    parent: { page_id: parent },
    properties: { title: [{ text: { content: `${report.project} — analysis report` } }] },
    children: blocks.slice(0, 100),
  });

  for (let start = 100; start < blocks.length; start += 100) {
    await request(`blocks/${page.id}/children`, settings.token, {
      children: blocks.slice(start, start + 100),
    });
  }

  return page.url ?? `https://www.notion.so/${page.id.replace(/-/g, '')}`;
}
