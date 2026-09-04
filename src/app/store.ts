// Project state, undo/redo, and the live recompute link.
//
// Every mutation goes through `commit`, which pushes the previous project onto
// the undo stack. Analyses and figures are not stored with cached results:
// results are derived from (table, spec) on read and memoised by identity, so a
// cell edit invalidates exactly the nodes that depend on it and nothing else.

import { create } from 'zustand';
import { clearSnapshot, writeSnapshot } from './persist.ts';
import { getSettings } from './settings.ts';
import {
  type Analysis,
  type ColumnRole,
  type AnalysisResult,
  type Cell,
  type DataTable,
  type Figure,
  type Project,
  type Method,
  type PlotType,
  type FigureStyle,
  type Layout,
  type PanelLabelStyle,
  type TableShape,
  demoProject,
  makeAnalysis,
  makeColumn,
  makeFigure,
  makeLayout,
  availableMethods,
  makeTable,
  newId,
  runAnalysis,
} from './model.ts';

/** The first method the shape supports, for when a re-pointed analysis loses its own. */
function firstUsableMethod(table: DataTable): Method {
  const usable = availableMethods(table).find((entry) => entry.usable);
  return (usable?.info.id ?? 'descriptive') as Method;
}

export type Selection =
  | { kind: 'table'; id: string }
  | { kind: 'analysis'; id: string }
  | { kind: 'figure'; id: string }
  | { kind: 'layout'; id: string }
  | { kind: 'help'; id: string };

/**
 * Something that did not work, stated in full: what happened, what was and was
 * not done as a result, and what to try. Shown on screen until dismissed,
 * because a message that fades after three seconds is a message nobody read.
 */
export interface Problem {
  title: string;
  detail: string;
  done?: string;
  notDone?: string;
  fix?: string[];
}

/** A question, with the consequence written on each button rather than "OK". */
export interface Question {
  id: string;
  title: string;
  detail?: string;
  /** Consequences, listed so nothing is a surprise. */
  points?: string[];
  choices: { id: string; label: string; tone?: 'primary' | 'danger' }[];
  onAnswer: (choice: string | null) => void;
}

interface State {
  project: Project;
  selection: Selection;
  past: Project[];
  future: Project[];
  dirty: boolean;
  /** Figure ids on the internal clipboard, for pasting into a layout. */
  clipboard: string[];
  /** Transient confirmation, for things that worked. */
  toast: string | null;
  /** Something that did not work. Stays until dismissed. */
  problem: Problem | null;
  /** A question waiting on an answer. The webview blocks window.confirm. */
  question: Question | null;
  /** Shown over everything while something slow runs, with what it is doing. */
  working: string | null;

  commit: (next: Project, label?: string) => void;
  replaceProject: (next: Project) => void;
  undo: () => void;
  redo: () => void;
  select: (selection: Selection) => void;
  notify: (message: string | null) => void;
  reportProblem: (problem: Problem) => void;
  dismissProblem: () => void;
  ask: (question: Omit<Question, 'id'>) => void;
  answer: (choice: string | null) => void;
  setWorking: (label: string | null) => void;

  setProjectName: (name: string) => void;

  addTable: (shape: TableShape) => void;
  renameNode: (kind: Selection['kind'], id: string, name: string) => void;
  deleteNode: (kind: Selection['kind'], id: string) => void;

  setCell: (tableId: string, row: number, column: number, value: Cell) => void;
  setCells: (tableId: string, row: number, column: number, block: Cell[][]) => void;
  addRow: (tableId: string) => void;
  addColumn: (tableId: string) => void;
  deleteRow: (tableId: string, row: number) => void;
  deleteColumn: (tableId: string, column: number) => void;
  renameColumn: (tableId: string, columnId: string, name: string) => void;
  setTableShape: (tableId: string, shape: TableShape) => void;

  addAnalysis: (tableId: string) => void;
  updateAnalysis: (id: string, patch: Partial<Analysis>) => void;
  setMethod: (id: string, method: Method) => void;

  addFigure: (tableId: string) => void;
  updateFigure: (id: string, patch: Partial<Figure>) => void;
  updateStyle: (id: string, patch: Partial<FigureStyle>) => void;
  setPlotType: (id: string, plotType: PlotType) => void;

