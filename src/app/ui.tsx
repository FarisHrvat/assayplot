import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Cell,
  type Column,
  type Correction,
  type DataTable,
  type Method,
  type PlotType,
  type TableShape,
  APP_VERSION,
  SHAPE_INFO,
  METHODS,
  METHOD_FAMILIES,
  defaultStyle,
  makeColumn,
  makeFigure,
  availableMethods,
  panelLabel,
  columnValues,
  emptyProject,
  formatP,
  methodInfo,
  methodsSentence,
  significanceStars,
  valueColumns,
  predictorCandidates,
} from './model.ts';
import {
  analysisById, markSaved, resultFor, startAutosave, tableById, useStore,
  type Problem, type Question, type Selection,
} from './store.ts';
import { useTheme, type Theme } from './theme.ts';
import { defaultSettings, useSettings } from './settings.ts';
import { METHOD_HELP, SHAPE_HELP } from './help.ts';
import { buildReport, reportToHtml, reportToMarkdown } from './report.ts';
import { reportToPdf } from './reportpdf.ts';
import {
  checkForUpdate, downloadUpdate, installUpdate, isDesktop, isMac, openExternal,
  openFile, openNewWindow, quitApp, safeName, saveFile, windowControls,
  type Update,
} from './desktop.ts';
import {
  forgetSettings, loadSettings, normalisePageId, runningInDesktop, saveSettings,
  sendToNotion, type NotionSettings,
} from './notion.ts';
import { clearSnapshot, readSnapshot, type Snapshot } from './persist.ts';
import {
  LayoutFigure, Plot, PALETTES, PLOT_GROUPS, PLOT_KINDS, gridFrames, hasLegend, pointKey,
  paletteFor, plotsForShape, type LayoutPanel, type PlotContext, type Selected,
} from './plot.tsx';
import {
  IMPORT_EXTENSIONS,
  PAGE_SIZES,
  PROJECT_EXTENSION,
  PROJECT_EXTENSIONS,
  PROJECT_FILTER,
  describeFormat,
  deserializeProject,
  download,
  importFile,
  parseClipboard,
  serializeProject,
  svgSource,
  svgToPdf,
  svgToPng,
  tableToCsv,
  type PageSize,
} from './io.ts';

interface BoundaryState { error: Error | null; note: string | null }

/**
 * A rendering fault must never cost someone their data. The boundary keeps the
 * autosaved snapshot intact and offers to download the project as it stands, so
 * a bug in one figure cannot take an afternoon's work with it.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, note: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error, note: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Kept local: there is no telemetry in this application.
    console.error('AssayPlot render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something in the interface broke</h1>
        <p>
          Your data is safe. It was autosaved a moment ago and is still in memory.
          Download it now, then reload.
        </p>
        <div className="crash-actions">
          <button className="primary" onClick={() => {
            try {
              const project = useStore.getState().project;
              const bytes = new Uint8Array(serializeProject(project)).slice().buffer;
              saveFile(`${safeName(project.name, 'recovered')}-recovered.${PROJECT_EXTENSION}`,
                new Uint8Array(bytes), 'application/zip', PROJECT_FILTER);
            } catch {
              this.setState({ note: 'The project could not be packaged. Reload and use the autosaved copy, which is written separately.' });
            }
          }}>Download my project</button>
          <button onClick={() => window.location.reload()}>Reload AssayPlot</button>
        </div>
        {this.state.note && <p className="crash-note">{this.state.note}</p>}
        <details>
          <summary>Technical detail</summary>
          <pre>{this.state.error.stack ?? String(this.state.error)}</pre>
        </details>
      </div>
    );
  }
}

function ProblemPanel({ problem, onDismiss }: { problem: Problem; onDismiss: () => void }) {
  return (
    <div className="problem" role="alert">
      <div className="problem-body">
        <h2>{problem.title}</h2>
        <p>{problem.detail}</p>
        {(problem.done || problem.notDone) && (
          <dl className="problem-outcome">
            {problem.done && (<><dt>What was done</dt><dd>{problem.done}</dd></>)}
            {problem.notDone && (<><dt>What was not done</dt><dd>{problem.notDone}</dd></>)}
          </dl>
        )}
        {problem.fix && problem.fix.length > 0 && (
          <>
            <h3>What to try</h3>
            <ul>{problem.fix.map((step) => <li key={step}>{step}</li>)}</ul>
          </>
        )}
      </div>
      <button className="problem-close" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  );
}

/**
 * A question, asked in the page rather than by the webview. Tauri blocks
 * window.confirm, so a native confirm() returns false without showing
 * anything: the button it guarded looked broken, which is exactly how the
 * close buttons behaved.
 *
 * Escape and the backdrop both answer null, which always means "do nothing".
 */
/**
 * Writes the project where the user chooses. Module level rather than inside a
 * component: closing a table offers to save first, and that button lives in
 * the navigator, not the toolbar.
 *
 * Resolves false when the user backed out of the save dialog, so a caller can
 * abandon whatever it was going to do next.
 */
export async function saveProject(): Promise<boolean> {
  const store = useStore.getState();
  try {
    const bytes = serializeProject(store.project);
    const written = await saveFile(
      `${safeName(store.project.name, 'project')}.${PROJECT_EXTENSION}`,
      bytes,
      'application/zip',
      PROJECT_FILTER
    );
    if (!written) return false;
    markSaved();
    store.notify(`Saved as ${written.split(/[/\\]/).pop()}.`);
    return true;
  } catch (error) {
    store.reportProblem({
      title: 'The project could not be saved',
      detail: error instanceof Error ? error.message : 'The file could not be written.',
      done: 'Nothing. Your work is still open and unchanged.',
      notDone: 'No file was written, so nothing was overwritten either.',
      fix: [
        'Choose a folder you can write to — a synced folder that is still uploading can refuse a write.',
        'Check there is free space on the disk.',
        'Your work is also autosaved in this app, so it survives a crash even if this never succeeds.',
      ],
    });
    return false;
  }
}

/** The report, in whichever of the three formats suits where it is going. */
function ReportDialog({ busy, onExport, onClose }: {
  busy: boolean;
  onExport: (format: 'md' | 'html' | 'pdf') => void;
  onClose: () => void;
}) {
  const formats: { id: 'pdf' | 'html' | 'md'; label: string; note: string }[] = [
    { id: 'pdf', label: 'PDF', note: 'For a supplement or an email. Text stays selectable and searchable.' },
    { id: 'html', label: 'Web page', note: 'One self-contained file. Opens in any browser.' },
    { id: 'md', label: 'Markdown', note: 'Plain text. Paste straight into Notion, a wiki, or a doc.' },
  ];

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Export the report">
        <h2>Export the report</h2>
        <p className="modal-lede">
          Every analysis with its result and methods sentence, and a SHA-256 of each data
          table beside the analyses that used it.
        </p>
        <div className="format-list">
          {formats.map((format) => (
            <button key={format.id} className="format" disabled={busy} onClick={() => onExport(format.id)}>
              <strong>{format.label}</strong>
              <em>{format.note}</em>
            </button>
          ))}
        </div>
        <div className="modal-actions modal-actions-end">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The window's own title bar, drawn by the app.
 *
 * The native one is off because it cannot be themed and looks like a different
 * program sitting on top of this one. Platform convention still applies:
 * macOS puts its three round buttons on the left, Windows and Linux put square
 * ones on the right, and everyone drags by the empty space between.
 */
function TitleBar({ title }: { title: string }) {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const mac = isMac();

  useEffect(() => {
    let cancelled = false;
    const sync = () => windowControls.isMaximized()
      .then((value) => { if (!cancelled) setMaximized(value); })
      .catch(() => {});
    sync();

    const gained = () => setFocused(true);
    const lost = () => setFocused(false);
    window.addEventListener('resize', sync);
    window.addEventListener('focus', gained);
    window.addEventListener('blur', lost);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', sync);
      window.removeEventListener('focus', gained);
      window.removeEventListener('blur', lost);
    };
  }, []);

  const toggle = () => windowControls.toggleMaximize()
    .then(() => setMaximized((was) => !was))
    .catch(() => {});

  // Glyphs at 10x10 with a half-pixel offset, so a 1px stroke lands on a pixel
  // boundary instead of straddling two and going grey.
  const glyph = {
    minimise: <line x1="2.5" y1="5.5" x2="7.5" y2="5.5" />,
    maximise: <rect x="2.5" y="2.5" width="5" height="5" rx="0.5" />,
    restore: (
      <>
        <rect x="2.5" y="4" width="4" height="4" rx="0.5" />
        <path d="M4.2 4V2.5h4V6.5H6.8" />
      </>
    ),
    close: <path d="M2.6 2.6 7.4 7.4M7.4 2.6 2.6 7.4" />,
  };

  const close = (
    <button type="button" className="window-button close" aria-label="Close" title="Close"
      onClick={() => windowControls.close().catch(() => {})}>
      <svg viewBox="0 0 10 10" aria-hidden="true">{glyph.close}</svg>
    </button>
  );
  const minimise = (
    <button type="button" className="window-button minimise" aria-label="Minimise" title="Minimise"
      onClick={() => windowControls.minimize().catch(() => {})}>
      <svg viewBox="0 0 10 10" aria-hidden="true">{glyph.minimise}</svg>
    </button>
  );
  const maximise = (
    <button type="button" className="window-button maximise"
      aria-label={maximized ? 'Restore' : 'Maximise'} title={maximized ? 'Restore' : 'Maximise'}
      onClick={toggle}>
      <svg viewBox="0 0 10 10" aria-hidden="true">{maximized ? glyph.restore : glyph.maximise}</svg>
    </button>
  );

  // Order differs by platform: macOS is close, minimise, maximise from the
  // left; Windows and Linux are minimise, maximise, close from the right.
  const buttons = (
    <div className={`window-buttons ${mac ? 'mac' : 'pc'}`}>
      {mac ? <>{close}{minimise}{maximise}</> : <>{minimise}{maximise}{close}</>}
    </div>
  );

  return (
    <div className={`titlebar ${mac ? 'mac' : 'pc'} ${focused ? '' : 'unfocused'}`}
      data-tauri-drag-region onDoubleClick={toggle}>
      {mac && buttons}
      <span className="titlebar-title" data-tauri-drag-region>{title}</span>
      {!mac && buttons}
    </div>
  );
}

/**
 * Resize grips for window managers that give an undecorated window none of its
 * own. Eight pixels wide, transparent, and outside the layout.
 */
function ResizeEdges() {
  const edges = [
    'North', 'South', 'East', 'West',
    'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest',
  ];
  return (
    <div className="resize-edges" aria-hidden="true">
      {edges.map((edge) => (
        <div key={edge} className={`resize-edge resize-${edge.toLowerCase()}`}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            windowControls.startResize(edge).catch(() => {});
          }} />
      ))}
    </div>
  );
}

/**
 * Shown while something takes long enough to notice. A 300 ms delay before it
 * appears keeps it from flashing on work that was quick anyway.
 */
function WorkingOverlay({ label }: { label: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  }, [label]);
  if (!visible) return null;

  return (
    <div className="working" role="status" aria-live="polite">
      <div className="working-card">
        <div className="working-track"><div className="working-bar" /></div>
        <span>{label}</span>
      </div>
    </div>
  );
}

const megabytes = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Offers the newer release. What happens after the download differs by
 * platform, so the dialog says which before anything is downloaded rather than
 * leaving a file in Downloads and no explanation.
 */
