# AssayPlot: end-to-end build plan

## 1. Product definition

AssayPlot should help a wet-lab or life-science researcher complete the common workflow without writing code:

1. Start a project or import CSV/XLSX.
2. Choose a data shape that matches the experiment.
3. Clean, label, transform, and optionally exclude observations with an audit trail.
4. Pick an analysis using plain-language guidance.
5. Review assumptions, run the analysis, and inspect effect sizes, uncertainty, and multiplicity corrections.
6. Build an editable graph from raw points and analysis results.
7. Assemble figure panels, annotate, export, and save a reproducible project.

The product is not a clone of GraphPad’s UI or file format. It should reproduce the useful workflow with an open project format and transparent methods.

## 2. Scope

### MVP (first public alpha)

- Offline desktop/web app shell.
- Project file containing data, analysis specifications, graph specifications, and app version.
- CSV import with type detection, missing-value handling, column renaming, filtering, and undo/redo.
- Data table modes: column, grouped, XY, and multiple-variable/long format.
- Descriptive statistics and visualization of raw observations.
- Welch/Student independent t-test, paired t-test, one-way ANOVA, and Mann–Whitney/Wilcoxon.
- Multiple-comparison corrections: Holm and Benjamini–Hochberg.
- Graphs: scatter, dot/strip, bar with points, box, violin, histogram, XY line, and dose-response preview.
- Figure styling: colors, symbols, axes, labels, error bars, significance brackets, and themes.
- Export to SVG/PNG/PDF and CSV/JSON.
- Plain-language assumption checklist and a “methods” summary suitable for copying into a manuscript.

### Phase 2

- Two-way/repeated-measures ANOVA and mixed-effects models.
- Linear and nonlinear regression with a model library, confidence/prediction bands, residual diagnostics, and parameter tables.
- Kaplan–Meier/Cox survival analysis, contingency tests, ROC, correlation, PCA, and Bland–Altman.
- Power/sample-size analysis.
- Figure canvas with multi-panel layouts, alignment, guides, and reusable templates.
- R/Python syntax export and a deterministic analysis manifest for CI.

### Phase 3

- Plugin API for analyses and graph layers.
- Optional collaboration/sync service, with local-only mode remaining complete.
- Import adapters for Excel, Prism exports, and common instrument formats.
- Accessibility, internationalization, institutional deployment, and signed installers.

### Explicit non-goals

- Do not promise clinical/regulatory validation in the initial release.
- Do not silently recommend a test based only on the number of groups.
- Do not implement every advanced method before the data model and validation framework are stable.
- Do not make cloud accounts required for analysis.

## 3. Recommended architecture

Use a TypeScript frontend and a versioned, pure analysis core. Start as a static web app for fast iteration; package the same frontend as a Tauri desktop app once the workflow is stable. Tauri is a good fit for smaller cross-platform binaries and native file dialogs, while the pure core also permits browser use and automated testing.

```text
UI (data grid, analysis wizard, graph editor, project navigator)
        |
Project store (commands, undo/redo, autosave, migrations)
        |
Domain model (tables -> analyses -> results -> graph layers)
        |
Analysis engine (pure functions; typed inputs/outputs; no UI)
        |
Numerical adapters (validated distributions, optimization, linear algebra)
        |
Export/import + renderer (CSV, JSON, SVG, PNG, PDF)
```

The long-term statistical engine should either use a carefully audited TypeScript/WASM numerical layer or call an embedded R runtime for methods where parity and peer review matter more than binary size. Whichever method is used, every procedure needs reference tests against trusted implementations and published examples.

## 4. Data and project model

Every project should be a ZIP container with a readable manifest:

```text
assayplot-project/
  manifest.json       # schema version, app version, provenance
  data/*.json          # immutable imported source plus derived tables
  analyses/*.json      # method, options, exclusions, random seed
  figures/*.json       # visual grammar and styling
  exports/             # optional generated artifacts
```

Core entities:

- `DataTable`: columns, roles, units, levels, missing-value rules, source hash.
- `Transform`: explicit operation with inputs and output; never overwrite raw data.
- `AnalysisSpec`: procedure, variables, paired/repeated structure, exclusions, correction, and options.
- `AnalysisResult`: numeric estimates, intervals, test statistics, degrees of freedom, p-values, warnings, and software metadata.
- `FigureSpec`: layers mapped to data/result fields, scales, annotations, dimensions, colors, and export settings.

## 5. Statistical quality and safety

Each method ships with:

- An assumptions checklist.
- A data-shape validator with actionable errors.
- Unit tests for edge cases: missingness, ties, zero variance, tiny samples, unequal sizes, and extreme values.
- Golden tests against R or another independently trusted reference.
- A human-readable method description and citation.
- Explicit distinction between exploratory and confirmatory analyses.

Results must show effect size and confidence interval alongside p-values. Warnings should explain what failed and what the user can do, not merely display an error code.

## 6. UX workstreams

1. Research: interview 5–10 lab users; collect anonymized example workflows and current pain points.
2. Information architecture: project navigator, data, analyses, results, figures, exports.
3. Guided analysis: data-shape-first wizard with preview and assumptions.
4. Graph editing: direct manipulation plus a precise properties panel.
5. Reproducibility: visible lineage from each plotted mark/result back to source data.
6. Accessibility: keyboard navigation, contrast, focus states, readable error messages, screen-reader labels.

## 7. Delivery milestones

- M0: repository, license decision, UX research, schema, CI, and demo dataset.
- M1: current vertical slice—CSV, editable table, grouped plot, descriptive statistics, Welch t-test, JSON/SVG export.
- M2: project persistence, undo/redo, data transformations, column/group/XY modes, robust import errors.
- M3: analysis wizard, assumptions, ANOVA/nonparametric tests, multiple comparisons, golden statistical tests.
- M4: graph editor, figure canvas, publication export, methods text, accessibility pass.
- M5: desktop packaging, signed installers, crash-safe autosave, documentation, beta with real labs.

## 8. Open-source and legal checklist

- Use an OSI-approved application license; AGPL-3.0-or-later is appropriate if improvements to hosted versions should remain available.
- Keep a third-party notices/SBOM file and verify every dependency license.
- Never copy Prism UI text, artwork, proprietary algorithms, or file-format internals.
- Use independent implementations and cite statistical references.
- Add a “not medical advice / verify with a statistician” notice for early releases.
- Publish reproducible example projects and benchmark reports.

## 9. Definition of done for beta

A new user can import a small experiment, understand the data shape, run a defensible analysis, see raw observations and uncertainty, edit a figure, reopen the project later, and export a vector figure plus a methods summary—without an internet connection or account. A statistician can inspect the exact inputs and settings and reproduce the result.