  addLayout: () => void;
  updateLayout: (id: string, patch: Partial<Layout>) => void;
  addPanel: (layoutId: string, figureId: string) => void;
  copyFigures: (figureIds: string[]) => void;
  pasteIntoLayout: (layoutId: string) => number;
  removePanel: (layoutId: string, index: number) => void;
  movePanel: (layoutId: string, index: number, by: number) => void;
}

const UNDO_LIMIT = 100;

function replaceById<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

// Built once: calling demoProject() twice would mint two different sets of ids
// and leave the initial selection pointing at a table that is not in the store.
const initialProject = demoProject();

export const useStore = create<State>((set, get) => ({
  project: initialProject,
  selection: { kind: 'table', id: initialProject.tables[0].id },
  past: [],
  future: [],
  dirty: false,
  clipboard: [],
  toast: null,
  problem: null,
  question: null,
  working: null,

  commit: (next) =>
    set((state) => ({
      project: next,
      past: [...state.past, state.project].slice(-UNDO_LIMIT),
      future: [],
      dirty: true,
    })),

  replaceProject: (next) =>
    set(() => ({
      project: next,
      past: [],
      future: [],
      dirty: false,
      selection: next.tables.length
        ? { kind: 'table', id: next.tables[0].id }
        : { kind: 'table', id: '' },
    })),

  undo: () =>
    set((state) => {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, UNDO_LIMIT),
        dirty: true,
      };
    }),

  redo: () =>
    set((state) => {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return {
        project: next,
        past: [...state.past, state.project].slice(-UNDO_LIMIT),
        future: rest,
        dirty: true,
      };
    }),

  select: (selection) => set({ selection }),
  notify: (toast) => set({ toast }),
  reportProblem: (problem) => set({ problem, toast: null }),
  dismissProblem: () => set({ problem: null }),

  ask: (question) => set({ question: { ...question, id: newId('ask') }, toast: null }),
  answer: (choice) => {
    const pending = get().question;
    set({ question: null });
    if (pending) pending.onAnswer(choice);
  },

  setWorking: (working) => set({ working }),

  setProjectName: (name) => get().commit({ ...get().project, name }),

  addTable: (shape) => {
    const project = get().project;
    const table = makeTable(`Data ${project.tables.length + 1}`, shape);
    get().commit({ ...project, tables: [...project.tables, table] });
    set({ selection: { kind: 'table', id: table.id } });
  },

  renameNode: (kind, id, name) => {
    const project = get().project;
    if (kind === 'table') get().commit({ ...project, tables: replaceById(project.tables, id, { name }) });
    if (kind === 'analysis') get().commit({ ...project, analyses: replaceById(project.analyses, id, { name }) });
    if (kind === 'figure') get().commit({ ...project, figures: replaceById(project.figures, id, { name }) });
  },

  deleteNode: (kind, id) => {
    const project = get().project;
    let next: Project;
    if (kind === 'table') {
      // Deleting a table takes its dependent analyses and figures with it.
      const analyses = project.analyses.filter((a) => a.tableId !== id);
      const analysisIds = new Set(analyses.map((a) => a.id));
      const figures = project.figures
        .filter((f) => f.tableId !== id)
        .map((f) => (f.analysisId && !analysisIds.has(f.analysisId) ? { ...f, analysisId: null } : f));
      const figureIds = new Set(figures.map((f) => f.id));
      next = {
        ...project,
        tables: project.tables.filter((t) => t.id !== id),
        analyses,
        figures,
        layouts: project.layouts.map((layout) => ({
          ...layout,
          panels: layout.panels.filter((panel) => figureIds.has(panel)),
        })),
      };
    } else if (kind === 'analysis') {
      next = {
        ...project,
        analyses: project.analyses.filter((a) => a.id !== id),
        figures: project.figures.map((f) => (f.analysisId === id ? { ...f, analysisId: null } : f)),
      };
    } else if (kind === 'figure') {
      next = {
        ...project,
        figures: project.figures.filter((f) => f.id !== id),
        layouts: project.layouts.map((layout) => ({
          ...layout,
          panels: layout.panels.filter((panel) => panel !== id),
        })),
      };
    } else {
      next = { ...project, layouts: project.layouts.filter((l) => l.id !== id) };
    }
    get().commit(next);
    const first = next.tables[0];
    if (first) set({ selection: { kind: 'table', id: first.id } });
  },

  setCell: (tableId, row, column, value) => {
    const project = get().project;
    get().commit({
      ...project,
      tables: project.tables.map((table) => {
        if (table.id !== tableId) return table;
        const rows = table.rows.map((existing, index) => {
          if (index !== row) return existing;
          const copy = [...existing];
          copy[column] = value;
          return copy;
        });
        return { ...table, rows };
      }),
    });
  },

  /** Writes a rectangular block, growing the table as needed. Used by paste. */
  setCells: (tableId, row, column, block) => {
    const project = get().project;
    get().commit({
      ...project,
      tables: project.tables.map((table) => {
        if (table.id !== tableId) return table;
        const neededColumns = column + Math.max(...block.map((line) => line.length));
        const columns = [...table.columns];
        while (columns.length < neededColumns) {
          const isXy = table.shape === 'xy';
          columns.push(
            makeColumn(
              isXy ? `Y${columns.length}` : `Group ${String.fromCharCode(65 + columns.length)}`,
              isXy ? 'y' : 'group'
            )
          );
        }
        const rows = table.rows.map((existing) => {
          const copy = [...existing];
          while (copy.length < columns.length) copy.push(null);
          return copy;
        });
        while (rows.length < row + block.length) rows.push(columns.map(() => null));

        block.forEach((line, lineIndex) => {
          line.forEach((value, valueIndex) => {
            rows[row + lineIndex][column + valueIndex] = value;
          });
        });
        return { ...table, columns, rows };
      }),
    });
  },

  addRow: (tableId) => {
    const project = get().project;
    get().commit({
      ...project,
      tables: project.tables.map((table) =>
        table.id === tableId ? { ...table, rows: [...table.rows, table.columns.map(() => null)] } : table
      ),
    });
  },

  addColumn: (tableId) => {
    const project = get().project;
    get().commit({
      ...project,
      tables: project.tables.map((table) => {
        if (table.id !== tableId) return table;
        const role: ColumnRole = table.shape === 'xy' ? 'y' : 'group';
        const name = table.shape === 'xy'
          ? `Y${table.columns.filter((c) => c.role === 'y').length + 1}`
          : table.shape === 'grouped' ? `Column ${table.columns.length}`
          : `Group ${String.fromCharCode(65 + table.columns.length)}`;
        return {
          ...table,
          columns: [...table.columns, makeColumn(name, role)],
          rows: table.rows.map((row) => [...row, null]),
        };
      }),
    });
  },

  deleteRow: (tableId, row) => {
    const project = get().project;
    get().commit({
      ...project,
      tables: project.tables.map((table) =>
        table.id === tableId && table.rows.length > 1
          ? { ...table, rows: table.rows.filter((_, index) => index !== row) }
          : table
      ),
    });
  },

  deleteColumn: (tableId, column) => {
    const project = get().project;
    get().commit({
      ...project,
      tables: project.tables.map((table) => {
        if (table.id !== tableId || table.columns.length <= 1) return table;
        return {
          ...table,
          columns: table.columns.filter((_, index) => index !== column),
          rows: table.rows.map((row) => row.filter((_, index) => index !== column)),
        };
      }),
    });
  },

  renameColumn: (tableId, columnId, name) => {
    const project = get().project;
    get().commit({
      ...project,
      tables: project.tables.map((table) =>
        table.id === tableId
          ? { ...table, columns: replaceById(table.columns, columnId, { name }) }
          : table
      ),
    });
  },

  setTableShape: (tableId, shape) => {
    const project = get().project;
    get().commit({
      ...project,
      tables: project.tables.map((table) => {
        if (table.id !== tableId) return table;
        // Default column names track the shape, so an XY table does not keep
        // calling its X column "Group A". Names the user chose are left alone.
        const isDefaultName = (name: string) =>
          /^(Group [A-Z]|Group|X|Y\d*|Time|Event|Control|Treated|Column \d+)$/.test(name);

        const roleFor = (index: number): ColumnRole => {
          if (shape === 'xy') return index === 0 ? 'x' : 'y';
          if (shape === 'grouped') return index === 0 ? 'label' : 'group';
          if (shape === 'survival') return index === 0 ? 'time' : index === 1 ? 'event' : 'group';
          return 'group';
        };
        const defaultNameFor = (index: number): string => {
          if (shape === 'xy') return index === 0 ? 'X' : `Y${index}`;
          if (shape === 'grouped') return index === 0 ? 'Group' : `Column ${index}`;
          if (shape === 'survival') return index === 0 ? 'Time' : index === 1 ? 'Event' : 'Group';
          return `Group ${String.fromCharCode(65 + index)}`;
        };

        const columns = table.columns.map((column, index) => {
          const role = roleFor(index);
          if (!isDefaultName(column.name)) return { ...column, role };
          return { ...column, role, name: defaultNameFor(index) };
        });
        return { ...table, shape, columns };
      }),
    });
  },

  addAnalysis: (tableId) => {
    const project = get().project;
    const table = project.tables.find((t) => t.id === tableId) ?? project.tables[0];
    if (!table) return;
    const analysis = makeAnalysis(`Analysis ${project.analyses.length + 1}`, table.id,
      table.shape === 'xy' ? 'regression' : 'descriptive');
    get().commit({ ...project, analyses: [...project.analyses, analysis] });
    set({ selection: { kind: 'analysis', id: analysis.id } });
  },

  updateAnalysis: (id, patch) => {
    const project = get().project;
    const current = project.analyses.find((analysis) => analysis.id === id);

    // Column ids belong to the old table, and the method may not fit the new
    // shape. Drop both rather than leave them dangling.
    let effective = patch;
    if (current && patch.tableId && patch.tableId !== current.tableId) {
      const next = project.tables.find((table) => table.id === patch.tableId);
      const usable = next
        ? availableMethods(next).find((entry) => entry.info.id === current.method)?.usable
        : false;
      const { columnIds, outcomeColumn, covariateColumn, groupColumn, controlIndex, ...kept } = current.options;
      effective = {
        ...patch,
        options: kept,
        ...(usable ? {} : { method: next ? firstUsableMethod(next) : current.method }),
      };
    }

    get().commit({ ...project, analyses: replaceById(project.analyses, id, effective) });
  },

  setMethod: (id, method) => {
    const project = get().project;
    get().commit({ ...project, analyses: replaceById(project.analyses, id, { method }) });
  },

  addFigure: (tableId) => {
    const project = get().project;
    const table = project.tables.find((t) => t.id === tableId) ?? project.tables[0];
    if (!table) return;
    const figure = makeFigure(`Figure ${project.figures.length + 1}`, table.id,
      table.shape === 'xy' ? 'scatter' : 'bar');
    get().commit({ ...project, figures: [...project.figures, figure] });
    set({ selection: { kind: 'figure', id: figure.id } });
  },

  updateFigure: (id, patch) => {
    const project = get().project;
    get().commit({ ...project, figures: replaceById(project.figures, id, patch) });
  },

  updateStyle: (id, patch) => {
    const project = get().project;
    get().commit({
      ...project,
      figures: project.figures.map((figure) =>
        figure.id === id ? { ...figure, style: { ...figure.style, ...patch } } : figure
      ),
    });
  },

  setPlotType: (id, plotType) => {
    const project = get().project;
    get().commit({ ...project, figures: replaceById(project.figures, id, { plotType }) });
  },

  addLayout: () => {
    const project = get().project;
    // Seed a new layout with the figures that exist, which is almost always
    // what someone assembling a figure panel wants.
    const layout = makeLayout(`Figure ${project.layouts.length + 1}`,
      project.figures.slice(0, 4).map((figure) => figure.id));
    get().commit({ ...project, layouts: [...project.layouts, layout] });
    set({ selection: { kind: 'layout', id: layout.id } });
  },

  updateLayout: (id, patch) => {
    const project = get().project;
    get().commit({ ...project, layouts: replaceById(project.layouts, id, patch) });
  },

  copyFigures: (figureIds) => set({ clipboard: figureIds }),

  /** Appends whatever was copied; returns how many panels were added. */
  pasteIntoLayout: (layoutId) => {
    const { project, clipboard } = get();
    const existing = new Set(project.figures.map((figure) => figure.id));
    const usable = clipboard.filter((id) => existing.has(id));
    if (!usable.length) return 0;
    get().commit({
      ...project,
      layouts: project.layouts.map((layout) =>
        layout.id === layoutId ? { ...layout, panels: [...layout.panels, ...usable] } : layout
      ),
    });
    return usable.length;
  },

  addPanel: (layoutId, figureId) => {
    const project = get().project;
    get().commit({
      ...project,
      layouts: project.layouts.map((layout) =>
        layout.id === layoutId ? { ...layout, panels: [...layout.panels, figureId] } : layout
      ),
    });
  },

  removePanel: (layoutId, index) => {
    const project = get().project;
    get().commit({
      ...project,
      layouts: project.layouts.map((layout) =>
        layout.id === layoutId
          ? { ...layout, panels: layout.panels.filter((_, position) => position !== index) }
          : layout
      ),
    });
  },

  movePanel: (layoutId, index, by) => {
    const project = get().project;
    get().commit({
      ...project,
      layouts: project.layouts.map((layout) => {
        if (layout.id !== layoutId) return layout;
        const target = index + by;
        if (target < 0 || target >= layout.panels.length) return layout;
        const panels = [...layout.panels];
        [panels[index], panels[target]] = [panels[target], panels[index]];
        return { ...layout, panels };
      }),
    });
  },
}));

