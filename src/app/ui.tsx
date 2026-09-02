import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Analysis,
  type Cell,
  type DataTable,
  type Figure,
  type Method,
  type PlotType,
  APP_VERSION,
  analysisColumns,
  availableMethods,
  columnValues,
  formatP,
  methodInfo,
  methodsSentence,
  significanceStars,
  valueColumns,
} from './model.ts';
import { analysisById, resultFor, tableById, useStore, type Selection } from './store.ts';
import { Plot, PALETTES } from './plot.tsx';
import {
  deserializeProject,
  download,
  parseClipboard,
  serializeProject,
  svgSource,
  svgToPng,
  tableFromDelimited,
  tableToCsv,
} from './io.ts';

// ===========================================================================
// app
// ===========================================================================

export function App() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const toast = useStore((s) => s.toast);
  const notify = useStore((s) => s.notify);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => notify(null), 3200);
    return () => clearTimeout(timer);
  }, [toast, notify]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      if (event.key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return (
    <div className="app">
      <Toolbar canUndo={canUndo} canRedo={canRedo} />
      <div className="body">
        <Navigator />
        <main className="stage">
          {selection.kind === 'table' && <TableView key={selection.id} id={selection.id} />}
          {selection.kind === 'analysis' && <AnalysisView key={selection.id} id={selection.id} />}
          {selection.kind === 'figure' && <FigureView key={selection.id} id={selection.id} />}
          {!project.tables.length && selection.kind === 'table' && <Empty />}
        </main>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Empty() {
  const addTable = useStore((s) => s.addTable);
  return (
    <div className="empty-stage">
      <h2>No data yet</h2>
      <p>Create a table, or import a CSV from the toolbar.</p>
      <button className="primary" onClick={() => addTable('column')}>New data table</button>
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
    download(`${safe}.statista`, bytes, 'application/zip');
    useStore.setState({ dirty: false });
    notify('Project saved.');
  };

  const open = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      replaceProject(deserializeProject(bytes));
      notify(`Opened ${file.name}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That file could not be opened.');
    }
  };

  const importData = async (file: File) => {
    try {
      const text = await file.text();
      const table = tableFromDelimited(text, file.name.replace(/\.[^.]+$/, ''));
      commit({ ...project, tables: [...project.tables, table] });
      select({ kind: 'table', id: table.id });
      notify(`Imported ${table.rows.length} rows and ${table.columns.length} columns.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That file could not be read.');
    }
  };

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="mark" aria-hidden="true">∿</span>
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
        <button onClick={() => importRef.current?.click()}>Import CSV</button>
        <button onClick={() => openRef.current?.click()}>Open</button>
        <button className="primary" onClick={save}>Save project</button>
      </div>

      <input
        ref={openRef}
        type="file"
        accept=".statista,.zip,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) open(file);
          event.target.value = '';
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".csv,.tsv,.txt"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) importData(file);
          event.target.value = '';
        }}
      />
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
  const deleteNode = useStore((s) => s.deleteNode);

  const activeTableId =
    selection.kind === 'table'
      ? selection.id
      : selection.kind === 'analysis'
        ? analysisById(project, selection.id)?.tableId ?? project.tables[0]?.id
        : project.figures.find((f) => f.id === selection.id)?.tableId ?? project.tables[0]?.id;

  const isActive = (kind: Selection['kind'], id: string) =>
    selection.kind === kind && selection.id === id;

  const Item = ({ kind, id, name, badge }: { kind: Selection['kind']; id: string; name: string; badge?: string }) => (
    <div className={`nav-item ${isActive(kind, id) ? 'active' : ''}`}>
      <button className="nav-label" onClick={() => select({ kind, id })}>
        <span className="nav-name">{name}</span>
        {badge && <span className="nav-badge">{badge}</span>}
      </button>
      <button
        className="nav-delete"
        title={`Delete ${name}`}
        onClick={() => {
          if (confirm(`Delete "${name}"? Anything built from it is removed too.`)) deleteNode(kind, id);
        }}
      >
        ×
      </button>
    </div>
  );

  return (
    <nav className="navigator" aria-label="Project contents">
      <Section
        title="Data tables"
        action={<button onClick={() => addTable('column')} title="New data table">＋</button>}
      >
        {project.tables.map((table) => (
          <Item
            key={table.id}
            kind="table"
            id={table.id}
            name={table.name}
            badge={table.shape === 'xy' ? 'XY' : `${valueColumns(table).length} col`}
          />
        ))}
      </Section>

      <Section
        title="Analyses"
        action={<button onClick={() => activeTableId && addAnalysis(activeTableId)} title="New analysis">＋</button>}
      >
        {project.analyses.length === 0 && <p className="nav-hint">Analyses stay linked to their table.</p>}
        {project.analyses.map((analysis) => {
          const table = tableById(project, analysis.tableId);
          const result = table ? resultFor(table, analysis) : null;
          return (
            <Item
              key={analysis.id}
              kind="analysis"
              id={analysis.id}
              name={analysis.name}
              badge={result?.error ? '!' : result?.pValue != null ? formatP(result.pValue) : undefined}
            />
          );
        })}
      </Section>

      <Section
        title="Figures"
        action={<button onClick={() => activeTableId && addFigure(activeTableId)} title="New figure">＋</button>}
      >
        {project.figures.map((figure) => (
          <Item key={figure.id} kind="figure" id={figure.id} name={figure.name} badge={figure.plotType} />
        ))}
      </Section>

      <div className="nav-foot">
        <span>Statista {APP_VERSION}</span>
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

  if (!table) return <Empty />;

  const dependents = useMemo(
    () => ({
      analyses: project.analyses.filter((a) => a.tableId === table.id),
      figures: project.figures.filter((f) => f.tableId === table.id),
    }),
    [project.analyses, project.figures, table.id]
  );

  const onPaste = (event: React.ClipboardEvent, row: number, column: number) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
    event.preventDefault();
    const block = parseClipboard(text);
    setCells(table.id, row, column, block);
    notify(`Pasted ${block.length} × ${block[0]?.length ?? 0} cells.`);
  };

  return (
    <div className="view">
      <ViewHead
        eyebrow={`Data table · ${table.shape === 'xy' ? 'XY' : 'Column'}`}
        title={table.name}
        onRename={(name) => renameNode('table', table.id, name)}
      >
        <select
          value={table.shape}
          onChange={(event) => setTableShape(table.id, event.target.value as any)}
          aria-label="Table shape"
        >
          <option value="column">Column — each column is a group</option>
          <option value="xy">XY — first column is X</option>
        </select>
        <button onClick={() => addAnalysis(table.id)}>Analyse</button>
        <button onClick={() => addFigure(table.id)}>Graph</button>
        <button onClick={() => download(`${table.name}.csv`, tableToCsv(table), 'text/csv')}>
          Export CSV
        </button>
      </ViewHead>

      <p className="hint">
        Type into any cell. Paste a block straight from Excel. Every change flows through to
        the {dependents.analyses.length} analysis{dependents.analyses.length === 1 ? '' : 'es'} and{' '}
        {dependents.figures.length} figure{dependents.figures.length === 1 ? '' : 's'} built on this table.
      </p>

      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th className="corner" />
              {table.columns.map((column, columnIndex) => (
                <th key={column.id}>
                  <div className="col-head">
                    <input
                      value={column.name}
                      onChange={(event) => renameColumn(table.id, column.id, event.target.value)}
                      aria-label={`Name of column ${columnIndex + 1}`}
                    />
                    <button
                      className="col-delete"
                      title="Delete column"
                      onClick={() => deleteColumn(table.id, columnIndex)}
                      disabled={table.columns.length <= 1}
                    >
                      ×
                    </button>
                  </div>
                  {table.shape === 'xy' && (
                    <span className="col-role">{column.role === 'x' ? 'X' : 'Y'}</span>
                  )}
                </th>
              ))}
              <th className="add-col">
                <button onClick={() => addColumn(table.id)} title="Add column">＋</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="row-head">
                  <span>{rowIndex + 1}</span>
                  <button
                    title="Delete row"
                    onClick={() => deleteRow(table.id, rowIndex)}
                    disabled={table.rows.length <= 1}
                  >
                    ×
                  </button>
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
                          const next: Cell =
                            trimmed === '' ? null : Number.isFinite(Number(trimmed)) ? Number(trimmed) : text;
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
          </tbody>
        </table>
      </div>

      <div className="grid-actions">
        <button onClick={() => addRow(table.id)}>＋ Row</button>
        <span className="counts">
          {table.rows.length} rows · {table.columns.length} columns ·{' '}
          {valueColumns(table).reduce((sum, column) => sum + columnValues(table, column.id).length, 0)} numeric values
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
          const sd = Math.sqrt(
            values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1)
          );
          return (
            <div key={column.id} className="summary-card">
              <span className="summary-name">{column.name}</span>
              <strong>{mean.toFixed(2)}</strong>
              <span className="summary-note">
                ± {Number.isFinite(sd) ? sd.toFixed(2) : '—'} SD · n = {values.length}
              </span>
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

  if (!analysis) return <Empty />;
  const table = tableById(project, analysis.tableId);
  if (!table) return <div className="view"><p>This analysis has lost its data table.</p></div>;

  const result = resultFor(table, analysis);
  const options = availableMethods(table);
  const info = methodInfo(analysis.method);
  const candidates = valueColumns(table);
  const chosen = analysis.options.columnIds ?? candidates.map((column) => column.id);
  const needsPair = ['welch', 'student', 'paired', 'mannwhitney', 'wilcoxon'].includes(analysis.method);
  const isGroupTest = !['correlation', 'spearman', 'regression', 'descriptive'].includes(analysis.method);
  const sentence = methodsSentence(table, analysis, result);

  const toggleColumn = (columnId: string) => {
    const current = new Set(chosen);
    if (current.has(columnId)) current.delete(columnId);
    else current.add(columnId);
    const ordered = candidates.filter((column) => current.has(column.id)).map((column) => column.id);
    updateAnalysis(analysis.id, { options: { ...analysis.options, columnIds: ordered } });
  };

  return (
    <div className="view">
      <ViewHead
        eyebrow={`Analysis · from ${table.name}`}
        title={analysis.name}
        onRename={(name) => renameNode('analysis', analysis.id, name)}
      >
        <button onClick={() => select({ kind: 'table', id: table.id })}>Open data</button>
      </ViewHead>

      <div className="split">
        <section className="panel">
          <h3>Method</h3>
          <div className="method-list">
            {options.map(({ info: candidate, usable, why }) => (
              <label key={candidate.id} className={`method ${usable ? '' : 'disabled'} ${analysis.method === candidate.id ? 'chosen' : ''}`}>
                <input
                  type="radio"
                  name={`method-${analysis.id}`}
                  checked={analysis.method === candidate.id}
                  disabled={!usable}
                  onChange={() => updateAnalysis(analysis.id, { method: candidate.id as Method })}
                />
                <span>
                  <strong>{candidate.label}</strong>
                  <em>{why}</em>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Result</h3>
          {result.error ? (
            <div className="error-box">
              <strong>Cannot run this yet</strong>
              <p>{result.error}</p>
            </div>
          ) : (
            <>
              <div className="metrics">
                {result.summary.map((entry) => (
                  <div key={entry.label} className="metric">
                    <span className="metric-label">{entry.label}</span>
                    <strong>{entry.value}</strong>
                    {entry.note && <small>{entry.note}</small>}
                  </div>
                ))}
              </div>

              {result.warnings.map((warning) => (
                <p key={warning} className="warn">{warning}</p>
              ))}

              <div className="assumption">
                <strong>What this assumes</strong>
                <p>{info.assumes}</p>
              </div>
            </>
          )}
        </section>
      </div>

      {isGroupTest && candidates.length > 2 && (
        <section className="panel">
          <h3>Columns to compare {needsPair && <span className="tag">pick exactly two</span>}</h3>
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
          <div className="panel-head">
            <h3>Pairwise comparisons</h3>
            <label className="inline-field">
              Correction
              <select
                value={analysis.options.correction ?? 'holm'}
                onChange={(event) =>
                  updateAnalysis(analysis.id, { options: { ...analysis.options, correction: event.target.value as any } })
                }
              >
                <option value="holm">Holm</option>
                <option value="bh">Benjamini–Hochberg (FDR)</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
          <div className="table-scroll">
            <table className="results">
              <thead>
                <tr><th>Comparison</th><th>P (raw)</th><th>P (adjusted)</th><th></th></tr>
              </thead>
              <tbody>
                {result.comparisons.map((comparison, index) => (
                  <tr key={index}>
                    <td>{comparison.labelA} vs {comparison.labelB}</td>
                    <td className="num">{formatP(comparison.pValue)}</td>
                    <td className="num">{formatP(comparison.pAdjusted)}</td>
                    <td><span className={`stars ${comparison.pAdjusted < 0.05 ? 'sig' : ''}`}>{significanceStars(comparison.pAdjusted)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sentence && (
        <section className="panel">
          <div className="panel-head">
            <h3>Methods text</h3>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(sentence);
                notify('Methods sentence copied.');
              }}
            >
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

const PLOT_TYPES: { id: PlotType; label: string; xyOnly?: boolean; groupOnly?: boolean }[] = [
  { id: 'bar', label: 'Bar + points', groupOnly: true },
  { id: 'dot', label: 'Dot plot', groupOnly: true },
  { id: 'box', label: 'Box plot', groupOnly: true },
  { id: 'violin', label: 'Violin', groupOnly: true },
  { id: 'scatter', label: 'Scatter', xyOnly: true },
  { id: 'line', label: 'Line', xyOnly: true },
];

function FigureView({ id }: { id: string }) {
  const project = useStore((s) => s.project);
  const figure = project.figures.find((f) => f.id === id);
  const updateFigure = useStore((s) => s.updateFigure);
  const updateStyle = useStore((s) => s.updateStyle);
  const renameNode = useStore((s) => s.renameNode);
  const notify = useStore((s) => s.notify);
  const select = useStore((s) => s.select);
  const svgRef = useRef<HTMLDivElement>(null);
  const [traced, setTraced] = useState<number | null>(null);

  if (!figure) return <Empty />;
  const table = tableById(project, figure.tableId);
  if (!table) return <div className="view"><p>This figure has lost its data table.</p></div>;

  const linked = analysisById(project, figure.analysisId);
  const result = linked ? resultFor(table, linked) : null;
  const isXy = table.shape === 'xy';
  const available = PLOT_TYPES.filter((entry) => (isXy ? !entry.groupOnly : !entry.xyOnly));

  const exportSvg = () => {
    const node = svgRef.current?.querySelector('svg');
    if (!node) return;
    download(`${figure.name}.svg`, svgSource(node as SVGSVGElement), 'image/svg+xml');
    notify('SVG exported — text stays editable in Illustrator.');
  };

  const exportPng = async (dpi: number) => {
    const node = svgRef.current?.querySelector('svg');
    if (!node) return;
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

  return (
    <div className="view">
      <ViewHead
        eyebrow={`Figure · from ${table.name}`}
        title={figure.name}
        onRename={(name) => renameNode('figure', figure.id, name)}
      >
        <button onClick={() => select({ kind: 'table', id: table.id })}>Open data</button>
        <button onClick={exportSvg}>Export SVG</button>
        <button onClick={() => exportPng(300)}>PNG 300 dpi</button>
        <button onClick={() => exportPng(600)}>PNG 600 dpi</button>
      </ViewHead>

      <div className="figure-layout">
        <div className="canvas" ref={svgRef}>
          <Plot
            table={table}
            figure={figure}
            result={result}
            onPickRow={traceRow}
            highlightRow={traced}
          />
          {traced !== null && (
            <p className="trace">
              Highlighting row {traced + 1} of {table.name}.{' '}
              <button className="link" onClick={() => select({ kind: 'table', id: table.id })}>Open it</button>
              {' · '}
              <button className="link" onClick={() => setTraced(null)}>Clear</button>
            </p>
          )}
          {traced === null && <p className="trace muted">Click any point to trace it back to its row.</p>}
        </div>

        <aside className="properties">
          <h3>Figure</h3>

          <Field label="Plot type">
            <select value={figure.plotType} onChange={(event) => updateFigure(figure.id, { plotType: event.target.value as PlotType })}>
              {available.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Significance from">
            <select
              value={figure.analysisId ?? ''}
              onChange={(event) => updateFigure(figure.id, { analysisId: event.target.value || null })}
            >
              <option value="">None</option>
              {project.analyses
                .filter((analysis) => analysis.tableId === table.id)
                .map((analysis) => (
                  <option key={analysis.id} value={analysis.id}>{analysis.name}</option>
                ))}
            </select>
          </Field>

          <Field label="Title"><input value={figure.style.title} onChange={(e) => updateStyle(figure.id, { title: e.target.value })} placeholder={figure.name} /></Field>
          <Field label="Y axis label"><input value={figure.style.yLabel} onChange={(e) => updateStyle(figure.id, { yLabel: e.target.value })} /></Field>
          <Field label="X axis label"><input value={figure.style.xLabel} onChange={(e) => updateStyle(figure.id, { xLabel: e.target.value })} /></Field>

          <Field label="Error bars">
            <select value={figure.style.errorBars} onChange={(e) => updateStyle(figure.id, { errorBars: e.target.value as any })}>
              <option value="sd">Standard deviation</option>
              <option value="sem">Standard error (SEM)</option>
              <option value="ci95">95% confidence interval</option>
              <option value="none">None</option>
            </select>
          </Field>

          <Field label="Palette">
            <select value={figure.style.palette} onChange={(e) => updateStyle(figure.id, { palette: e.target.value })}>
              {Object.keys(PALETTES).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </Field>

          <div className="field-row">
            <Field label="Y min">
              <input
                type="number"
                value={figure.style.yMin ?? ''}
                placeholder="auto"
                onChange={(e) => updateStyle(figure.id, { yMin: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label="Y max">
              <input
                type="number"
                value={figure.style.yMax ?? ''}
                placeholder="auto"
                onChange={(e) => updateStyle(figure.id, { yMax: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="field-row">
            <Field label="Width"><input type="number" value={figure.style.width} onChange={(e) => updateStyle(figure.id, { width: Number(e.target.value) || 520 })} /></Field>
            <Field label="Height"><input type="number" value={figure.style.height} onChange={(e) => updateStyle(figure.id, { height: Number(e.target.value) || 360 })} /></Field>
          </div>

          <div className="field-row">
            <Field label="Point size"><input type="number" min={1} max={12} value={figure.style.pointSize} onChange={(e) => updateStyle(figure.id, { pointSize: Number(e.target.value) || 4 })} /></Field>
            <Field label="Font size"><input type="number" min={8} max={24} value={figure.style.fontSize} onChange={(e) => updateStyle(figure.id, { fontSize: Number(e.target.value) || 13 })} /></Field>
          </div>

          <label className="check">
            <input type="checkbox" checked={figure.style.showPoints} onChange={(e) => updateStyle(figure.id, { showPoints: e.target.checked })} />
            Show individual points
          </label>
          <label className="check">
            <input type="checkbox" checked={figure.style.showSignificance} onChange={(e) => updateStyle(figure.id, { showSignificance: e.target.checked })} />
            Show significance brackets
          </label>

          {figure.style.errorBars !== 'none' && (
            <p className="properties-note">
              Error bars show{' '}
              {figure.style.errorBars === 'sd' ? 'the standard deviation' : figure.style.errorBars === 'sem' ? 'the standard error of the mean' : 'the 95% confidence interval'}.
              State this in your caption.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

// ===========================================================================
// shared
// ===========================================================================

function ViewHead({
  eyebrow,
  title,
  onRename,
  children,
}: {
  eyebrow: string;
  title: string;
  onRename: (name: string) => void;
  children?: React.ReactNode;
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
