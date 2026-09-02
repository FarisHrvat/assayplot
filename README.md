# AssayPlot

*An open-source alternative to GraphPad Prism, for people who work at a bench.*

An open-source, offline-first application for statistics and publication figures,
built for wet-lab researchers who currently pay for GraphPad Prism.

Your data never leaves your machine. There is no account, no cloud, and no
subscription.

## Status: v0.3.0, testable alpha

The application works end to end: import or type your data, run a defensible
analysis, build a figure, export it, save the project, and reopen it later.

**What works**

- **Projects** hold many data tables. Analyses and figures are bound to a table,
  and everything downstream of a cell recomputes the moment you change it.
- **Data grid** with Column and XY shapes, paste straight from Excel, add and
  delete rows and columns, and full undo/redo (`⌘Z` / `⇧⌘Z`).
- **Imports** `.csv`, `.tsv`, `.txt`, `.xlsx`, `.xls`, and `.ods`, several files
  at once. Close any table, analysis or figure from the × beside it.
- **19 analyses**, grouped by what you are asking:
  - *Describe* — descriptive statistics
  - *One sample* — one-sample t-test against a value you choose
  - *Two groups* — Welch, Student, paired t-test, Mann–Whitney, Wilcoxon
  - *Three or more* — one-way ANOVA, Kruskal–Wallis, Friedman (repeated measures)
  - *X versus Y* — Pearson, Spearman, linear regression, dose–response (EC50/IC50)
  - *Counts* — chi-square (with Yates), Fisher's exact
  - *Assumptions* — Shapiro–Wilk normality, Levene and Bartlett, Grubbs' outliers
- **Post-hoc done properly**: Tukey HSD with real family-wise confidence
  intervals, Dunn's test after Kruskal–Wallis, each-group-vs-control, or Holm
  and Benjamini–Hochberg on plain pairwise tests.
- **23 plot types**: bar, dot, box, violin, strip, beeswarm, mean±error,
  lollipop, before/after lines, histogram, density, ECDF, Q–Q, scatter, line,
  area, step, bubble, heatmap, correlation matrix, pie, and donut.
- **Edit the figure by clicking it.** Click the title or an axis label to type a
  new one in place. Click a bar, point, curve or wedge to select that series and
  set its colour. Gridlines, log axes, error-bar definition, point size, bar
  width, bins, and the legend are all switchable.
- **Methods text** generated for each analysis, ready to paste into a manuscript.
- **Click any point in a figure** to trace it back to the row it came from.
- **Project files** are ZIP archives of readable JSON. You can open one with any
  unzip tool and read your data without AssayPlot installed.

**Not built yet** — two-way and repeated-measures ANOVA, survival analysis,
confidence intervals on dose–response parameters, multi-panel layouts, and
subcolumn replicates. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### As a desktop app

```bash
npm run desktop:dev
```

To build a double-clickable macOS application (about 8 MB):

```bash
npm run desktop:build
```

The result lands in `src-tauri/target/release/bundle/macos/AssayPlot.app`. Use
`npm run desktop:build:installers` for platform installers. Builds are not yet
code-signed, so macOS will warn on first launch.

## Are the numbers right?

Every statistical procedure is checked against **R** on every test run.

`validation/generate/reference.R` produces golden fixtures from R at full double
precision; those fixtures are committed, and `tests/golden.test.js` validates the
engine against them without needing R installed. Closed-form statistics must
agree with R to a relative error of 1e-10.

```bash
npm test                                  # 113 tests, including 29 R parity cases
Rscript validation/generate/reference.R   # regenerate the fixtures (needs R)
```

Building this harness found seven real defects that no amount of self-consistent
testing would have caught: a Mann–Whitney tie correction wrong by 6%, a Wilcoxon
tie term divided by 24 instead of 48, missing exact tests for the small samples
lab work actually uses, tail p-values that underflowed to zero, a Friedman test
being handed its matrix transposed, and its tie correction summing group sizes
instead of `t³ − t`. Every one was found by comparing against R.

AssayPlot is **not validated for clinical or regulatory use**. For consequential
decisions, confirm results with a statistician.

## Principles

- Offline by default: lab data stays on the device.
- Reproducible: a project preserves data, analysis settings, and figures together.
- Guided, not presumptive: the app explains what each test assumes and why an
  option is unavailable. It never silently picks a test for you.
- Open formats: readable JSON inside an ordinary ZIP, plus CSV and SVG.
- Verifiable: the numbers are checked against an independent implementation.

## Layout

```text
src/core/      statistics, exact distributions, renderers   (no DOM, plain JS)
src/app/       document model, store, figure engine, UI     (TypeScript + React)
src-tauri/     desktop shell                                (Rust, Tauri 2)
validation/    R scripts and the golden fixtures they produce
tests/         unit, document-model, and R parity suites
```

## Licence

AGPL-3.0-or-later.

## The name

Checked before adoption: `assayplot` is free on npm, GitHub, PyPI, and
crates.io, `assayplot.org` is unregistered, and no software product uses it.
The earlier working title collided with a large market-data company's trademark.
