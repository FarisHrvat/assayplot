import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Cell,
  type Correction,
  type DataTable,
  type Method,
  type PlotType,
  type TableShape,
  APP_VERSION,
  SHAPE_INFO,
  METHOD_FAMILIES,
  availableMethods,
  panelLabel,
  columnValues,
  emptyProject,
  formatP,
  methodInfo,
  methodsSentence,
  significanceStars,
  valueColumns,
} from './model.ts';
import { analysisById, markSaved, resultFor, startAutosave, tableById, useStore, type Selection } from './store.ts';
import { clearSnapshot, readSnapshot, type Snapshot } from './persist.ts';
import {
  LayoutFigure, Plot, PALETTES, PLOT_GROUPS,
  paletteFor, plotsForShape, type LayoutPanel, type Selected,
} from './plot.tsx';
import {
  IMPORT_EXTENSIONS,
  deserializeProject,
  download,
  parseClipboard,
  serializeProject,
  svgSource,
  svgToPng,
  tableFromFile,
  tableToCsv,
} from './io.ts';

// ===========================================================================
// error boundary
// ===========================================================================

interface BoundaryState { error: Error | null }

/**
 * A rendering fault must never cost someone their data. The boundary keeps the
 * autosaved snapshot intact and offers to download the project as it stands, so
 * a bug in one figure cannot take an afternoon's work with it.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
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
              const safe = project.name.replace(/[^\w\-. ]+/g, '_').trim() || 'recovered';
              download(`${safe}-recovered.assayplot`, bytes, 'application/zip');
            } catch {
              alert('The project could not be packaged. Reload and use the autosaved copy.');
            }
          }}>Download my project</button>
          <button onClick={() => window.location.reload()}>Reload AssayPlot</button>
        </div>
        <details>
          <summary>Technical detail</summary>
          <pre>{this.state.error.stack ?? String(this.state.error)}</pre>
        </details>
      </div>
    );
  }
}

// ===========================================================================
// app
// ===========================================================================

export function App() {
  const selection = useStore((s) => s.selection);
  const toast = useStore((s) => s.toast);
  const notify = useStore((s) => s.notify);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [recovery, setRecovery] = useState<Snapshot | null>(null);

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
    <div className="app">
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
      <div className="body">
        <Navigator />
        <main className="stage">
          {selection.kind === 'table' && <TableView key={selection.id} id={selection.id} />}
          {selection.kind === 'analysis' && <AnalysisView key={selection.id} id={selection.id} />}
          {selection.kind === 'figure' && <FigureView key={selection.id} id={selection.id} />}
          {selection.kind === 'layout' && <LayoutView key={selection.id} id={selection.id} />}
        </main>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// ===========================================================================
// toolbar
// ===========================================================================

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

  const openRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const save = () => {
    // Copy into a plain ArrayBuffer so the Blob constructor accepts it.
    const bytes = new Uint8Array(serializeProject(project)).slice().buffer;
    const safe = project.name.replace(/[^\w\-. ]+/g, '_').trim() || 'project';
    download(`${safe}.assayplot`, bytes, 'application/zip');
    markSaved();
    notify('Project saved.');
  };

  const newProject = () => {
    if (dirty && !confirm('Start a new project? Unsaved changes in this one will be lost.')) return;
    replaceProject(emptyProject());
    notify('New project started.');
  };

  const open = async (file: File) => {
    if (dirty && !confirm('Open this project? Unsaved changes in the current one will be lost.')) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      replaceProject(deserializeProject(bytes));
      notify(`Opened ${file.name}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That file could not be opened.');
    }
  };

  const importData = async (files: FileList) => {
    const added: string[] = [];
    let next = useStore.getState().project;
    for (const file of Array.from(files)) {
      try {
        const table = await tableFromFile(file);
        next = { ...next, tables: [...next.tables, table] };
        added.push(`${table.name} (${table.rows.length} × ${table.columns.length})`);
      } catch (error) {
        notify(error instanceof Error ? error.message : `${file.name} could not be read.`);
        return;
      }
    }
    commit(next);
    const last = next.tables[next.tables.length - 1];
    if (last) select({ kind: 'table', id: last.id });
    notify(`Imported ${added.join(', ')}.`);
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
        <button onClick={() => openRef.current?.click()}>Open</button>
        <button className="primary" onClick={save}>Save project</button>
      </div>

      <input ref={openRef} type="file" accept=".assayplot,.zip,.json" hidden
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

// ===========================================================================
// navigator
// ===========================================================================

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

  const activeTableId =
    selection.kind === 'table'
      ? selection.id
      : selection.kind === 'analysis'
        ? analysisById(project, selection.id)?.tableId ?? project.tables[0]?.id
        : project.figures.find((figure) => figure.id === selection.id)?.tableId ?? project.tables[0]?.id;

  const remove = (kind: Selection['kind'], id: string, name: string) => {
    if (kind === 'table') {
      const analyses = project.analyses.filter((analysis) => analysis.tableId === id).length;
      const figures = project.figures.filter((figure) => figure.tableId === id).length;
      const attached = analyses + figures;
      const detail = attached
        ? `\n\nThis also closes ${analyses} analysis${analyses === 1 ? '' : 'es'} and ${figures} figure${figures === 1 ? '' : 's'} built on it.`
        : '';
      if (!confirm(`Close "${name}"?${detail}`)) return;
    } else if (!confirm(`Delete "${name}"?`)) return;
    deleteNode(kind, id);
    notify(`Closed ${name}.`);
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

      <div className="nav-foot">
        <span>AssayPlot {APP_VERSION}</span>
        <span className="nav-foot-note">Offline. Nothing leaves this machine.</span>
      </div>
    </nav>
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

// ===========================================================================
// data table
// ===========================================================================

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
        <button onClick={() => download(`${table.name}.csv`, tableToCsv(table), 'text/csv')}>Export CSV</button>
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
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && rowIndex === table.rows.length - 1) addRow(table.id);
                        }}
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

// ===========================================================================
// analysis
// ===========================================================================

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
    !['normality', 'outlier', 'descriptive'].includes(analysis.method);

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
      <ViewHead eyebrow={`Analysis · from ${table.name}`} title={analysis.name}
        onRename={(name) => renameNode('analysis', analysis.id, name)}>
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

          {(analysis.method === 'onesample' || analysis.method === 'doseresponse' || isGroupComparison) && (
            <section className="panel">
              <h3>Options</h3>
              {analysis.method === 'onesample' && (
                <Field label="Compare the mean against">
                  <input type="number" value={analysis.options.hypothesised ?? 0}
                    onChange={(event) => setOption({ hypothesised: Number(event.target.value) || 0 })} />
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

// ===========================================================================
// figure
// ===========================================================================

function FigureView({ id }: { id: string }) {
  const project = useStore((s) => s.project);
  const figure = project.figures.find((entry) => entry.id === id);
  const updateFigure = useStore((s) => s.updateFigure);
  const updateStyle = useStore((s) => s.updateStyle);
  const renameNode = useStore((s) => s.renameNode);
  const notify = useStore((s) => s.notify);
  const select = useStore((s) => s.select);
  const svgRef = useRef<HTMLDivElement>(null);

  const [traced, setTraced] = useState<number | null>(null);
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

  const exportSvg = () => {
    const node = svgRef.current?.querySelector('svg');
    if (!node) return;
    setEditing(null);
    download(`${figure.name}.svg`, svgSource(node as SVGSVGElement), 'image/svg+xml');
    notify('SVG exported — text stays editable in Illustrator.');
  };

  const exportPng = async (dpi: number) => {
    const node = svgRef.current?.querySelector('svg');
    if (!node) return;
    setEditing(null);
    try {
      const blob = await svgToPng(node as SVGSVGElement, dpi);
      download(`${figure.name}-${dpi}dpi.png`, blob, 'image/png');
      notify(`PNG exported at ${dpi} DPI.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const traceRow = useCallback((rowIndex: number) => {
    setTraced((current) => (current === rowIndex ? null : rowIndex));
  }, []);

  const selectedColumn = selected?.kind === 'series'
    ? columns.find((column) => column.id === selected.columnId)
    : null;

  return (
    <div className="view">
      <ViewHead eyebrow={`Figure · from ${table.name}`} title={figure.name}
        onRename={(name) => renameNode('figure', figure.id, name)}>
        <button onClick={() => select({ kind: 'table', id: table.id })}>Open data</button>
        <button onClick={exportSvg}>Export SVG</button>
        <button onClick={() => exportPng(300)}>PNG 300 dpi</button>
        <button onClick={() => exportPng(600)}>PNG 600 dpi</button>
      </ViewHead>

      <div className="figure-layout">
        <div>
          <div className="canvas" ref={svgRef}>
            <Plot table={table} figure={figure} result={result}
              onPickRow={traceRow} highlightRow={traced}
              selected={selected} onSelect={onSelect}
              editing={editing} onEditText={onEditText} onFinishEdit={() => setEditing(null)} />
          </div>
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
            <Field label="Type">
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

            <Field label="Significance from">
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
            <Field label="Gridlines">
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
              <input type="checkbox" checked={figure.style.frame}
                onChange={(event) => updateStyle(figure.id, { frame: event.target.checked })} />
              Box the plot area
            </label>
          </div>

          <div className="prop-group">
            <h3>Marks</h3>
            <Field label="Error bars">
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
            <label className="check">
              <input type="checkbox" checked={figure.style.showLegend}
                onChange={(event) => updateStyle(figure.id, { showLegend: event.target.checked })} />
              Show legend
            </label>
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

// ===========================================================================
// multi-panel layout
// ===========================================================================

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
  const svgRef = useRef<HTMLDivElement>(null);

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

  const exportSvg = () => {
    const node = svgRef.current?.querySelector('svg');
    if (!node) return;
    download(`${layout.name}.svg`, svgSource(node as SVGSVGElement), 'image/svg+xml');
    notify('Layout exported as SVG.');
  };

  const exportPng = async (dpi: number) => {
    const node = svgRef.current?.querySelector('svg');
    if (!node) return;
    try {
      const blob = await svgToPng(node as SVGSVGElement, dpi);
      download(`${layout.name}-${dpi}dpi.png`, blob, 'image/png');
      notify(`Layout exported at ${dpi} DPI.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const unused = project.figures.filter((figure) => !layout.panels.includes(figure.id));

  return (
    <div className="view">
      <ViewHead eyebrow={`Layout · ${panels.length} panel${panels.length === 1 ? '' : 's'}`} title={layout.name}
        onRename={(name) => renameNode('layout', layout.id, name)}>
        <button onClick={exportSvg}>Export SVG</button>
        <button onClick={() => exportPng(300)}>PNG 300 dpi</button>
        <button onClick={() => exportPng(600)}>PNG 600 dpi</button>
      </ViewHead>

      <div className="figure-layout">
        <div>
          <div className="canvas layout-canvas" ref={svgRef}>
            <LayoutFigure panels={panels} columns={layout.columns} gap={layout.gap}
              labelStyle={layout.labelStyle}
              labelFor={(index) => panelLabel(layout.labelStyle, index)} />
          </div>
          <p className="trace muted">
            Panels use each figure as it stands. Edit a figure to change its panel.
          </p>
        </div>

        <aside className="properties">
          <div className="prop-group">
            <h3>Arrangement</h3>
            <Field label="Panels per row">
              <input type="number" min={1} max={6} value={layout.columns}
                onChange={(event) => updateLayout(layout.id, { columns: Math.max(1, Number(event.target.value) || 1) })} />
            </Field>
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

// ===========================================================================
// shared
// ===========================================================================

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