function UpdateDialog({ update, onClose }: { update: Update; onClose: (skip: boolean) => void }) {
  const [stage, setStage] = useState<'offer' | 'downloading' | 'ready' | 'failed'>('offer');
  const [detail, setDetail] = useState('');
  const notify = useStore((s) => s.notify);

  const start = async () => {
    setStage('downloading');
    try {
      const path = await downloadUpdate(update);
      setDetail(path);
      setStage('ready');
      const mustQuit = await installUpdate(path);
      if (mustQuit) {
        notify('The installer is running. AssayPlot will close.');
        setTimeout(() => quitApp(), 1200);
      }
    } catch (error) {
      setDetail(error instanceof Error ? error.message : String(error));
      setStage('failed');
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Update available">
        <h2>AssayPlot {update.version} is available</h2>
        <p className="modal-lede">You are running {update.current}.</p>

        {stage === 'offer' && (
          <>
            {update.notes && (
              <div className="update-notes">
                {update.notes.split('\n').filter(Boolean).slice(0, 8).map((line, index) => (
                  <p key={index}>{line.replace(/^[-*#\s]+/, '')}</p>
                ))}
              </div>
            )}
            <p className="modal-note">{update.instruction}</p>
            <p className="modal-note">
              {update.filename} · {megabytes(update.bytes)}. Your projects and settings are untouched.
            </p>
            <div className="modal-actions modal-actions-end">
              <button onClick={() => openExternal(update.page)}>Release notes</button>
              <button onClick={() => onClose(true)}>Skip this version</button>
              <button onClick={() => onClose(false)}>Later</button>
              <button className="primary" onClick={start}>Download and install</button>
            </div>
          </>
        )}

        {stage === 'downloading' && (
          <>
            <div className="working-track"><div className="working-bar" /></div>
            <p className="modal-note">Downloading {update.filename} ({megabytes(update.bytes)}).</p>
          </>
        )}

        {stage === 'ready' && (
          <>
            <p className="modal-lede">Downloaded to {detail}.</p>
            <p className="modal-note">{update.instruction}</p>
            <div className="modal-actions modal-actions-end">
              <button className="primary" onClick={() => onClose(false)}>Done</button>
            </div>
          </>
        )}

        {stage === 'failed' && (
          <>
            <p className="modal-lede">The update could not be downloaded.</p>
            <p className="modal-note">{detail}</p>
            <p className="modal-note">
              Nothing was changed — the version you are running is untouched. You can download
              it by hand from the release page instead.
            </p>
            <div className="modal-actions modal-actions-end">
              <button onClick={() => openExternal(update.page)}>Open the release page</button>
              <button className="primary" onClick={() => onClose(false)}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const SKIPPED_KEY = 'assayplot.update.skipped';

/**
 * The AGPL asks that a program offer users a way to get its source. Putting the
 * link in Preferences is the least it can be.
 */
const SOURCE_URL = 'https://github.com/FarisHrvat/assayplot';

/** Checks once per launch, a moment after the interface settles. */
function useUpdateCheck(enabled: boolean) {
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    if (!enabled || !isDesktop()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkForUpdate()
        .then((found) => {
          if (cancelled || !found) return;
          let skipped: string | null = null;
          try { skipped = localStorage.getItem(SKIPPED_KEY); } catch { /* not remembered */ }
          if (skipped === found.version) return;
          setUpdate(found);
        })
        // A failed check is not worth interrupting anyone over: they did not
        // ask, and the app works regardless.
        .catch(() => {});
    }, 2500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled]);

  const dismiss = (skip: boolean) => {
    if (skip && update) {
      try { localStorage.setItem(SKIPPED_KEY, update.version); } catch { /* not remembered */ }
    }
    setUpdate(null);
  };

  return [update, dismiss] as const;
}

/**
 * A right-click menu on the figure. Everything here is reachable from the
 * panel on the right as well: this is a shortcut to the thing under the
 * pointer, not the only way to get at it.
 */
function ContextMenu({ at, items, onClose }: {
  at: { x: number; y: number };
  items: ({ label: string; run: () => void; danger?: boolean } | 'divider')[];
  onClose: () => void;
}) {
  useEffect(() => {
    const dismiss = () => onClose();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    // Capture, so a click anywhere closes it before that click does its own job.
    window.addEventListener('mousedown', dismiss, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', dismiss, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Kept on screen: near the right or bottom edge it opens the other way.
  const width = 232;
  const height = items.length * 30 + 12;
  const x = Math.min(at.x, window.innerWidth - width - 8);
  const y = Math.min(at.y, window.innerHeight - height - 8);

  return (
    <div className="context-menu" role="menu" style={{ left: x, top: y, width }}
      onMouseDown={(event) => event.stopPropagation()}>
      {items.map((item, index) =>
        item === 'divider'
          ? <hr key={`divider-${index}`} />
          : (
            <button key={item.label} role="menuitem" className={item.danger ? 'danger' : ''}
              onClick={() => { item.run(); onClose(); }}>
              {item.label}
            </button>
          ))}
    </div>
  );
}

function QuestionDialog({ question, onAnswer }: { question: Question; onAnswer: (choice: string | null) => void }) {
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onAnswer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [question.id, onAnswer]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onAnswer(null);
    }}>
      <div className="modal modal-ask" role="alertdialog" aria-modal="true" aria-label={question.title}>
        <h2>{question.title}</h2>
        {question.detail && <p className="modal-lede">{question.detail}</p>}
        {question.points && question.points.length > 0 && (
          <ul className="modal-steps">
            {question.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        )}
        <div className="modal-actions modal-actions-end">
          <button onClick={() => onAnswer(null)}>Cancel</button>
          {question.choices.map((choice, index) => (
            <button key={choice.id}
              ref={index === 0 ? first : undefined}
              className={choice.tone === 'primary' ? 'primary' : choice.tone === 'danger' ? 'danger' : ''}
              onClick={() => onAnswer(choice.id)}>
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function App({ onReady }: { onReady?: () => void } = {}) {
  const selection = useStore((s) => s.selection);
  const toast = useStore((s) => s.toast);
  const notify = useStore((s) => s.notify);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const question = useStore((s) => s.question);
  const answer = useStore((s) => s.answer);
  const projectName = useStore((s) => s.project.name);
  const working = useStore((s) => s.working);
  const [settings] = useSettings();
  const [update, dismissUpdate] = useUpdateCheck(settings.checkForUpdates);

  // Two frames after the first render: one to paint, one to be sure it landed.
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()));
    return () => cancelAnimationFrame(raf);
  }, [onReady]);
  const [recovery, setRecovery] = useState<Snapshot | null>(null);
  const problem = useStore((s) => s.problem);
  const dismissProblem = useStore((s) => s.dismissProblem);

  // Offer any work left behind by a crash or a closed tab, once, at startup.
  useEffect(() => {
    let cancelled = false;
    readSnapshot().then((snapshot) => {
      if (!cancelled && snapshot?.dirty) setRecovery(snapshot);
    });
    const stop = startAutosave();
    return () => { cancelled = true; stop(); };
  }, []);

  // Warn before a close that would lose unsaved work.
  const dirty = useStore((s) => s.dirty);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => notify(null), 3600);
    return () => clearTimeout(timer);
  }, [toast, notify]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        // Let the browser's own undo work while typing in a field.
        if (event.key === 'z' || event.key === 'y') return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return (
    <div className={`app ${isDesktop() ? 'framed' : ''}`}>
      <a className="skip-link" href="#stage">Skip to the current view</a>
      {isDesktop() && <TitleBar title={projectName ? `${projectName} — AssayPlot` : 'AssayPlot'} />}
      {isDesktop() && <ResizeEdges />}
      {recovery && (
        <div className="recovery" role="alert">
          <span>
            <strong>Unsaved work from your last session.</strong>{' '}
            “{recovery.project.name}”, autosaved {new Date(recovery.savedAt).toLocaleString()}.
          </span>
          <span className="recovery-actions">
            <button className="primary" onClick={() => {
              useStore.getState().replaceProject(recovery.project);
              useStore.setState({ dirty: true });
              setRecovery(null);
              notify('Recovered your last session.');
            }}>Restore it</button>
            <button onClick={() => { void clearSnapshot(); setRecovery(null); }}>Discard</button>
          </span>
        </div>
      )}
      <Toolbar canUndo={canUndo} canRedo={canRedo} />
      {problem && <ProblemPanel problem={problem} onDismiss={dismissProblem} />}
      {question && <QuestionDialog question={question} onAnswer={answer} />}
      {working && <WorkingOverlay label={working} />}
      {update && <UpdateDialog update={update} onClose={dismissUpdate} />}
      <div className="body">
        <Navigator />
        <main className="stage" id="stage" tabIndex={-1}>
          {selection.kind === 'table' && <TableView key={selection.id} id={selection.id} />}
          {selection.kind === 'analysis' && <AnalysisView key={selection.id} id={selection.id} />}
          {selection.kind === 'figure' && <FigureView key={selection.id} id={selection.id} />}
          {selection.kind === 'layout' && <LayoutView key={selection.id} id={selection.id} />}
          {selection.kind === 'help' && <HelpView />}
        </main>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Toolbar({ canUndo, canRedo }: { canUndo: boolean; canRedo: boolean }) {
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const notify = useStore((s) => s.notify);
  const setProjectName = useStore((s) => s.setProjectName);
  const replaceProject = useStore((s) => s.replaceProject);
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);

  const reportProblem = useStore((s) => s.reportProblem);
  const [theme, setTheme] = useTheme();
  const [busy, setBusy] = useState(false);
  const [notionOpen, setNotionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const ask = useStore((s) => s.ask);
  const setWorking = useStore((s) => s.setWorking);

  const openRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const save = () => saveProject();

  const openProject = async () => {
    if (!isDesktop()) { openRef.current?.click(); return; }
    const picked = await openFile(PROJECT_FILTER);
    if (!picked) return;
    open(new File([new Uint8Array(picked.bytes).slice().buffer], picked.name));
  };

  const newProject = () => {
    // A second project belongs in a second window: closing this one to make
    // room for it is not what "New" means anywhere else.
    openNewWindow().then((opened) => {
      if (opened) { notify('New window opened.'); return; }
      ask({
        title: 'Start a new project here?',
        detail: 'A second window could not be opened, so this one would be reused.',
        points: dirty ? ['This project has changes you have not saved to a file.'] : [],
        choices: dirty
          ? [
              { id: 'save', label: 'Save project first', tone: 'primary' },
              { id: 'discard', label: 'Discard and start new', tone: 'danger' },
            ]
          : [{ id: 'discard', label: 'Start new', tone: 'primary' }],
        onAnswer: async (choice) => {
          if (!choice) return;
          if (choice === 'save' && !(await saveProject())) return;
          replaceProject(emptyProject());
          notify('New project started.');
        },
      });
    });
  };

  const open = async (file: File) => {
    if (dirty) {
      const proceed = await new Promise<boolean>((resolve) => {
        ask({
          title: `Open “${file.name}”?`,
          detail: 'This project has changes you have not saved to a file.',
          choices: [
            { id: 'save', label: 'Save this one first', tone: 'primary' },
            { id: 'discard', label: 'Discard and open', tone: 'danger' },
          ],
          onAnswer: async (choice) => {
            if (choice === 'save') { resolve(await saveProject()); return; }
            resolve(choice === 'discard');
          },
        });
      });
      if (!proceed) return;
    }

    setWorking(`Opening ${file.name}`);
    // One frame, so the overlay is on screen before the parse blocks the thread.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      replaceProject(deserializeProject(bytes));
      notify(`Opened ${file.name}.`);
    } catch (error) {
      reportProblem({
        title: `“${file.name}” could not be opened`,
        detail: error instanceof Error ? error.message : 'The file could not be read.',
        done: 'Nothing. Your current project is untouched.',
        notDone: 'The file was not opened.',
        fix: [
          `Check this is a .${PROJECT_EXTENSION} project and not a spreadsheet — use Import data for those.`,
          'A project is an ordinary ZIP archive: if you can unzip it and see a manifest.json, the file is intact and this is a bug worth reporting.',
          'If it came from a much newer version of AssayPlot, update first.',
        ],
      });
    } finally {
      setWorking(null);
    }
  };

  const importData = async (files: FileList) => {
    const added: string[] = [];
    let next = useStore.getState().project;

    for (const file of Array.from(files)) {
      try {
        const { table, format } = await importFile(file);
        next = { ...next, tables: [...next.tables, table] };
        added.push(
          `${table.name} (${table.rows.length} × ${table.columns.length}` +
          `${format ? `, ${describeFormat(format)}` : ''})`
        );
      } catch (error) {
        reportProblem({
          title: `“${file.name}” could not be imported`,
          detail: error instanceof Error ? error.message : 'The file could not be read.',
          done: added.length
            ? `${added.length} earlier file(s) were imported: ${added.join(', ')}.`
            : 'Nothing. No data was added.',
          notDone: `“${file.name}” and any files after it were not imported.`,
          fix: [
            `Supported formats are ${IMPORT_EXTENSIONS.join(', ')}.`,
            'Only the first worksheet of a workbook is read — move the data you want to the first sheet.',
            'If the file opens in Excel, try exporting it as CSV and importing that.',
          ],
        });
        if (added.length) {
          commit(next);
          const last = next.tables[next.tables.length - 1];
          if (last) select({ kind: 'table', id: last.id });
        }
        return;
      }
    }

    commit(next);
    const last = next.tables[next.tables.length - 1];
    if (last) select({ kind: 'table', id: last.id });
    notify(`Imported ${added.join(', ')}.`);
  };

  const exportReport = async (format: 'md' | 'html' | 'pdf') => {
    setBusy(true);
    setWorking('Building the report');
    try {
      const report = await buildReport(useStore.getState().project);
      const base = `${safeName(project.name, 'report')}-report`;

      const written =
        format === 'md'
          ? await saveFile(`${base}.md`, reportToMarkdown(report), 'text/markdown',
              [{ name: 'Markdown', extensions: ['md'] }])
        : format === 'html'
          ? await saveFile(`${base}.html`, reportToHtml(report), 'text/html',
              [{ name: 'Web page', extensions: ['html'] }])
          : await saveFile(`${base}.pdf`, reportToPdf(report), 'application/pdf',
              [{ name: 'PDF', extensions: ['pdf'] }]);

      if (!written) { notify(null); return; }
      notify(`Report saved as ${written.split(/[/\\]/).pop()}.`);
    } catch (error) {
      reportProblem({
        title: 'The report could not be generated',
        detail: error instanceof Error ? error.message : 'Something went wrong while building the report.',
        done: 'Nothing. Your project is unchanged.',
        notDone: 'No report file was written.',
        fix: ['Check that every analysis in the project opens without an error, then try again.'],
      });
    } finally {
      setBusy(false);
      setWorking(null);
    }
  };

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="mark" aria-hidden="true">◴</span>
        <input
          className="project-name"
          value={project.name}
          onChange={(event) => setProjectName(event.target.value)}
          aria-label="Project name"
        />
        {dirty && <span className="dirty" title="Unsaved changes">•</span>}
      </div>

      <div className="tools">
        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">↶</button>
        <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↷</button>
        <span className="divider" />
        <button onClick={newProject}>New</button>
        <button onClick={() => importRef.current?.click()} title={`Accepts ${IMPORT_EXTENSIONS.join(', ')}`}>
          Import data
        </button>
        <button onClick={openProject}>Open</button>
        <button disabled={busy} onClick={() => setReportOpen(true)}
          title="A report of every analysis, with a checksum of the data each one used">
          Report
        </button>
        <button onClick={() => setNotionOpen(true)} title="Send the report to a page in your Notion workspace">
          Notion
        </button>
        <button className="primary" onClick={save}>Save project</button>
        <span className="divider" />
        <button onClick={() => setSettingsOpen(true)} title="Preferences">⚙</button>
        <ThemeToggle theme={theme} onChange={setTheme} />
      </div>

      {reportOpen && (
        <ReportDialog
          busy={busy}
          onExport={(format) => { setReportOpen(false); exportReport(format); }}
          onClose={() => setReportOpen(false)}
        />
      )}
      {notionOpen && <NotionDialog onClose={() => setNotionOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      <input ref={openRef} type="file"
        accept={[...PROJECT_EXTENSIONS.map((extension) => `.${extension}`), '.zip', '.json'].join(',')} hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) open(file);
          event.target.value = '';
        }} />
      <input ref={importRef} type="file" multiple accept={IMPORT_EXTENSIONS.join(',')} hidden
        onChange={(event) => {
          if (event.target.files?.length) importData(event.target.files);
          event.target.value = '';
        }} />
    </header>
  );
}

function Navigator() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const addTable = useStore((s) => s.addTable);
  const addAnalysis = useStore((s) => s.addAnalysis);
  const addFigure = useStore((s) => s.addFigure);
  const addLayout = useStore((s) => s.addLayout);
  const deleteNode = useStore((s) => s.deleteNode);
  const notify = useStore((s) => s.notify);
  const ask = useStore((s) => s.ask);
  const dirty = useStore((s) => s.dirty);
  const [settings] = useSettings();

  const activeTableId =
    selection.kind === 'table'
      ? selection.id
      : selection.kind === 'analysis'
        ? analysisById(project, selection.id)?.tableId ?? project.tables[0]?.id
        : project.figures.find((figure) => figure.id === selection.id)?.tableId ?? project.tables[0]?.id;

  const remove = (kind: Selection['kind'], id: string, name: string) => {
    const points: string[] = [];
    if (kind === 'table') {
      const analyses = project.analyses.filter((analysis) => analysis.tableId === id).length;
      const figures = project.figures.filter((figure) => figure.tableId === id).length;
      if (analyses) points.push(`${analyses} analysis${analyses === 1 ? '' : 'es'} built on it also close.`);
      if (figures) points.push(`${figures} figure${figures === 1 ? '' : 's'} built on it also close.`);
    }
    if (dirty) points.push('This project has changes you have not saved to a file yet.');

    const done = () => {
      deleteNode(kind, id);
      notify(`Closed ${name}. Undo brings it back.`);
    };

    // Nothing is destroyed that undo cannot bring back, so with the warning
    // turned off and nothing else depending on it, just close it.
    if (!settings.confirmClose && !points.length) { done(); return; }

    ask({
      title: `Close “${name}”?`,
      detail: dirty
        ? 'Saving writes the whole project, including this, to a file first.'
        : 'It is removed from this project. Undo brings it back.',
      points,
      choices: dirty
        ? [
            { id: 'save', label: 'Save project, then close', tone: 'primary' },
            { id: 'close', label: 'Close without saving', tone: 'danger' },
          ]
        : [{ id: 'close', label: 'Close', tone: 'danger' }],
      onAnswer: (choice) => {
        if (choice === 'save') { saveProject().then(done); return; }
        if (choice === 'close') done();
      },
    });
  };

  const Item = ({ kind, id, name, badge }: { kind: Selection['kind']; id: string; name: string; badge?: string }) => (
    <div className={`nav-item ${selection.kind === kind && selection.id === id ? 'active' : ''}`}>
      <button className="nav-label" onClick={() => select({ kind, id })}>
        <span className="nav-name">{name}</span>
        {badge && <span className="nav-badge">{badge}</span>}
      </button>
      <button className="nav-delete" title={kind === 'table' ? `Close ${name}` : `Delete ${name}`}
        aria-label={kind === 'table' ? `Close ${name}` : `Delete ${name}`}
        onClick={() => remove(kind, id, name)}>×</button>
    </div>
  );

  return (
    <nav className="navigator" aria-label="Project contents">
      <Section title="Data tables" action={<button onClick={() => addTable('column')} title="New data table">＋</button>}>
        {!project.tables.length && <p className="nav-hint">Import a file or add a table.</p>}
        {project.tables.map((table) => (
          <Item key={table.id} kind="table" id={table.id} name={table.name}
            badge={table.shape === 'xy' ? 'XY' : `${valueColumns(table).length} col`} />
        ))}
      </Section>

      <Section title="Analyses" action={
        <button onClick={() => activeTableId && addAnalysis(activeTableId)} disabled={!activeTableId} title="New analysis">＋</button>
      }>
        {!project.analyses.length && <p className="nav-hint">Analyses stay linked to their table.</p>}
        {project.analyses.map((analysis) => {
          const table = tableById(project, analysis.tableId);
          const result = table ? resultFor(table, analysis) : null;
          return (
            <Item key={analysis.id} kind="analysis" id={analysis.id} name={analysis.name}
              badge={result?.error ? '!' : result?.pValue != null ? formatP(result.pValue) : undefined} />
          );
        })}
      </Section>

      <Section title="Figures" action={
        <button onClick={() => activeTableId && addFigure(activeTableId)} disabled={!activeTableId} title="New figure">＋</button>
      }>
        {!project.figures.length && <p className="nav-hint">Figures redraw when the data changes.</p>}
        {project.figures.map((figure) => (
          <Item key={figure.id} kind="figure" id={figure.id} name={figure.name} badge={figure.plotType} />
        ))}
      </Section>

      <Section title="Layouts" action={
        <button onClick={addLayout} disabled={!project.figures.length} title="New multi-panel figure">＋</button>
      }>
        {!project.layouts.length && <p className="nav-hint">Assemble figures into one panel.</p>}
        {project.layouts.map((layout) => (
          <Item key={layout.id} kind="layout" id={layout.id} name={layout.name}
            badge={`${layout.panels.length} panel${layout.panels.length === 1 ? '' : 's'}`} />
        ))}
      </Section>

      <button className={`nav-help ${selection.kind === 'help' ? 'active' : ''}`}
        onClick={() => select({ kind: 'help', id: 'help' })}>
        ? &nbsp;Which test should I use?
      </button>

      <div className="nav-foot">
        <span>AssayPlot {APP_VERSION}</span>
      </div>
    </nav>
  );
}

function NotionDialog({ onClose }: { onClose: () => void }) {
  const notify = useStore((s) => s.notify);
  const reportProblem = useStore((s) => s.reportProblem);
  const [settings, setSettings] = useState<NotionSettings>(loadSettings);
  const [sending, setSending] = useState(false);
  const desktop = runningInDesktop();

  const send = async () => {
    setSending(true);
    try {
      saveSettings(settings);
      const report = await buildReport(useStore.getState().project);
      const url = await sendToNotion(report, settings);
      onClose();
      notify('Report sent to Notion.');
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      onClose();
      reportProblem({
        title: 'The report could not be sent to Notion',
        detail: error instanceof Error ? error.message : 'Notion rejected the request.',
        done: 'Nothing was created in your workspace.',
        notDone: 'The report was not sent. Your project is unchanged.',
        fix: [
          'Check the integration token starts with "ntn_" or "secret_" and was copied in full.',
          'In Notion, open the parent page, choose Connections, and add your integration — a page the integration has not been given access to returns "Could not find page".',
          'Export the report as Markdown instead and paste it into Notion; it converts on paste.',
        ],
      });
    } finally {
      setSending(false);
    }
  };

  const idLooksValid = normalisePageId(settings.parentPageId) !== null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Send to Notion" onClick={(event) => event.stopPropagation()}>
        <h2>Send the report to Notion</h2>

        {!desktop && (
          <p className="modal-note">
            This works in the desktop app. Notion's API cannot be called from a
            browser tab, so in the web version export the report as Markdown and
            paste it into a Notion page instead — it converts on paste.
          </p>
        )}

        <p className="modal-lede">
          AssayPlot talks to your own workspace using an integration you create.
          Nothing goes anywhere else, and the token is stored on this machine only.
        </p>

        <ol className="modal-steps">
          <li>
            At <code>notion.so/my-integrations</code>, create an internal
            integration and copy its secret.
          </li>
          <li>
            Open the Notion page the report should live under, and add your
            integration to it under Connections.
          </li>
          <li>Paste both below.</li>
        </ol>

        <label className="field">
          <span>Integration token</span>
          <input type="password" value={settings.token} autoComplete="off" spellCheck={false}
            placeholder="ntn_…"
            onChange={(event) => setSettings({ ...settings, token: event.target.value })} />
        </label>

        <label className="field">
          <span>Parent page — paste its URL or ID</span>
          <input value={settings.parentPageId} spellCheck={false}
            placeholder="https://www.notion.so/Lab-notes-1a2b3c…"
            onChange={(event) => setSettings({ ...settings, parentPageId: event.target.value })} />
        </label>
        {settings.parentPageId && !idLooksValid && (
          <p className="modal-warn">That does not contain a Notion page ID yet.</p>
        )}

        <div className="modal-actions">
          <button onClick={() => { forgetSettings(); setSettings({ token: '', parentPageId: '' }); }}>
            Forget these
          </button>
          <span className="modal-spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={sending || !desktop || !settings.token || !idLooksValid}
            onClick={send}>
            {sending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Drag the corner to size the figure. Pointer events rather than mouse events,
 * so a trackpad, a pen and a touchscreen all work, and capture so the drag
 * survives the pointer leaving the handle.
 */
function ResizeHandle({ width, height, onResize }: {
  width: number;
  height: number;
  onResize: (width: number, height: number) => void;
}) {
  const start = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, y: event.clientY, width, height };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!start.current) return;
    const next = start.current;
    onResize(
      Math.max(220, Math.round(next.width + (event.clientX - next.x))),
      Math.max(160, Math.round(next.height + (event.clientY - next.y)))
    );
  };

  const stop = (event: React.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    start.current = null;
    setDragging(false);
  };

  return (
    <div className={`resize-handle ${dragging ? 'dragging' : ''}`}
      role="slider"
      aria-label="Resize the figure"
      aria-valuetext={`${width} by ${height} pixels`}
      tabIndex={0}
      title="Drag to resize. Arrow keys adjust in steps of ten."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 50 : 10;
        if (event.key === 'ArrowRight') { event.preventDefault(); onResize(width + step, height); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); onResize(Math.max(220, width - step), height); }
        if (event.key === 'ArrowDown') { event.preventDefault(); onResize(width, height + step); }
        if (event.key === 'ArrowUp') { event.preventDefault(); onResize(width, Math.max(160, height - step)); }
      }}>
      {dragging && <span className="resize-readout">{width} × {height}</span>}
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, update] = useSettings();
  const [tab, setTab] = useState<'figures' | 'results' | 'app'>('figures');

  const Hint = ({ children }: { children: React.ReactNode }) => (
    <p className="modal-hint">{children}</p>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal modal-wide" role="dialog" aria-label="Preferences">
        <h2>Preferences</h2>

        <div className="tabs" role="tablist">
          {([
            ['figures', 'Figures'],
            ['results', 'Results'],
            ['app', 'Application'],
          ] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id}
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'figures' && (
          <div className="settings-panel">
            <label className="check">
              <input type="checkbox" checked={settings.colourBlindSafe}
                onChange={(event) => update({ colourBlindSafe: event.target.checked })} />
              Colour-blind safe figures
            </label>
            <Hint>
              Gives every series its own marker shape as well as its own colour, and uses a
              palette that stays distinct under the common forms of colour-vision deficiency.
              Shape is the part that matters: about one man in twelve cannot reliably separate
              red from green, and no palette fixes a figure that encodes meaning in hue alone.
            </Hint>

            <label className="field">
              <span>Palette for new figures</span>
              <select value={settings.palette}
                onChange={(event) => update({ palette: event.target.value })}>
                {Object.keys(PALETTES).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>

            <div className="field-row">
              <label className="field">
                <span>Default width</span>
                <input type="number" min={200} max={2000} step={10} value={settings.figureWidth}
                  onChange={(event) => update({ figureWidth: Number(event.target.value) || 520 })} />
              </label>
              <label className="field">
                <span>Default height</span>
                <input type="number" min={150} max={2000} step={10} value={settings.figureHeight}
                  onChange={(event) => update({ figureHeight: Number(event.target.value) || 380 })} />
              </label>
            </div>
            <Hint>
              In points, which is what a journal asks for. A single-column figure is usually
              about 240 points wide, a double-column one about 500.
            </Hint>

            <label className="field">
              <span>Export resolution</span>
              <select value={settings.exportDpi}
                onChange={(event) => update({ exportDpi: Number(event.target.value) })}>
                <option value={150}>150 DPI — for a draft or a slide</option>
                <option value={300}>300 DPI — what most journals ask for</option>
                <option value={600}>600 DPI — line art, or a large reproduction</option>
                <option value={1200}>1200 DPI</option>
              </select>
            </label>
            <Hint>The starting value in the export dialog. SVG has no resolution and ignores it.</Hint>
          </div>
        )}

        {tab === 'results' && (
          <div className="settings-panel">
            <label className="field">
              <span>Decimal places</span>
              <select value={settings.decimals}
                onChange={(event) => update({ decimals: Number(event.target.value) })}>
                {[2, 3, 4, 5, 6].map((places) => (
                  <option key={places} value={places}>{places}</option>
                ))}
              </select>
            </label>
            <Hint>
              Affects what is shown, never what is computed or stored. Reported precision is a
              claim about your measurement, so choose it for the assay rather than the screen.
            </Hint>

            <label className="check">
              <input type="checkbox" checked={settings.exactPValues}
                onChange={(event) => update({ exactPValues: event.target.checked })} />
              Show exact p-values instead of “&lt; 0.0001”
            </label>
            <Hint>
              A threshold hides how far past it a result sits, and more journals now ask for the
              number. Below about 1e-300 there is no number left to show and the threshold
              returns.
            </Hint>

            <label className="field">
              <span>How hard to work the machine</span>
              <select value={settings.effort}
                onChange={(event) => update({ effort: event.target.value as typeof settings.effort })}>
                <option value="light">Light — leave the machine free</option>
                <option value="balanced">Balanced — the default</option>
                <option value="thorough">Thorough — exact tests on larger samples</option>
              </select>
            </label>
            <Hint>
              Sets how far an exact test will enumerate before falling back to an approximation,
              scaled to the number of processors this machine reports. AssayPlot never takes the
              whole machine: the interface still has to draw, and a frozen window reads as a crash.
            </Hint>
          </div>
        )}

        {tab === 'app' && (
          <div className="settings-panel">
            <label className="field">
              <span>Interface density</span>
              <select value={settings.density}
                onChange={(event) => update({ density: event.target.value as typeof settings.density })}>
                <option value="compact">Compact — fits more on a 13-inch screen</option>
                <option value="normal">Normal</option>
                <option value="roomy">Roomy — larger text and targets</option>
              </select>
            </label>

            <label className="field">
              <span>Autosave every</span>
              <select value={settings.autosaveMinutes}
                onChange={(event) => update({ autosaveMinutes: Number(event.target.value) })}>
                <option value={0.5}>30 seconds</option>
                <option value={1}>1 minute</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
              </select>
            </label>
            <Hint>
              Autosave keeps a copy inside the application so a crash costs nothing. It is not a
              substitute for saving a project file, which is the copy you can move, back up and
              send to someone.
            </Hint>

            <label className="check">
              <input type="checkbox" checked={settings.confirmClose}
                onChange={(event) => update({ confirmClose: event.target.checked })} />
              Ask before closing a table that has work built on it
            </label>

            <label className="check">
              <input type="checkbox" checked={settings.checkForUpdates}
                onChange={(event) => update({ checkForUpdates: event.target.checked })} />
              Check for a new version when AssayPlot starts
            </label>
            <Hint>
              Asks GitHub which release is newest, once per launch. Nothing is downloaded and
              nothing is installed without you saying so, and no information about you or your
              data is sent.
            </Hint>

            <p className="settings-version">
              AssayPlot {APP_VERSION} · Copyright © 2026 Faris Hrvat<br />
              Free software under the AGPL-3.0-or-later.{' '}
              <a href={SOURCE_URL} onClick={(event) => { event.preventDefault(); openExternal(SOURCE_URL); }}>
                Source code
              </a>
            </p>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={() => update(defaultSettings())}>Reset to defaults</button>
          <span className="modal-spacer" />
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ExportDialog({ name, getNode, beforeExport, onClose }: {
  name: string;
  getNode: () => SVGSVGElement | null;
  beforeExport?: () => void;
  onClose: () => void;
}) {
  const notify = useStore((s) => s.notify);
  const reportProblem = useStore((s) => s.reportProblem);
  const [settings] = useSettings();
  const [dpi, setDpi] = useState(settings.exportDpi);
  const [page, setPage] = useState<PageSize>('fit');
  const [busy, setBusy] = useState(false);

  const run = async (format: 'svg' | 'png' | 'pdf') => {
    beforeExport?.();
    const node = getNode();
    if (!node) return;
    setBusy(true);
    try {
      const written =
        format === 'svg'
          ? await saveFile(`${name}.svg`, svgSource(node), 'image/svg+xml',
              [{ name: 'SVG image', extensions: ['svg'] }])
        : format === 'png'
          ? await saveFile(`${name}-${dpi}dpi.png`,
              new Uint8Array(await (await svgToPng(node, dpi)).arrayBuffer()), 'image/png',
              [{ name: 'PNG image', extensions: ['png'] }])
          : await saveFile(`${name}.pdf`,
              new Uint8Array(await (await svgToPdf(node, dpi, page)).arrayBuffer()), 'application/pdf',
              [{ name: 'PDF', extensions: ['pdf'] }]);

      if (written) {
        const where = written.split(/[/\\]/).pop();
        notify(
          format === 'svg' ? `Saved ${where}. Text stays editable in Illustrator.`
          : format === 'png' ? `Saved ${where} at ${dpi} DPI.`
          : `Saved ${where}.`
        );
      }
      onClose();
    } catch (error) {
      onClose();
      reportProblem({
        title: `The figure could not be exported as ${format.toUpperCase()}`,
        detail: error instanceof Error ? error.message : 'The export failed.',
        done: 'Nothing. The figure is unchanged.',
        notDone: 'No file was written.',
        fix: [
          'Export SVG instead — it needs no rasterising and is what most journals want.',
          `At ${dpi} DPI this figure is about ${Math.round((Number(getNode()?.getAttribute('width')) || 520) * dpi / 96)} pixels wide. Try a lower DPI or a smaller figure.`,
        ],
      });
    } finally {
      setBusy(false);
    }
  };

  const node = getNode();
  const width = Number(node?.getAttribute('width')) || 520;
  const height = Number(node?.getAttribute('height')) || 380;
  const pixels = `${Math.round((width * dpi) / 96)} × ${Math.round((height * dpi) / 96)} px`;
  const inches = `${(width / 96).toFixed(2)} × ${(height / 96).toFixed(2)} in`;
  const millimetres = `${Math.round((width / 96) * 25.4)} × ${Math.round((height / 96) * 25.4)} mm`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Export figure" onClick={(event) => event.stopPropagation()}>
        <h2>Export “{name}”</h2>

        <p className="modal-lede">
          At its current size the figure is {inches} ({millimetres}). Journals
          usually specify a column width in millimetres — set the figure size in
          the panel first, then choose a resolution here.
        </p>

        <label className="field">
          <span>Resolution</span>
          <select value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
            <option value={96}>96 dpi — screen</option>
            <option value={150}>150 dpi — draft print</option>
            <option value={300}>300 dpi — most journals</option>
            <option value={600}>600 dpi — line art, high quality</option>
            <option value={1200}>1200 dpi — very high</option>
          </select>
        </label>
        <p className="modal-hint">Raster output will be {pixels}.</p>

        <label className="field">
          <span>PDF page</span>
          <select value={page} onChange={(event) => setPage(event.target.value as PageSize)}>
            {(Object.keys(PAGE_SIZES) as PageSize[]).map((size) => (
              <option key={size} value={size}>{PAGE_SIZES[size].label}</option>
            ))}
          </select>
        </label>
        <p className="modal-hint">
          A page size puts the figure on plain white paper, centred, at its true
          physical size. “Fit the figure” trims the page to the figure itself.
        </p>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <span className="modal-spacer" />
          <button disabled={busy} onClick={() => run('svg')} title="Vector, text stays editable">SVG</button>
          <button disabled={busy} onClick={() => run('png')}>PNG</button>
          <button className="primary" disabled={busy} onClick={() => run('pdf')}>PDF</button>
        </div>
      </div>
    </div>
  );
}

/** A tiny made-up dataset, only ever used to draw the plot-type previews. */
/**
 * A small table shaped for whichever plot is being previewed, so the hover
 * example shows the plot rather than the placeholder it draws on data it
 * cannot use.
 */
function demoThumbnailTable(kind: PlotType): DataTable {
  const make = (shape: DataTable['shape'], columns: Column[], rows: Cell[][]): DataTable =>
    ({ id: 'thumb', name: 'preview', shape, columns, rows });

  if (kind === 'survival' || kind === 'hazard') {
    return make('survival',
      [makeColumn('Time', 'time'), makeColumn('Event', 'event'), makeColumn(kind === 'hazard' ? 'Age' : 'Group', kind === 'hazard' ? 'group' : 'group')],
      kind === 'hazard'
        ? [[5, 1, 60], [8, 1, 55], [12, 0, 70], [3, 1, 65], [15, 1, 50], [20, 0, 45], [7, 1, 72], [9, 0, 58], [11, 1, 63], [6, 1, 68]]
        : [[5, 1, 'A'], [9, 1, 'A'], [12, 0, 'A'], [6, 1, 'A'], [11, 1, 'B'], [16, 0, 'B'], [19, 1, 'B'], [22, 0, 'B']]);
  }

  if (kind === 'logisticfit' || kind === 'roc') {
    return make('column', [makeColumn('Responded'), makeColumn('Dose')],
      [[0, 1], [0, 2], [0, 3], [1, 4], [0, 5], [1, 6], [1, 7], [1, 8], [1, 9], [0, 3.5]]);
  }

  if (kind === 'ancova') {
    return make('xy', [makeColumn('Baseline', 'x'), makeColumn('Vehicle', 'y'), makeColumn('Drug', 'y')],
      [[1, 10, 20], [2, 12, 23], [3, 15, 25], [4, 16, 28], [5, 19, 30], [6, 21, 33]]);
  }

  if (['scatter', 'line', 'area', 'step', 'bubble'].includes(kind)) {
    return make('xy', [makeColumn('X', 'x'), makeColumn('Y', 'y'), makeColumn('Size', 'y')],
      [[1, 10, 3], [2, 19, 5], [3, 26, 4], [4, 38, 7], [5, 44, 5], [6, 59, 8]]);
  }

  if (['pcascore', 'scree', 'dendrogram', 'clusterheatmap', 'plsscore', 'anosimbox'].includes(kind)) {
    return make('column',
      [makeColumn('V1'), makeColumn('V2'), makeColumn('V3'), makeColumn('Group')],
      [[5.1, 3.5, 1.4, 'a'], [4.9, 3.0, 1.4, 'a'], [4.7, 3.2, 1.3, 'a'], [4.6, 3.1, 1.5, 'a'],
       [7.0, 3.2, 4.7, 'b'], [6.4, 3.2, 4.5, 'b'], [6.9, 3.1, 4.9, 'b'], [5.5, 2.3, 4.0, 'b'],
       [6.3, 3.3, 6.0, 'c'], [5.8, 2.7, 5.1, 'c'], [7.1, 3.0, 5.9, 'c'], [6.3, 2.9, 5.6, 'c']]);
  }

  if (kind === 'mrscatter') {
    return make('column', [makeColumn('On exposure'), makeColumn('On outcome'), makeColumn('SE')],
      [[0.10, 0.05, 0.02], [0.15, 0.08, 0.03], [0.08, 0.03, 0.015], [0.20, 0.11, 0.04],
       [0.12, 0.07, 0.02], [0.18, 0.09, 0.03], [0.09, 0.04, 0.02]]);
  }

  if (kind === 'outliers') {
    return make('column', [makeColumn('Values')],
      [[10.1], [9.8], [10.4], [9.9], [10.2], [10.0], [9.7], [10.3], [25], [30]]);
  }

  if (kind === 'forest') {
    return make('column', [makeColumn('Effect'), makeColumn('SE')],
      [[0.4, 0.15], [0.2, 0.1], [0.55, 0.2], [0.3, 0.12], [0.1, 0.18]]);
  }

  return make('column', [makeColumn('A'), makeColumn('B'), makeColumn('C')],
    [[8, 5, 3], [9, 6, 4], [7, 5, 2], [10, 7, 4], [8, 4, 3], [9, 6, 5]]);
}

function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (next: Theme) => void }) {
  const options: { id: Theme; glyph: string; label: string }[] = [
    { id: 'light', glyph: '☀', label: 'Light' },
    { id: 'system', glyph: '◐', label: 'Match the system' },
    { id: 'dark', glyph: '☾', label: 'Dark' },
  ];
  return (
    <span className="theme-toggle" role="group" aria-label="Colour scheme">
      {options.map((option) => (
        <button key={option.id}
          aria-pressed={theme === option.id}
          title={option.label}
          onClick={() => onChange(option.id)}>
          {option.glyph}
        </button>
      ))}
    </span>
  );
}

function Section({ title, action, children }: { title: string; action: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="nav-section">
      <div className="nav-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Short badges shown under a column heading when the shape gives it a role. */
const ROLE_LABEL: Record<string, string> = {
  x: 'X', y: 'Y', label: 'row factor', time: 'time', event: 'event 1/0', group: 'group',
};

/** Height of one grid row in pixels. Must match `.grid td` in styles.css. */
const ROW_HEIGHT = 27;
/** Rows rendered beyond the viewport, so scrolling does not flash blank. */
const OVERSCAN = 12;
/** Below this many rows, windowing costs more than it saves. */
const VIRTUALISE_ABOVE = 200;

function TableView({ id }: { id: string }) {
  const project = useStore((s) => s.project);
  const table = tableById(project, id);
  const setCell = useStore((s) => s.setCell);
  const setCells = useStore((s) => s.setCells);
  const addRow = useStore((s) => s.addRow);
  const addColumn = useStore((s) => s.addColumn);
  const deleteRow = useStore((s) => s.deleteRow);
  const deleteColumn = useStore((s) => s.deleteColumn);
  const renameColumn = useStore((s) => s.renameColumn);
  const renameNode = useStore((s) => s.renameNode);
  const setTableShape = useStore((s) => s.setTableShape);
  const addAnalysis = useStore((s) => s.addAnalysis);
  const addFigure = useStore((s) => s.addFigure);
  const notify = useStore((s) => s.notify);
  const [focus, setFocus] = useState<{ row: number; column: number } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setViewportHeight(node.clientHeight || 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!table) return <NothingSelected />;

  const analyses = project.analyses.filter((analysis) => analysis.tableId === table.id).length;
  const figures = project.figures.filter((figure) => figure.tableId === table.id).length;

  /**
   * Focuses a cell, scrolling it into view when it is outside the rendered
   * window and waiting for React to commit when the row does not exist yet
   * (pressing Enter on the last row adds one).
   *
   * Retries on a timer rather than requestAnimationFrame, which is throttled
   * in a background tab.
   */
  const focusCell = (row: number, column: number, attempt = 0) => {
    const clampedColumn = Math.max(0, Math.min(table.columns.length - 1, column));
    const clampedRow = Math.max(0, row);
    const select = () => {
      const node = scrollRef.current?.querySelector<HTMLInputElement>(
        `input[data-cell="${clampedRow}:${clampedColumn}"]`
      );
      if (!node) return false;
      node.focus();
      node.select();
      return true;
    };
    if (select()) return;

    if (scrollRef.current && clampedRow * ROW_HEIGHT > scrollRef.current.clientHeight) {
      scrollRef.current.scrollTop = Math.max(0, clampedRow * ROW_HEIGHT - scrollRef.current.clientHeight / 2);
      setScrollTop(scrollRef.current.scrollTop);
    }
    if (attempt < 5) setTimeout(() => focusCell(clampedRow, clampedColumn, attempt + 1), 16);
  };

  /**
   * Arrow keys, Enter and Tab move between cells the way a spreadsheet does.
   * Left and right only leave the cell when the caret is already at its edge,
   * so editing a number still works normally.
   */
  const moveWithKeyboard = (event: React.KeyboardEvent<HTMLInputElement>, row: number, column: number) => {
    const input = event.currentTarget;
    // Landing on a cell selects its contents, the way a spreadsheet does. In
    // that state the arrow keys navigate; once the caret is placed inside the
    // text they move the caret instead, and only leave the cell at its edges.
    const wholeValueSelected =
      input.value.length > 0 &&
      input.selectionStart === 0 &&
      input.selectionEnd === input.value.length;
    const atStart = wholeValueSelected || (input.selectionStart === 0 && input.selectionEnd === 0);
    const atEnd = wholeValueSelected ||
      (input.selectionStart === input.value.length && input.selectionEnd === input.value.length);

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        focusCell(row - 1, column);
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusCell(row + 1, column);
        break;
      case 'ArrowLeft':
        if (!atStart) return;
        event.preventDefault();
        focusCell(row, column - 1);
        break;
      case 'ArrowRight':
        if (!atEnd) return;
        event.preventDefault();
        focusCell(row, column + 1);
        break;
      case 'Enter': {
        event.preventDefault();
        const isLastRow = row === table.rows.length - 1;
        if (isLastRow) addRow(table.id);
        // The new row may not be in the DOM yet; focusCell retries until it is.
        focusCell(row + 1, column);
        break;
      }
      case 'Tab': {
        const lastColumn = table.columns.length - 1;
        if (event.shiftKey && column === 0 && row > 0) {
          event.preventDefault();
          focusCell(row - 1, lastColumn);
        } else if (!event.shiftKey && column === lastColumn && row < table.rows.length - 1) {
          event.preventDefault();
          focusCell(row + 1, 0);
        }
        break;
      }
      default:
        break;
    }
  };

  const onPaste = (event: React.ClipboardEvent, row: number, column: number) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
    event.preventDefault();
    const block = parseClipboard(text);
    setCells(table.id, row, column, block);
    notify(`Pasted ${block.length} × ${block[0]?.length ?? 0} cells.`);
  };

  // Only the rows on screen are rendered; the rest are represented by two
  // spacer rows, so a 100k-row import scrolls as smoothly as a 10-row one.
  const virtualise = table.rows.length > VIRTUALISE_ABOVE;
  const firstVisible = virtualise
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const lastVisible = virtualise
    ? Math.min(table.rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
    : table.rows.length;
  const visibleRows = table.rows
    .slice(firstVisible, lastVisible)
    .map((row, offset) => ({ row, rowIndex: firstVisible + offset }));
  const padBefore = firstVisible * ROW_HEIGHT;
  const padAfter = Math.max(0, (table.rows.length - lastVisible) * ROW_HEIGHT);

  return (
    <div className="view">
      <ViewHead eyebrow={`Data table · ${table.shape === 'xy' ? 'XY' : 'Column'}`} title={table.name}
        onRename={(name) => renameNode('table', table.id, name)}>
        <select value={table.shape} onChange={(event) => setTableShape(table.id, event.target.value as TableShape)}
          aria-label="Table shape" title={SHAPE_INFO[table.shape].help}>
          {(Object.keys(SHAPE_INFO) as TableShape[]).map((shape) => (
            <option key={shape} value={shape}>{SHAPE_INFO[shape].label}</option>
          ))}
        </select>
        <button onClick={() => addAnalysis(table.id)}>Analyse</button>
        <button onClick={() => addFigure(table.id)}>Graph</button>
        <button onClick={() => saveFile(
          `${safeName(table.name, 'table')}.csv`, tableToCsv(table), 'text/csv',
          [{ name: 'Comma separated values', extensions: ['csv'] }]
        )}>Export CSV</button>
      </ViewHead>

      <p className="hint">
        {SHAPE_INFO[table.shape].help}{' '}
        Type into any cell, or paste a block straight from Excel. Every change flows through to
        the {analyses} analysis{analyses === 1 ? '' : 'es'} and {figures} figure{figures === 1 ? '' : 's'} built on this table.
      </p>

      <div className="grid-wrap" ref={scrollRef}
        onScroll={(event) => {
          if (virtualise) setScrollTop((event.target as HTMLDivElement).scrollTop);
        }}>
        <table className="grid">
          <caption className="visually-hidden">
            {table.name}: {table.rows.length} rows by {table.columns.length} columns.
            Use the arrow keys to move between cells.
          </caption>
          <thead>
            <tr>
              <th className="corner" />
              {table.columns.map((column, columnIndex) => (
                <th key={column.id}>
                  <div className="col-head">
                    <input value={column.name}
                      onChange={(event) => renameColumn(table.id, column.id, event.target.value)}
                      aria-label={`Name of column ${columnIndex + 1}`} />
                    <button className="col-delete" title={`Delete column ${column.name}`}
                      onClick={() => deleteColumn(table.id, columnIndex)}
                      disabled={table.columns.length <= 1}>×</button>
                  </div>
                  {table.shape !== 'column' && (
                    <span className="col-role">{ROLE_LABEL[column.role] ?? column.role}</span>
                  )}
                </th>
              ))}
              <th className="add-col"><button onClick={() => addColumn(table.id)} title="Add column">＋</button></th>
            </tr>
          </thead>
          <tbody>
            {padBefore > 0 && <tr style={{ height: padBefore }} aria-hidden="true"><td colSpan={table.columns.length + 2} /></tr>}
            {visibleRows.map(({ row, rowIndex }) => (
              <tr key={rowIndex}>
                <th className="row-head">
                  <span>{rowIndex + 1}</span>
                  <button title={`Delete row ${rowIndex + 1}`} onClick={() => deleteRow(table.id, rowIndex)}
                    disabled={table.rows.length <= 1}>×</button>
                </th>
                {table.columns.map((column, columnIndex) => {
                  const value = row[columnIndex];
                  const active = focus?.row === rowIndex && focus?.column === columnIndex;
                  return (
                    <td key={column.id} className={active ? 'focused' : ''}>
                      <input
                        data-cell={`${rowIndex}:${columnIndex}`}
                        value={value === null || value === undefined ? '' : String(value)}
                        onFocus={() => setFocus({ row: rowIndex, column: columnIndex })}
                        onBlur={() => setFocus(null)}
                        onPaste={(event) => onPaste(event, rowIndex, columnIndex)}
                        onChange={(event) => {
                          const text = event.target.value;
                          const trimmed = text.trim();
                          const next: Cell = trimmed === '' ? null
                            : Number.isFinite(Number(trimmed)) ? Number(trimmed) : text;
                          setCell(table.id, rowIndex, columnIndex, next);
                        }}
                        onKeyDown={(event) => moveWithKeyboard(event, rowIndex, columnIndex)}
                        aria-label={`Row ${rowIndex + 1}, ${column.name}`}
                        inputMode="decimal"
                      />
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
            {padAfter > 0 && <tr style={{ height: padAfter }} aria-hidden="true"><td colSpan={table.columns.length + 2} /></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid-actions">
        <button onClick={() => addRow(table.id)}>＋ Row</button>
        <span className="counts">
          {table.rows.length} rows · {table.columns.length} columns ·{' '}
          {valueColumns(table).reduce((sum, column) => sum + columnValues(table, column.id).length, 0)} numeric values
          {virtualise && ` · showing ${firstVisible + 1}–${lastVisible}`}
        </span>
      </div>

      <ColumnSummary table={table} />
    </div>
  );
}

function ColumnSummary({ table }: { table: DataTable }) {
  const columns = valueColumns(table);
  return (
    <section className="panel">
      <h3>At a glance</h3>
      <div className="summary-grid">
        {columns.map((column) => {
          const values = columnValues(table, column.id);
          if (!values.length) {
            return (
              <div key={column.id} className="summary-card muted">
                <span className="summary-name">{column.name}</span>
                <span className="summary-empty">no numeric values</span>
              </div>
            );
          }
          const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
          const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1));
          return (
            <div key={column.id} className="summary-card">
              <span className="summary-name">{column.name}</span>
              <strong>{mean.toFixed(2)}</strong>
              <span className="summary-note">± {Number.isFinite(sd) ? sd.toFixed(2) : '—'} SD · n = {values.length}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AnalysisView({ id }: { id: string }) {
  const project = useStore((s) => s.project);
  const analysis = analysisById(project, id);
  const updateAnalysis = useStore((s) => s.updateAnalysis);
  const renameNode = useStore((s) => s.renameNode);
  const notify = useStore((s) => s.notify);
  const select = useStore((s) => s.select);
  const [showRaw, setShowRaw] = useState(false);

  if (!analysis) return <NothingSelected />;
  const table = tableById(project, analysis.tableId);
  if (!table) return <div className="view"><p>This analysis has lost its data table.</p></div>;

  const result = resultFor(table, analysis);
  const options = availableMethods(table);
  const info = methodInfo(analysis.method);
  const candidates = valueColumns(table);
  const chosen = analysis.options.columnIds ?? candidates.map((column) => column.id);
  const sentence = methodsSentence(table, analysis, result);

  const setOption = (patch: Partial<typeof analysis.options>) =>
    updateAnalysis(analysis.id, { options: { ...analysis.options, ...patch } });

  const toggleColumn = (columnId: string) => {
    const current = new Set(chosen);
    if (current.has(columnId)) current.delete(columnId);
    else current.add(columnId);
    setOption({ columnIds: candidates.filter((column) => current.has(column.id)).map((column) => column.id) });
  };

  const isGroupComparison = ['anova', 'kruskal', 'friedman'].includes(analysis.method);
  const showColumnPicker = candidates.length > 1 &&
    !['normality', 'outlier', 'descriptive', 'tdt', 'simon'].includes(analysis.method);

  const corrections: { id: Correction; label: string; only?: Method[] }[] = ([
    { id: 'tukey', label: 'Tukey HSD (all pairs, exact family-wise)', only: ['anova'] },
    { id: 'dunn', label: "Dunn's test with Holm (rank-based)", only: ['kruskal'] },
    { id: 'control', label: 'Each group vs a control (Šídák)', only: ['anova', 'kruskal'] },
    { id: 'holm', label: 'Pairwise tests, Holm correction' },
    { id: 'bh', label: 'Pairwise tests, Benjamini–Hochberg (FDR)' },
    { id: 'none', label: 'Pairwise tests, no correction' },
  ] as { id: Correction; label: string; only?: Method[] }[])
    .filter((entry) => !entry.only || entry.only.includes(analysis.method));

  return (
    <div className="view">
      <ViewHead eyebrow="Analysis" title={analysis.name}
        onRename={(name) => renameNode('analysis', analysis.id, name)}>
        <label className="head-field">
          <span>Data table</span>
          <select value={analysis.tableId}
            onChange={(event) => updateAnalysis(analysis.id, { tableId: event.target.value })}>
            {project.tables.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
        </label>
        <button onClick={() => select({ kind: 'table', id: table.id })}>Open data</button>
      </ViewHead>

      <div className="split">
        <section className="panel">
          <h3>Method</h3>
          <div className="method-list">
            {METHOD_FAMILIES.map((family) => {
              const inFamily = options.filter((entry) => entry.info.family === family);
              if (!inFamily.length) return null;
              return (
                <div key={family} className="method-family">
                  <h4>{family}</h4>
                  {inFamily.map(({ info: candidate, usable, why }) => (
                    <label key={candidate.id}
                      className={`method ${usable ? '' : 'disabled'} ${analysis.method === candidate.id ? 'chosen' : ''}`}>
                      <input type="radio" name={`method-${analysis.id}`}
                        checked={analysis.method === candidate.id} disabled={!usable}
                        onChange={() => updateAnalysis(analysis.id, { method: candidate.id as Method })} />
                      <span>
                        <strong>{candidate.label}</strong>
                        <em>{why}</em>
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        <div>
          <section className="panel">
            <h3>Result</h3>
            {result.error ? (
              <div className="error-box">
                <strong>Cannot run this yet</strong>
                <p>{result.error}</p>
              </div>
            ) : (
              <>
                {result.summary.length > 0 && (
                  <div className="metrics">
                    {result.summary.map((entry) => (
                      <div key={entry.label} className="metric">
                        <span className="metric-label">{entry.label}</span>
                        <strong>{entry.value}</strong>
                        {entry.note && <small>{entry.note}</small>}
                      </div>
                    ))}
                  </div>
                )}
                {result.warnings.map((warning) => <p key={warning} className="warn">{warning}</p>)}
                <div className="assumption">
                  <strong>What this assumes</strong>
                  <p>{info.assumes}</p>
                </div>
              </>
            )}
          </section>

          {(['onesample', 'doseresponse', 'tost', 'kappa', 'resourceequation', 'logistic', 'poisson', 'ancova', 'cox', 'gee', 'pca',
            'cluster', 'anosim', 'plsda', 'tdt', 'simon', 'rout'].includes(analysis.method) || isGroupComparison) && (
            <section className="panel">
              <h3>Options</h3>
              {analysis.method === 'onesample' && (
                <Field label="Compare the mean against">
                  <input type="number" value={analysis.options.hypothesised ?? 0}
                    onChange={(event) => setOption({ hypothesised: Number(event.target.value) || 0 })} />
                </Field>
              )}
              {analysis.method === 'tost' && (
                <Field label="Equivalence bound (± units of your data)" hintAlign="left" hint={
                  <>The largest difference you would still call equivalent. Decide it
                  before looking at the data, on scientific grounds.</>
                }>
                  <input type="number" step="any" value={analysis.options.equivalenceBound ?? ''}
                    placeholder="e.g. 0.5"
                    onChange={(event) => setOption({ equivalenceBound: Number(event.target.value) || 0 })} />
                </Field>
              )}
              {analysis.method === 'kappa' && (
                <Field label="Weighting">
                  <select value={analysis.options.kappaWeights ?? 'unweighted'}
                    onChange={(event) => setOption({ kappaWeights: event.target.value as any })}>
                    <option value="unweighted">Unweighted — categories are unordered</option>
                    <option value="linear">Linear — ordered categories</option>
                    <option value="quadratic">Quadratic — ordered, large gaps matter more</option>
                  </select>
                </Field>
              )}
              {analysis.method === 'resourceequation' && (
                <div className="field-row">
                  <Field label="Groups">
                    <input type="number" min={2} value={analysis.options.designGroups ?? 2}
                      onChange={(event) => setOption({ designGroups: Number(event.target.value) || 2 })} />
                  </Field>
                  <Field label="Per group">
                    <input type="number" min={1} value={analysis.options.designPerGroup ?? 5}
                      onChange={(event) => setOption({ designPerGroup: Number(event.target.value) || 1 })} />
                  </Field>
                </div>
              )}
              {analysis.method === 'gee' && (
                <>
                  <Field label="Outcome">
                    <select value={analysis.options.outcomeColumn ?? ''}
                      onChange={(event) => setOption({ outcomeColumn: event.target.value })}>
                      <option value="">Choose a column</option>
                      {candidates.map((column) => (
                        <option key={column.id} value={column.id}>{column.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Column naming the subject or cluster" hintAlign="left" hint={
                    <>Measurements sharing a label are treated as correlated. Every row of one
                    animal, one patient or one plate carries the same label.</>
                  }>
                    <select value={analysis.options.groupColumn ?? ''}
                      onChange={(event) => setOption({ groupColumn: event.target.value })}>
                      <option value="">Choose a column</option>
                      {table.columns.map((column) => (
                        <option key={column.id} value={column.id}>{column.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Outcome type">
                    <select value={analysis.options.geeFamily ?? 'gaussian'}
                      onChange={(event) => setOption({ geeFamily: event.target.value as any })}>
                      <option value="gaussian">Continuous measurement</option>
                      <option value="binomial">Yes or no, coded 0 and 1</option>
                      <option value="poisson">A count of events</option>
                    </select>
                  </Field>
                </>
              )}
              {analysis.method === 'pca' && (
                <label className="check">
                  <input type="checkbox" checked={analysis.options.scaleVariables ?? true}
                    onChange={(event) => setOption({ scaleVariables: event.target.checked })} />
                  Scale each variable to unit variance
                </label>
              )}
              {(analysis.method === 'cluster' || analysis.method === 'anosim') && (
                <Field label="Distance" hintAlign="left" hint={
                  <>Euclidean treats a large variable as more important. Correlation
                  distance ignores magnitude and compares shape, which is what you
                  usually want for expression data.</>
                }>
                  <select value={analysis.options.distanceMetric ?? 'euclidean'}
                    onChange={(event) => setOption({ distanceMetric: event.target.value })}>
                    <option value="euclidean">Euclidean — straight-line distance</option>
                    <option value="manhattan">Manhattan — sum of differences</option>
                    <option value="maximum">Maximum — the largest single difference</option>
                    <option value="correlation">Correlation — shape, not magnitude</option>
                  </select>
                </Field>
              )}
              {analysis.method === 'cluster' && (
                <>
                  <Field label="Linkage">
                    <select value={analysis.options.linkage ?? 'average'}
                      onChange={(event) => setOption({ linkage: event.target.value })}>
                      <option value="average">Average — the usual default</option>
                      <option value="complete">Complete — compact, equally sized clusters</option>
                      <option value="single">Single — follows chains, sensitive to noise</option>
                      <option value="ward">Ward — minimises within-cluster variance</option>
                    </select>
                  </Field>
                  <div className="field-row">
                    <Field label="Cut into">
                      <input type="number" min={2} value={analysis.options.clusterCount ?? 2}
                        onChange={(event) => setOption({ clusterCount: Number(event.target.value) || 2 })} />
                    </Field>
                    <Field label="Bootstrap replicates">
                      <input type="number" min={50} step={50} value={analysis.options.resamples ?? 500}
                        onChange={(event) => setOption({ resamples: Number(event.target.value) || 500 })} />
                    </Field>
                  </div>
                </>
              )}
              {(analysis.method === 'anosim' || analysis.method === 'plsda') && (
                <Field label={analysis.method === 'anosim' ? 'Column naming the group' : 'Column naming the class'}>
                  <select value={analysis.options.groupColumn ?? ''}
                    onChange={(event) => setOption({ groupColumn: event.target.value })}>
                    <option value="">Choose a column</option>
                    {table.columns.map((column) => (
                      <option key={column.id} value={column.id}>{column.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              {analysis.method === 'anosim' && (
                <Field label="Permutations">
                  <input type="number" min={99} step={100} value={analysis.options.resamples ?? 999}
                    onChange={(event) => setOption({ resamples: Number(event.target.value) || 999 })} />
                </Field>
              )}
              {analysis.method === 'tdt' && (
                <div className="field-row">
                  <Field label="Transmitted" hintAlign="left" hint={
                    <>Heterozygous parents who passed the allele to the affected child.
                    Homozygous parents carry no information and are not counted.</>
                  }>
                    <input type="number" min={0} value={analysis.options.transmittedCount ?? ''}
                      placeholder="e.g. 34"
                      onChange={(event) => setOption({ transmittedCount: Number(event.target.value) })} />
                  </Field>
                  <Field label="Not transmitted">
                    <input type="number" min={0} value={analysis.options.untransmittedCount ?? ''}
                      placeholder="e.g. 16"
                      onChange={(event) => setOption({ untransmittedCount: Number(event.target.value) })} />
                  </Field>
                </div>
              )}
              {analysis.method === 'simon' && (
                <>
                  <div className="field-row">
                    <Field label="Response rate not worth pursuing" hintAlign="left" hint={
                      <>The rate you would expect from standard care, or from nothing.
                      Decide both rates before the trial, on clinical grounds.</>
                    }>
                      <input type="number" step="0.01" min={0.01} max={0.98}
                        value={analysis.options.responseNull ?? 0.05}
                        onChange={(event) => setOption({ responseNull: Number(event.target.value) })} />
                    </Field>
                    <Field label="Response rate worth pursuing">
                      <input type="number" step="0.01" min={0.02} max={0.99}
                        value={analysis.options.responseTarget ?? 0.25}
                        onChange={(event) => setOption({ responseTarget: Number(event.target.value) })} />
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Alpha">
                      <input type="number" step="0.01" min={0.01} max={0.2}
                        value={analysis.options.alphaLevel ?? 0.05}
                        onChange={(event) => setOption({ alphaLevel: Number(event.target.value) })} />
                    </Field>
                    <Field label="Power">
                      <input type="number" step="0.05" min={0.5} max={0.99}
                        value={analysis.options.powerTarget ?? 0.8}
                        onChange={(event) => setOption({ powerTarget: Number(event.target.value) })} />
                    </Field>
                  </div>
                </>
              )}
              {analysis.method === 'rout' && (
                <Field label="Q, the false discovery rate" hintAlign="left" hint={
                  <>Not a significance level. At 1 per cent, about one in a hundred
                  points flagged is expected to be a false alarm.</>
                }>
                  <select value={String(analysis.options.falseDiscoveryRate ?? 0.01)}
                    onChange={(event) => setOption({ falseDiscoveryRate: Number(event.target.value) })}>
                    <option value="0.001">0.1% — flags only the obvious</option>
                    <option value="0.01">1% — the usual choice</option>
                    <option value="0.05">5% — flags more, and more of them wrongly</option>
                    <option value="0.1">10%</option>
                  </select>
                </Field>
              )}
              {(analysis.method === 'logistic' || analysis.method === 'poisson') && (
                <Field label="Outcome column" hintAlign="left" hint={
                  analysis.method === 'logistic'
                    ? <>The thing being predicted, coded 0 or 1. Every other selected column is a predictor.</>
                    : <>The count being predicted, a whole number of events. Every other selected column is a predictor.</>
                }>
                  <select value={analysis.options.outcomeColumn ?? candidates[0]?.id ?? ''}
                    onChange={(event) => setOption({ outcomeColumn: event.target.value })}>
                    {candidates.map((column) => (
                      <option key={column.id} value={column.id}>{column.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              {analysis.method === 'ancova' && (
                <>
                  <Field label="Outcome">
                    <select value={analysis.options.outcomeColumn ?? ''}
                      onChange={(event) => setOption({ outcomeColumn: event.target.value })}>
                      <option value="">Choose a column</option>
                      {candidates.map((column) => (
                        <option key={column.id} value={column.id}>{column.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Covariate to adjust for" hintAlign="left" hint={
                    <>A continuous measurement taken before treatment — baseline weight, initial
                    titre, age. Adjusting for it removes variation the treatment did not cause.</>
                  }>
                    <select value={analysis.options.covariateColumn ?? ''}
                      onChange={(event) => setOption({ covariateColumn: event.target.value })}>
                      <option value="">Choose a column</option>
                      {candidates.map((column) => (
                        <option key={column.id} value={column.id}>{column.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Column naming the group">
                    <select value={analysis.options.groupColumn ?? ''}
                      onChange={(event) => setOption({ groupColumn: event.target.value })}>
                      <option value="">Choose a column</option>
                      {table.columns.map((column) => (
                        <option key={column.id} value={column.id}>{column.name}</option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {analysis.method === 'cox' && (
                <Field label="Predictors" hintAlign="left" hint={
                  <>Numeric columns thought to change the hazard. Code a two-level factor
                  as 0 and 1; the hazard ratio is then group 1 against group 0.</>
                }>
                  <div className="chips">
                    {predictorCandidates(table).map((column) => {
                      const picked = analysis.options.columnIds ?? predictorCandidates(table).map((entry) => entry.id);
                      const on = picked.includes(column.id);
                      return (
                        <button key={column.id} className={`chip ${on ? 'on' : ''}`}
                          onClick={() => setOption({
                            columnIds: predictorCandidates(table)
                              .filter((entry) => (entry.id === column.id ? !on : picked.includes(entry.id)))
                              .map((entry) => entry.id),
                          })}>
                          {column.name}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
              {analysis.method === 'doseresponse' && (
                <label className="check">
                  <input type="checkbox" checked={analysis.options.logX ?? false}
                    onChange={(event) => setOption({ logX: event.target.checked })} />
                  X is already on a log scale
                </label>
              )}
              {isGroupComparison && analysis.method !== 'friedman' && (
                <>
                  <Field label="Post-hoc comparisons">
                    <select value={analysis.options.correction ?? (analysis.method === 'anova' ? 'tukey' : 'dunn')}
                      onChange={(event) => setOption({ correction: event.target.value as Correction })}>
                      {corrections.map((entry) => (
                        <option key={entry.id} value={entry.id}>{entry.label}</option>
                      ))}
                    </select>
                  </Field>
                  {analysis.options.correction === 'control' && (
                    <Field label="Control column">
                      <select value={analysis.options.controlIndex ?? 0}
                        onChange={(event) => setOption({ controlIndex: Number(event.target.value) })}>
                        {candidates
                          .filter((column) => chosen.includes(column.id))
                          .map((column, index) => <option key={column.id} value={index}>{column.name}</option>)}
                      </select>
                    </Field>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </div>

      {showColumnPicker && (
        <section className="panel">
          <h3>
            Columns used
            {methodInfo(analysis.method).maxGroups === 2 && <span className="tag">pick exactly two</span>}
            {methodInfo(analysis.method).maxGroups === 1 && <span className="tag">pick one</span>}
          </h3>
          <div className="chips">
            {candidates.map((column) => (
              <label key={column.id} className={`chip ${chosen.includes(column.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={chosen.includes(column.id)} onChange={() => toggleColumn(column.id)} />
                {column.name}
              </label>
            ))}
          </div>
        </section>
      )}

      {result.comparisons.length > 1 && (
        <section className="panel">
          <h3>Pairwise comparisons</h3>
          <div className="table-scroll">
            <table className="results">
              <thead>
                <tr>
                  <th>Comparison</th>
                  {result.comparisons[0].difference !== undefined && <th>Difference</th>}
                  {result.comparisons[0].confidenceInterval95 && <th>95% CI</th>}
                  <th>P (raw)</th><th>P (adjusted)</th><th />
                </tr>
              </thead>
              <tbody>
                {result.comparisons.map((comparison, index) => (
                  <tr key={index}>
                    <td>{comparison.labelA} vs {comparison.labelB}</td>
                    {comparison.difference !== undefined && (
                      <td className="num">{comparison.difference.toFixed(3)}</td>
                    )}
                    {comparison.confidenceInterval95 && (
                      <td className="num">
                        {comparison.confidenceInterval95[0].toFixed(2)} to {comparison.confidenceInterval95[1].toFixed(2)}
                      </td>
                    )}
                    <td className="num">{formatP(comparison.pValue)}</td>
                    <td className="num">{formatP(comparison.pAdjusted)}</td>
                    <td><span className={`stars ${comparison.pAdjusted < 0.05 ? 'sig' : ''}`}>
                      {significanceStars(comparison.pAdjusted)}
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result.tables.map((extra) => (
        <section className="panel" key={extra.title}>
          <h3>{extra.title}</h3>
          <div className="table-scroll">
            <table className="results">
              <thead><tr>{extra.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {extra.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className={cellIndex === 0 ? '' : 'num'}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {sentence && (
        <section className="panel">
          <div className="panel-head">
            <h3>Methods text</h3>
            <button onClick={() => { navigator.clipboard?.writeText(sentence); notify('Methods sentence copied.'); }}>
              Copy
            </button>
          </div>
          <p className="methods-text">{sentence}</p>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>Full output</h3>
          <button onClick={() => setShowRaw(!showRaw)}>{showRaw ? 'Hide' : 'Show'}</button>
        </div>
        {showRaw && <pre className="raw">{JSON.stringify(result.raw, null, 2)}</pre>}
      </section>
    </div>
  );
}

function FigureView({ id }: { id: string }) {
  const project = useStore((s) => s.project);
  const figure = project.figures.find((entry) => entry.id === id);
  const updateFigure = useStore((s) => s.updateFigure);
  const updateStyle = useStore((s) => s.updateStyle);
  const renameNode = useStore((s) => s.renameNode);
  const notify = useStore((s) => s.notify);
  const reportProblem = useStore((s) => s.reportProblem);
  const select = useStore((s) => s.select);
  const svgRef = useRef<HTMLDivElement>(null);

  // Subscribed so a change of preference redraws the figure; the engine itself
  // reads the current value rather than taking it as a prop.
  useSettings();
  const [traced, setTraced] = useState<number | null>(null);
  const [menu, setMenu] = useState<PlotContext | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [selected, setSelected] = useState<Selected>(null);
  const [editing, setEditing] = useState<Selected>(null);

  if (!figure) return <NothingSelected />;
  const table = tableById(project, figure.tableId);
  if (!table) return <div className="view"><p>This figure has lost its data table.</p></div>;

  const linked = analysisById(project, figure.analysisId);
  const result = linked ? resultFor(table, linked) : null;
  const available = plotsForShape(table.shape);
  const columns = valueColumns(table);

  /** A click on a text element selects it and opens the editor immediately. */
  const onSelect = (next: Selected) => {
    setSelected(next);
    setEditing(next && next.kind !== 'series' ? next : null);
  };

  const onEditText = (value: string) => {
    if (!editing) return;
    if (editing.kind === 'title') updateStyle(figure.id, { title: value });
    if (editing.kind === 'xLabel') updateStyle(figure.id, { xLabel: value });
    if (editing.kind === 'yLabel') updateStyle(figure.id, { yLabel: value });
  };



  /** Drags the legend, in fractions of the plot area so it survives a resize. */
  const grabLegend = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const svg = svgRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    const box = svg.getBoundingClientRect();
    const start = figure.style.legendAt ?? { x: 0.72, y: 0.08 };
    const origin = { x: event.clientX, y: event.clientY };

    const onMove = (move: MouseEvent) => {
      const x = start.x + (move.clientX - origin.x) / Math.max(box.width, 1);
      const y = start.y + (move.clientY - origin.y) / Math.max(box.height, 1);
      updateStyle(figure.id, {
        legendAt: { x: Math.min(1.1, Math.max(-0.1, x)), y: Math.min(1.1, Math.max(-0.1, y)) },
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** What the right-click menu offers, given what it landed on. */
  const menuItems = (context: PlotContext) => {
    const style = figure.style;
    const items: ({ label: string; run: () => void; danger?: boolean } | 'divider')[] = [];

    if (context.target.kind === 'point') {
      const { columnId, rowIndex, value } = context.target;
      const key = pointKey(columnId, rowIndex);
      const ringed = style.highlights.includes(key);
      items.push(
        {
          label: ringed ? 'Remove the ring from this point' : 'Ring this point',
          run: () => updateStyle(figure.id, {
            highlights: ringed
              ? style.highlights.filter((entry) => entry !== key)
              : [...style.highlights, key],
          }),
        },
        { label: `Go to row ${rowIndex + 1} in the data`, run: () => traceRow(rowIndex) },
        'divider',
        {
          label: style.pointLabels === 'none' ? 'Label every point with its value' : 'Stop labelling points',
          run: () => updateStyle(figure.id, { pointLabels: style.pointLabels === 'none' ? 'value' : 'none' }),
        },
        {
          label: 'Label only the ringed points',
          run: () => updateStyle(figure.id, { pointLabels: 'highlighted' }),
        },
      );
      if (style.highlights.length) {
        items.push('divider', {
          label: `Clear all ${style.highlights.length} rings`,
          run: () => updateStyle(figure.id, { highlights: [] }),
          danger: true,
        });
      }
      void value;
      return items;
    }

    if (hasLegend(figure.plotType)) {
      items.push({
        label: style.showLegend ? 'Hide the legend' : 'Show the legend',
        run: () => updateStyle(figure.id, { showLegend: !style.showLegend }),
      });
    }
    items.push(
      { label: style.showPoints ? 'Hide individual points' : 'Show individual points',
        run: () => updateStyle(figure.id, { showPoints: !style.showPoints }) },
      { label: style.grid === 'none' ? 'Show gridlines' : 'Hide gridlines',
        run: () => updateStyle(figure.id, { grid: style.grid === 'none' ? 'horizontal' : 'none' }) },
      { label: style.frame ? 'Remove the box around the plot' : 'Box the plot area',
        run: () => updateStyle(figure.id, { frame: !style.frame }) },
      'divider',
      { label: 'Copy this figure', run: () => { copyFigures([figure.id]); notify('Copied. Paste it into a layout.'); } },
      { label: 'Export…', run: () => setExportOpen(true) },
    );
    if (style.legendAt) {
      items.push('divider', {
        label: 'Put the legend back where it was',
        run: () => updateStyle(figure.id, { legendAt: null }),
      });
    }
    return items;
  };

  const traceRow = useCallback((rowIndex: number) => {
    setTraced((current) => (current === rowIndex ? null : rowIndex));
  }, []);

  const copyFigures = useStore((s) => s.copyFigures);
  const copyFigure = () => {
    copyFigures([figure.id]);
    notify(`“${figure.name}” copied. Open a layout and paste it in.`);
  };

  // ⌘C on the figure view copies it, unless the user is selecting real text.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'c') return;
      if (window.getSelection()?.toString()) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      event.preventDefault();
      copyFigure();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedColumn = selected?.kind === 'series'
    ? columns.find((column) => column.id === selected.columnId)
    : null;

  return (
    <div className="view">
      <ViewHead eyebrow={`Figure · from ${table.name}`} title={figure.name}
        onRename={(name) => renameNode('figure', figure.id, name)}>
        <button onClick={() => select({ kind: 'table', id: table.id })}>Open data</button>
        <button onClick={copyFigure} title="Copy this figure, then paste it into a layout (⌘C)">Copy</button>
        <button onClick={() => setExportOpen(true)}>Export…</button>
      </ViewHead>

      {exportOpen && (
        <ExportDialog
          name={figure.name}
          getNode={() => svgRef.current?.querySelector('svg') as SVGSVGElement | null}
          beforeExport={() => setEditing(null)}
          onClose={() => setExportOpen(false)}
        />
      )}

      <div className="figure-layout">
        <div>
          <div className="canvas resizable" ref={svgRef}>
            <Plot table={table} figure={figure} result={result}
              onPickRow={traceRow} highlightRow={traced}
              selected={selected} onSelect={onSelect}
              onContextMenu={setMenu} onGrabLegend={grabLegend}
              editing={editing} onEditText={onEditText} onFinishEdit={() => setEditing(null)} />
            <ResizeHandle
              width={figure.style.width}
              height={figure.style.height}
              onResize={(width, height) => updateStyle(figure.id, { width, height })}
            />
          </div>
          {menu && (
            <ContextMenu at={menu} items={menuItems(menu)} onClose={() => setMenu(null)} />
          )}
          <p className="trace">
            {traced !== null ? (
              <>
                Highlighting row {traced + 1} of {table.name}.{' '}
                <button className="link" onClick={() => select({ kind: 'table', id: table.id })}>Open it</button>
                {' · '}
                <button className="link" onClick={() => setTraced(null)}>Clear</button>
              </>
            ) : selectedColumn ? (
              <><b>{selectedColumn.name}</b> selected — set its colour in the panel, or click the background to deselect.</>
            ) : (
              <span className="muted">Click the title or an axis label to edit it. Click a bar or point to select that series. Click a point to trace it back to its row.</span>
            )}
          </p>
        </div>

        <aside className="properties">
          {selectedColumn && (
            <div className="prop-group selected-group">
              <h3>{selectedColumn.name}</h3>
              <Field label="Colour">
                <div className="swatches">
                  {paletteFor(figure.style.palette).map((color) => (
                    <button key={color} className="swatch"
                      style={{ background: color, outline: figure.style.seriesColors[selectedColumn.id] === color ? '2px solid #131d1c' : 'none' }}
                      title={color}
                      onClick={() => updateStyle(figure.id, {
                        seriesColors: { ...figure.style.seriesColors, [selectedColumn.id]: color },
                      })} />
                  ))}
                  <input type="color" className="swatch-custom"
                    value={figure.style.seriesColors[selectedColumn.id]
                      ?? paletteFor(figure.style.palette)[
                        columns.findIndex((column) => column.id === selectedColumn.id) % paletteFor(figure.style.palette).length
                      ]}
                    onChange={(event) => updateStyle(figure.id, {
                      seriesColors: { ...figure.style.seriesColors, [selectedColumn.id]: event.target.value },
                    })}
                    title="Custom colour" />
                </div>
              </Field>
              {figure.style.seriesColors[selectedColumn.id] && (
                <button className="link" onClick={() => {
                  const next = { ...figure.style.seriesColors };
                  delete next[selectedColumn.id];
                  updateStyle(figure.id, { seriesColors: next });
                }}>Reset to palette colour</button>
              )}
            </div>
          )}

          <div className="prop-group">
            <h3>Plot</h3>
            <Field label="Type" hint={
              <>
                <strong>{PLOT_KINDS.find((kind) => kind.id === figure.plotType)?.label}</strong>
                <PlotThumbnail kind={figure.plotType} />
              </>
            }>
              <select value={figure.plotType}
                onChange={(event) => updateFigure(figure.id, { plotType: event.target.value as PlotType })}>
                {PLOT_GROUPS.map((group) => {
                  const kinds = available.filter((kind) => kind.group === group);
                  if (!kinds.length) return null;
                  return (
                    <optgroup key={group} label={group}>
                      {kinds.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                    </optgroup>
                  );
                })}
              </select>
            </Field>

            <Field label="Significance from" hint={
              <>Point this at an analysis to draw brackets with its adjusted p-values.
              The brackets follow the analysis, so correcting for multiple comparisons
              changes what the figure claims.</>
            }>
              <select value={figure.analysisId ?? ''}
                onChange={(event) => updateFigure(figure.id, { analysisId: event.target.value || null })}>
                <option value="">None</option>
                {project.analyses.filter((analysis) => analysis.tableId === table.id).map((analysis) => (
                  <option key={analysis.id} value={analysis.id}>{analysis.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Palette">
              <select value={figure.style.palette} onChange={(event) => updateStyle(figure.id, { palette: event.target.value })}>
                {Object.keys(PALETTES).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </Field>
          </div>

          <div className="prop-group">
            <h3>Axes</h3>
            <Field label="Gridlines" hint={
              <>Most journals prefer no gridlines, or faint horizontal ones only. They
              should never compete with the data.</>
            }>
              <select value={figure.style.grid} onChange={(event) => updateStyle(figure.id, { grid: event.target.value as any })}>
                <option value="none">None</option>
                <option value="horizontal">Horizontal only</option>
                <option value="vertical">Vertical only</option>
                <option value="both">Both</option>
              </select>
            </Field>
            <div className="field-row">
              <Field label="Y min">
                <input type="number" value={figure.style.yMin ?? ''} placeholder="auto"
                  onChange={(event) => updateStyle(figure.id, { yMin: event.target.value === '' ? null : Number(event.target.value) })} />
              </Field>
              <Field label="Y max">
                <input type="number" value={figure.style.yMax ?? ''} placeholder="auto"
                  onChange={(event) => updateStyle(figure.id, { yMax: event.target.value === '' ? null : Number(event.target.value) })} />
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={figure.style.logY}
                onChange={(event) => updateStyle(figure.id, { logY: event.target.checked })} />
              Log scale on Y
            </label>
            <label className="check">
              <input type="checkbox" checked={figure.style.logX}
                onChange={(event) => updateStyle(figure.id, { logX: event.target.checked })} />
              Log scale on X
            </label>
            <label className="check">
              <input type="checkbox" checked={figure.style.frame}
                onChange={(event) => updateStyle(figure.id, { frame: event.target.checked })} />
              Box the plot area
            </label>
          </div>

          <div className="prop-group">
            <h3>Marks</h3>
            <Field label="Error bars" hint={
              <>
                <strong>SD</strong> describes how spread the data are.{' '}
                <strong>SEM</strong> describes how precisely you know the mean, and
                is always smaller — it shrinks as you add replicates, which is why
                it flatters a figure. <strong>95% CI</strong> is the range the true
                mean plausibly lies in. Whichever you draw, say so in the caption.
              </>
            }>
              <select value={figure.style.errorBars} onChange={(event) => updateStyle(figure.id, { errorBars: event.target.value as any })}>
                <option value="sd">Standard deviation</option>
                <option value="sem">Standard error (SEM)</option>
                <option value="ci95">95% confidence interval</option>
                <option value="range">Min to max</option>
                <option value="none">None</option>
              </select>
            </Field>
            <div className="field-row">
              <Field label="Point size">
                <input type="number" min={1} max={14} value={figure.style.pointSize}
                  onChange={(event) => updateStyle(figure.id, { pointSize: Number(event.target.value) || 4 })} />
              </Field>
              <Field label="Bar width">
                <input type="number" min={0.1} max={1} step={0.05} value={figure.style.barWidth}
                  onChange={(event) => updateStyle(figure.id, { barWidth: Number(event.target.value) || 0.55 })} />
              </Field>
            </div>
            {['histogram', 'density'].includes(figure.plotType) && (
              <Field label="Bins">
                <input type="number" min={3} max={60} value={figure.style.bins}
                  onChange={(event) => updateStyle(figure.id, { bins: Number(event.target.value) || 12 })} />
              </Field>
            )}
            <label className="check">
              <input type="checkbox" checked={figure.style.showPoints}
                onChange={(event) => updateStyle(figure.id, { showPoints: event.target.checked })} />
              Show individual points
            </label>
            <label className="check">
              <input type="checkbox" checked={figure.style.showSignificance}
                onChange={(event) => updateStyle(figure.id, { showSignificance: event.target.checked })} />
              Show significance brackets
            </label>
            {hasLegend(figure.plotType) && (
              <label className="check">
                <input type="checkbox" checked={figure.style.showLegend}
                  onChange={(event) => updateStyle(figure.id, { showLegend: event.target.checked })} />
                Show legend
              </label>
            )}
            {hasLegend(figure.plotType) && figure.style.showLegend && (
              <>
                <Field label="Legend size" hint={
                  <>Drag the legend itself to move it. A moved legend stacks vertically,
                  because a legend gets moved when the row across the top was in the way.</>
                }>
                  <input type="range" min={0.6} max={1.8} step={0.05}
                    value={figure.style.legendScale}
                    onChange={(event) => updateStyle(figure.id, { legendScale: Number(event.target.value) })} />
                </Field>
                {figure.style.legendAt && (
                  <button onClick={() => updateStyle(figure.id, { legendAt: null })}>
                    Put the legend back
                  </button>
                )}
              </>
            )}
            <Field label="Label points with" hint={
              <>Right-click a point to ring it. A ring is how you say "this is the one"
              about a replicate that matters.</>
            }>
              <select value={figure.style.pointLabels}
                onChange={(event) => updateStyle(figure.id, { pointLabels: event.target.value as any })}>
                <option value="none">Nothing</option>
                <option value="value">Their value</option>
                <option value="row">Their row number</option>
                <option value="highlighted">Only the ringed ones</option>
              </select>
            </Field>
            {figure.style.highlights.length > 0 && (
              <button onClick={() => updateStyle(figure.id, { highlights: [] })}>
                Clear {figure.style.highlights.length} ringed point
                {figure.style.highlights.length === 1 ? '' : 's'}
              </button>
            )}
          </div>

          <div className="prop-group">
            <h3>Size</h3>
            <div className="field-row">
              <Field label="Width">
                <input type="number" value={figure.style.width}
                  onChange={(event) => updateStyle(figure.id, { width: Number(event.target.value) || 520 })} />
              </Field>
              <Field label="Height">
                <input type="number" value={figure.style.height}
                  onChange={(event) => updateStyle(figure.id, { height: Number(event.target.value) || 380 })} />
              </Field>
            </div>
            <Field label="Font size">
              <input type="number" min={8} max={26} value={figure.style.fontSize}
                onChange={(event) => updateStyle(figure.id, { fontSize: Number(event.target.value) || 13 })} />
            </Field>
          </div>

          {figure.style.errorBars !== 'none' && (
            <p className="properties-note">
              Error bars show{' '}
              {figure.style.errorBars === 'sd' ? 'the standard deviation'
                : figure.style.errorBars === 'sem' ? 'the standard error of the mean'
                : figure.style.errorBars === 'range' ? 'the full range'
                : 'the 95% confidence interval'}. State this in your caption.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function LayoutView({ id }: { id: string }) {
  const project = useStore((s) => s.project);
  const layout = project.layouts.find((entry) => entry.id === id);
  const updateLayout = useStore((s) => s.updateLayout);
  const addPanel = useStore((s) => s.addPanel);
  const removePanel = useStore((s) => s.removePanel);
  const movePanel = useStore((s) => s.movePanel);
  const renameNode = useStore((s) => s.renameNode);
  const notify = useStore((s) => s.notify);
  const select = useStore((s) => s.select);
  useSettings();
  const svgRef = useRef<HTMLDivElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const clipboard = useStore((s) => s.clipboard);
  const pasteIntoLayout = useStore((s) => s.pasteIntoLayout);
  const [selectedPanel, setSelectedPanel] = useState<number | null>(null);

  const paste = () => {
    if (!layout) return;
    const added = pasteIntoLayout(layout.id);
    if (added) notify(`Added ${added} panel${added === 1 ? '' : 's'}.`);
    else notify('Nothing to paste. Open a figure and press Copy first.');
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'v') return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      event.preventDefault();
      paste();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!layout) return <NothingSelected />;

  const panels: LayoutPanel[] = layout.panels
    .map((figureId) => project.figures.find((figure) => figure.id === figureId))
    .filter((figure): figure is NonNullable<typeof figure> => Boolean(figure))
    .map((figure) => {
      const table = tableById(project, figure.tableId);
      const analysis = analysisById(project, figure.analysisId);
      return {
        figure,
        table: table!,
        result: table && analysis ? resultFor(table, analysis) : null,
      };
    })
    .filter((panel) => Boolean(panel.table));



  /**
   * Dragging a panel turns the layout free-form, starting from wherever the
   * grid had already put everything: nothing jumps at the moment it stops
   * being automatic.
   */
  const grabPanel = (index: number, mode: 'move' | 'resize', event: React.MouseEvent) => {
    if (!layout) return;
    event.preventDefault();
    event.stopPropagation();

    const svg = svgRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;
    // The figure is drawn at its own scale and displayed at another; a drag of
    // one screen pixel has to move the panel by one figure unit, not one pixel.
    const box = svg.getBoundingClientRect();
    const viewWidth = svg.viewBox.baseVal.width || box.width;
    const scale = box.width ? viewWidth / box.width : 1;

    const start = gridFrames(panels, layout.columns, layout.gap, layout.labelStyle).frames;
    const current = panels.map((_, at) => layout.frames?.[at] ?? start[at]);
    const origin = { x: event.clientX, y: event.clientY };
    const from = { ...current[index] };

    const onMove = (move: MouseEvent) => {
      const dx = (move.clientX - origin.x) * scale;
      const dy = (move.clientY - origin.y) * scale;
      const next = current.map((frame, at) => {
        if (at !== index) return frame;
        return mode === 'move'
          ? { ...from, x: Math.max(0, Math.round(from.x + dx)), y: Math.max(0, Math.round(from.y + dy)) }
          : {
              ...from,
              width: Math.max(80, Math.round(from.width + dx)),
              height: Math.max(60, Math.round(from.height + dy)),
            };
      });
      updateLayout(layout.id, { frames: next });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const unused = project.figures.filter((figure) => !layout.panels.includes(figure.id));

  return (
    <div className="view">
      <ViewHead eyebrow={`Layout · ${panels.length} panel${panels.length === 1 ? '' : 's'}`} title={layout.name}
        onRename={(name) => renameNode('layout', layout.id, name)}>
        <button onClick={paste} disabled={!clipboard.length}
          title={clipboard.length ? `Paste ${clipboard.length} copied figure(s) (⌘V)` : 'Copy a figure first'}>
          Paste
        </button>
        <button onClick={() => setExportOpen(true)}>Export…</button>
      </ViewHead>

      {exportOpen && (
        <ExportDialog
          name={layout.name}
          getNode={() => svgRef.current?.querySelector('svg') as SVGSVGElement | null}
          onClose={() => setExportOpen(false)}
        />
      )}

      <div className="figure-layout">
        <div>
          <div className="canvas layout-canvas" ref={svgRef}>
            <LayoutFigure panels={panels} columns={layout.columns} gap={layout.gap}
              labelStyle={layout.labelStyle}
              labelFor={(index) => panelLabel(layout.labelStyle, index)}
              frames={layout.frames}
              selected={selectedPanel}
              onSelect={setSelectedPanel}
              onGrab={grabPanel} />
          </div>
          <p className="trace muted">
            {layout.frames?.some(Boolean)
              ? 'Drag a panel to move it, or its corner to resize. Panels use each figure as it stands.'
              : 'Drag a panel to place it freely, or its corner to resize. Until then it follows the grid.'}
          </p>
        </div>

        <aside className="properties">
          <div className="prop-group">
            <h3>Arrangement</h3>
            <Field label="Panels per row" hint={
              <>Ignored once you drag a panel: the layout is then whatever you
              arranged, and "Back to the grid" is how you get this back.</>
            }>
              <input type="number" min={1} max={6} value={layout.columns}
                onChange={(event) => updateLayout(layout.id, { columns: Math.max(1, Number(event.target.value) || 1) })} />
            </Field>
            {layout.frames?.some(Boolean) && (
              <button onClick={() => {
                updateLayout(layout.id, { frames: undefined });
                setSelectedPanel(null);
                notify('Panels are back on the grid.');
              }}>Back to the grid</button>
            )}
            <Field label="Panel labels">
              <select value={layout.labelStyle}
                onChange={(event) => updateLayout(layout.id, { labelStyle: event.target.value as any })}>
                <option value="A">A, B, C</option>
                <option value="a">a, b, c</option>
                <option value="1">1, 2, 3</option>
                <option value="none">None</option>
              </select>
            </Field>
            <Field label="Gap between panels">
              <input type="number" min={0} max={80} value={layout.gap}
                onChange={(event) => updateLayout(layout.id, { gap: Math.max(0, Number(event.target.value) || 0) })} />
            </Field>
          </div>

          <div className="prop-group">
            <h3>Panels</h3>
            {!panels.length && <p className="nav-hint">No panels yet.</p>}
            <ol className="panel-list">
              {layout.panels.map((figureId, index) => {
                const figure = project.figures.find((entry) => entry.id === figureId);
                return (
                  <li key={`${figureId}-${index}`}>
                    <span className="panel-badge">{panelLabel(layout.labelStyle, index) || index + 1}</span>
                    <button className="panel-name" onClick={() => figure && select({ kind: 'figure', id: figure.id })}>
                      {figure?.name ?? 'missing figure'}
                    </button>
                    <span className="panel-controls">
                      <button onClick={() => movePanel(layout.id, index, -1)} disabled={index === 0} title="Move up">↑</button>
                      <button onClick={() => movePanel(layout.id, index, 1)} disabled={index === layout.panels.length - 1} title="Move down">↓</button>
                      <button onClick={() => removePanel(layout.id, index)} title="Remove from layout">×</button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          {unused.length > 0 && (
            <div className="prop-group">
              <h3>Add a figure</h3>
              <div className="chips">
                {unused.map((figure) => (
                  <button key={figure.id} className="chip" onClick={() => addPanel(layout.id, figure.id)}>
                    ＋ {figure.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function HelpView() {
  const [openMethod, setOpenMethod] = useState<string | null>(null);

  return (
    <div className="view help">
      <div className="view-head">
        <div>
          <span className="eyebrow">Help</span>
          <h1 className="view-title-static">Choosing and running a test</h1>
        </div>
      </div>

      <p className="hint">
        AssayPlot will not choose a test for you. The right one depends on how the
        experiment was done, which the software cannot see. This page says what each
        one answers, what it needs, and what it does not tell you.
      </p>

      <section className="panel">
        <h3>Table shapes</h3>
        <p className="help-lede">
          The shape you pick decides which analyses and plots are offered, so start here.
        </p>
        <div className="shape-grid">
          {(Object.keys(SHAPE_HELP) as (keyof typeof SHAPE_HELP)[]).map((shape) => (
            <article key={shape} className="shape-card">
              <h4>{SHAPE_HELP[shape].title}</h4>
              <p>{SHAPE_HELP[shape].body}</p>
              <pre>{SHAPE_HELP[shape].example}</pre>
            </article>
          ))}
        </div>
      </section>

      {METHOD_FAMILIES.map((family) => {
        const methods = METHODS.filter((method) => method.family === family);
        if (!methods.length) return null;
        return (
          <section className="panel" key={family}>
            <h3>{family}</h3>
            {methods.map((method) => {
              const help = METHOD_HELP[method.id];
              const isOpen = openMethod === method.id;
              return (
                <article key={method.id} className={`help-method ${isOpen ? 'open' : ''}`}>
                  <button className="help-summary"
                    aria-expanded={isOpen}
                    onClick={() => setOpenMethod(isOpen ? null : method.id)}>
                    <span className="help-name">{method.label}</span>
                    <span className="help-answers">{help.answers}</span>
                    <span className="help-chevron" aria-hidden="true">{isOpen ? '−' : '+'}</span>
                  </button>

                  {isOpen && (
                    <div className="help-detail">
                      <dl>
                        <dt>Needs</dt>
                        <dd>{help.needs}</dd>

                        <dt>Assumes</dt>
                        <dd><ul>{help.assumes.map((item) => <li key={item}>{item}</li>)}</ul></dd>

                        <dt>Does not</dt>
                        <dd><ul>{help.doesNot.map((item) => <li key={item}>{item}</li>)}</ul></dd>

                        <dt>How</dt>
                        <dd><ol>{help.how.map((item) => <li key={item}>{item}</li>)}</ol></dd>

                        <dt>Report</dt>
                        <dd>{help.reports}</dd>

                        {help.insteadUse && (<><dt>Consider instead</dt><dd>{help.insteadUse}</dd></>)}
                      </dl>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}

      <section className="panel">
        <h3>Reading a result</h3>
        <ul className="help-points">
          <li><strong>The confidence interval says more than the P value.</strong> It tells you how big the effect might plausibly be; a P value only says whether you can rule out exactly zero.</li>
          <li><strong>A large P value is not evidence of no effect.</strong> With six replicates you are unlikely to detect anything but a large one.</li>
          <li><strong>Say which error bars you drew.</strong> SD, SEM and 95% CI look similar and mean different things. A figure that does not say is unreviewable.</li>
          <li><strong>Correct for multiple comparisons.</strong> Three groups means three tests and three chances at a false positive. Tukey and Dunn handle this properly.</li>
          <li><strong>Decide the analysis before you see the data.</strong> Trying tests until one is significant produces a number that means nothing.</li>
        </ul>
      </section>

      <section className="panel">
        <h3>What AssayPlot does not do</h3>
        <ul className="help-points">
          <li>Repeated-measures ANOVA, three-way ANOVA, mixed-effects models and Cox regression are not implemented.</li>
          <li>Dose–response fits report no confidence interval on the EC50 yet.</li>
          <li>There are no subcolumn replicates: use one row per replicate.</li>
          <li>It is <strong>not validated for clinical or regulatory use</strong>. For anything consequential, confirm the result with a statistician.</li>
        </ul>
      </section>
    </div>
  );
}

function NothingSelected() {
  const addTable = useStore((s) => s.addTable);
  return (
    <div className="empty-stage">
      <h2>Nothing open</h2>
      <p>Import a file from the toolbar, or start a new data table.</p>
      <button className="primary" onClick={() => addTable('column')}>New data table</button>
    </div>
  );
}

function ViewHead({ eyebrow, title, onRename, children }: {
  eyebrow: string; title: string; onRename: (name: string) => void; children?: React.ReactNode;
}) {
  return (
    <div className="view-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <input className="view-title" value={title} onChange={(event) => onRename(event.target.value)} aria-label="Name" />
      </div>
      <div className="view-actions">{children}</div>
    </div>
  );
}

function Field({ label, children, hint, hintAlign = 'right' }: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  hintAlign?: 'left' | 'right';
}) {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <Hint align={hintAlign}>{hint}</Hint>}
      </span>
      {children}
    </label>
  );
}

/** A small ? that explains a control, and can show a worked example. */
function Hint({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="hint-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}>
      <button type="button" className="hint-button"
        aria-expanded={open}
        aria-label="What is this?"
        onClick={(event) => { event.preventDefault(); setOpen(!open); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}>
        ?
      </button>
      {open && <span className={`hint-popover ${align}`} role="tooltip">{children}</span>}
    </span>
  );
}

/** A miniature of a plot type, drawn so the picker can show what it means. */
function PlotThumbnail({ kind }: { kind: PlotType }) {
  const table = useMemo(() => demoThumbnailTable(kind), [kind]);
  const figure = useMemo(() => ({
    ...makeFigure('preview', table.id, kind),
    style: defaultStyle({
      width: 220, height: 130, fontSize: 8, pointSize: 2.5,
      showLegend: false, grid: 'none', showSignificance: false,
    }),
  }), [kind, table.id]);

  return <Plot table={table} figure={figure} />;
}
