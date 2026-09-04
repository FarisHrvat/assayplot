// The parts of the app that behave differently inside the desktop shell.
//
// Everything here has a browser fallback, so the same build runs at
// localhost:5173 during development and inside the window when shipped.

export const isDesktop = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface SaveFilter {
  name: string;
  extensions: string[];
}

/**
 * Writes a file where the user asks. Returns the path, or null if they
 * cancelled. Falls back to a browser download outside the app.
 */
export async function saveFile(
  suggestedName: string,
  data: string | Uint8Array,
  mime: string,
  filters: SaveFilter[]
): Promise<string | null> {
  if (!isDesktop()) {
    downloadInBrowser(suggestedName, data, mime);
    return suggestedName;
  }

  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: suggestedName, filters });
  if (!path) return null;

  const { writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
  if (typeof data === 'string') await writeTextFile(path, data);
  else await writeFile(path, data);
  return path;
}

/** Opens a file the user picks. Returns its bytes and the name it had. */
export async function openFile(
  filters: SaveFilter[]
): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (!isDesktop()) return null;

  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, filters });
  if (typeof path !== 'string') return null;

  const { readFile } = await import('@tauri-apps/plugin-fs');
  return { name: path.split(/[/\\]/).pop() ?? path, bytes: await readFile(path) };
}

function downloadInBrowser(filename: string, data: string | Uint8Array, mime: string) {
  const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data).slice().buffer;
  const url = URL.createObjectURL(new Blob([part], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Turns a project or figure name into something a filesystem accepts. */
export const safeName = (name: string, fallback: string) =>
  name.replace(/[^\w\-. ]+/g, '_').trim() || fallback;

// ------------------------------------------------------------------ updates

export interface Update {
  version: string;
  current: string;
  notes: string;
  url: string;
  filename: string;
  bytes: number;
  page: string;
  instruction: string;
}

/** Null when this is the newest version, or when not running in the app. */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<Update | null>('check_update');
}

export async function downloadUpdate(update: Update): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('download_update', { url: update.url, filename: update.filename });
}

/** True when this process has to quit: Windows, where the installer replaces it. */
export async function installUpdate(path: string): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('install_update', { path });
}

export async function quitApp(): Promise<void> {
  const { exit } = await import('@tauri-apps/plugin-process');
  await exit(0);
}

export async function openExternal(url: string): Promise<void> {
  if (!isDesktop()) { window.open(url, '_blank', 'noopener'); return; }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

// ------------------------------------------------------------------ windows

/** Opens a second window on the same app, for a second project. */
export async function openNewWindow(): Promise<boolean> {
  if (!isDesktop()) {
    window.open(window.location.href, '_blank');
    return true;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = `window-${Date.now().toString(36)}`;
  const created = new WebviewWindow(label, {
    url: window.location.pathname,
    title: 'AssayPlot',
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    center: true,
    decorations: false,
  });
  return new Promise((resolve) => {
    created.once('tauri://created', () => resolve(true));
    created.once('tauri://error', () => resolve(false));
  });
}

/** macOS puts its window buttons on the left and shapes them differently. */
export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export async function currentWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export const windowControls = {
  async minimize() { (await currentWindow()).minimize(); },
  async toggleMaximize() { (await currentWindow()).toggleMaximize(); },
  async close() { (await currentWindow()).close(); },
  async isMaximized() { return (await currentWindow()).isMaximized(); },
  async setTitle(title: string) { (await currentWindow()).setTitle(title); },
  /**
   * GTK gives an undecorated window no resize edges of its own, so the grips
   * around the frame ask the window manager to take over the drag.
   */
  async startResize(direction: string) {
    const window = await currentWindow();
    await (window as unknown as { startResizeDragging: (d: string) => Promise<void> })
      .startResizeDragging(direction);
  },
};