/**
 * Memoised analysis results. The cache key is the identity of the table and the
 * analysis spec, both of which are replaced on every edit, so a change to one
 * table invalidates only the analyses bound to it.
 */
const resultCache = new WeakMap<DataTable, WeakMap<Analysis, AnalysisResult>>();

export function resultFor(table: DataTable, analysis: Analysis): AnalysisResult {
  let byAnalysis = resultCache.get(table);
  if (!byAnalysis) {
    byAnalysis = new WeakMap();
    resultCache.set(table, byAnalysis);
  }
  const cached = byAnalysis.get(analysis);
  if (cached) return cached;
  const computed = runAnalysis(table, analysis);
  byAnalysis.set(analysis, computed);
  return computed;
}

export function tableById(project: Project, id: string): DataTable | undefined {
  return project.tables.find((table) => table.id === id);
}

export function analysisById(project: Project, id: string | null): Analysis | undefined {
  return id ? project.analyses.find((analysis) => analysis.id === id) : undefined;
}

/**
 * Writes a recovery snapshot shortly after the project stops changing. Purely a
 * safety net against a crash or a closed tab; the user's real save is still an
 * explicit file, and saving clears the snapshot.
 */
let lastWrite = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * Throttled, not debounced. A debounce at fifteen minutes writes nothing until
 * fifteen minutes after the last keystroke, which is not what the setting says.
 * Closing the window flushes regardless.
 */
function persist(project: Project, dirty: boolean) {
  const interval = Math.max(800, getSettings().autosaveMinutes * 60_000);
  const since = Date.now() - lastWrite;

  const write = () => {
    lastWrite = Date.now();
    pending = null;
    void writeSnapshot(project, dirty);
  };

  if (since >= interval) { write(); return; }
  if (pending) return;
  pending = setTimeout(write, interval - since);
}

let autosaveStarted = false;

export function startAutosave(): () => void {
  if (autosaveStarted || typeof window === 'undefined') return () => {};
  autosaveStarted = true;

  let previous = useStore.getState().project;
  const unsubscribe = useStore.subscribe((state) => {
    if (state.project === previous) return;
    previous = state.project;
    if (state.dirty) persist(state.project, true);
    else void clearSnapshot();
  });

  // A closing window does not wait for the interval.
  const flush = () => {
    const state = useStore.getState();
    if (state.dirty) void writeSnapshot(state.project, true);
  };
  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);

  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', flush);
    window.removeEventListener('pagehide', flush);
    autosaveStarted = false;
  };
}

/** Called after an explicit save: there is nothing left to recover. */
export function markSaved(): void {
  useStore.setState({ dirty: false });
  void clearSnapshot();
}
