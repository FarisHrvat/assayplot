# Statista

An open-source, offline-first application for statistics and publication figures,
built for wet-lab researchers who currently pay for GraphPad Prism.

Your data never leaves your machine. There is no account, no cloud, and no
subscription.

## Status: v0.2.0, testable alpha

The application works end to end: import or type your data, run a defensible
analysis, build a figure, export it, save the project, and reopen it later.

**What works**

- **Projects** hold many data tables. Analyses and figures are bound to a table,
  and everything downstream of a cell recomputes the moment you change it.
- **Data grid** with Column and XY shapes, paste straight from Excel, add and
  delete rows and columns, and full undo/redo (`⌘Z` / `⇧⌘Z`).
- **Analyses**: descriptive statistics, Welch and Student t-tests, paired t-test,
  Mann–Whitney, Wilcoxon signed-rank, one-way ANOVA, Kruskal–Wallis, Pearson and
  Spearman correlation, and linear regression. Post-hoc pairwise comparisons with
  Holm or Benjamini–Hochberg correction.
- **Figures**: bar with points, dot, box, violin, scatter, and line. Error bars
  (SD, SEM, 95% CI), significance brackets that stack without colliding, custom
  axes and palettes, and export to SVG or PNG at 300/600 dpi.
- **Methods text** generated for each analysis, ready to paste into a manuscript.
- **Click any point in a figure** to trace it back to the row it came from.
- **Project files** are ZIP archives of readable JSON. You can open one with any
  unzip tool and read your data without Statista installed.

**Not built yet** — nonlinear regression and dose–response curves, two-way and
repeated-measures ANOVA, survival analysis, normality and outlier tests,
multi-panel layouts, and subcolumn replicates. See
[docs/ROADMAP.md](docs/ROADMAP.md).

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

The result lands in `src-tauri/target/release/bundle/macos/Statista.app`. Use
`npm run desktop:build:installers` for platform installers. Builds are not yet
code-signed, so macOS will warn on first launch.

## Are the numbers right?

Every statistical procedure is checked against **R** on every test run.

`validation/generate/reference.R` produces golden fixtures from R at full double
precision; those fixtures are committed, and `tests/golden.test.js` validates the
engine against them without needing R installed. Closed-form statistics must
agree with R to a relative error of 1e-10.

```bash
npm test                                  # 95 tests, including 22 R parity cases
Rscript validation/generate/reference.R   # regenerate the fixtures (needs R)
```

Building this harness immediately found five real defects, including a
Mann–Whitney tie correction that was wrong by 6% and missing exact tests for the
small sample sizes that lab work actually uses. See the M0 commit for details.

Statista is **not validated for clinical or regulatory use**. For consequential
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

The name "Statista" is a working title only. It collides with an existing
trademark and must be changed before any public release.
