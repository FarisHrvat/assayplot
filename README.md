# AssayPlot

*An open-source alternative to GraphPad Prism, for people who work at a bench.*

Statistics and publication figures for the lab. Runs offline, on your machine.
No account, no cloud, no subscription. Your data never leaves the computer.

**[User guide](docs/GUIDE.md)** · **[How the statistics are validated](docs/VALIDATION.md)** · **[Roadmap](docs/ROADMAP.md)**

## Status: v0.3.0, testable alpha

The application works end to end: import your data, run a defensible analysis,
build a figure, assemble a panel, export it, save the project, reopen it later.

### What works

**Data**

- Four table shapes — Column, Grouped (two factors), XY, and Survival — so the
  layout matches how the experiment was actually recorded.
- Imports `.csv`, `.tsv`, `.txt`, `.xlsx`, `.xls`, `.ods`, several files at once.
- Paste a block straight from Excel. Spreadsheet keyboard navigation. Full
  undo/redo. Handles 100,000 rows without slowing down.

**19 analyses**, grouped by the question being asked

| Family | Methods |
|---|---|
| Describe | Descriptive statistics |
| One sample | One-sample *t*-test |
| Two groups | Welch, Student, paired *t*-test, Mann–Whitney, Wilcoxon signed-rank |
| Three or more | One-way ANOVA, Kruskal–Wallis, Friedman |
| Two factors | Two-way ANOVA with replication |
| X versus Y | Pearson, Spearman, linear regression, dose–response (EC50/IC50) |
| Survival | Kaplan–Meier with log-rank |
| Counts | Chi-square (with Yates), Fisher's exact |
| Assumptions | Shapiro–Wilk, Levene, Bartlett, Grubbs' outliers |

Post-hoc done properly: **Tukey HSD** with real family-wise confidence
intervals, **Dunn's test** after Kruskal–Wallis, each-group-versus-control, or
Holm and Benjamini–Hochberg on plain pairwise tests.

**Figures**

- 23 plot types: bar, dot, box, violin, strip, beeswarm, mean±error, lollipop,
  before/after lines, histogram, density, ECDF, Q–Q, scatter, line, area, step,
  bubble, heatmap, correlation matrix, pie, donut, Kaplan–Meier.
- **Edit the figure by clicking it.** Click the title or an axis label to type a
  new one in place; click a bar, point or curve to select that series and set
  its colour.
- Gridlines, log axes, error-bar definition, significance brackets that stack
  without colliding, and exact figure dimensions.
- Multi-panel layouts with A/B/C labelling.
- Export SVG (text stays editable) or PNG at 300/600 dpi.

**Reproducibility**

- A methods sentence for every analysis, ready to paste into a manuscript.
- Click any point in a figure to trace it back to its source row.
- Projects are a ZIP of readable JSON — unzip one and read your data without
  AssayPlot installed.
- Autosave with crash recovery; an error boundary that offers your project back
  rather than white-screening.

### Not built yet

Repeated-measures ANOVA, three-way ANOVA, mixed-effects models, Cox regression,
confidence intervals on dose–response parameters, and subcolumn replicates.
See [docs/ROADMAP.md](docs/ROADMAP.md).

## Try it

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and open one of the files in
[`examples/`](examples) from the toolbar.

### As a desktop app

```bash
npm run desktop:dev                # develop
npm run desktop:build              # a double-clickable app (~8 MB)
npm run desktop:build:installers   # platform installers
```

The macOS app lands in `src-tauri/target/release/bundle/macos/AssayPlot.app`.
Builds are **not code-signed**, so macOS and Windows will warn on first launch —
see [Installing an unsigned build](#installing-an-unsigned-build).

## Are the numbers right?

Every statistical procedure is checked against **R** on every test run.
`validation/generate/reference.R` produces golden fixtures at full double
precision; those fixtures are committed, so CI validates the engine without R
installed. A second CI job regenerates them with R and fails if they have
drifted.

```bash
npm test        # 164 tests, 36 of them R parity cases
npm run typecheck
npm run licenses
```

Building this harness found **ten real defects** that no amount of
self-consistent testing would have caught — including a Mann–Whitney tie
correction wrong by 6%, tail p-values that underflowed to zero, a Friedman test
handed its matrix transposed, and a dose–response model with Top and Bottom
inverted. [The full list is in docs/VALIDATION.md](docs/VALIDATION.md).

AssayPlot is **not validated for clinical or regulatory use**. For consequential
decisions, confirm results with a statistician.

## Installing an unsigned build

Until signing certificates are in place:

- **macOS** — right-click the app and choose *Open*, then *Open* again. Or
  `xattr -dr com.apple.quarantine /Applications/AssayPlot.app`.
- **Windows** — SmartScreen shows "Windows protected your PC". Choose *More
  info* → *Run anyway*.
- **Linux** — `chmod +x` the AppImage, or install the `.deb`.

Signing is tracked as a release blocker; see [docs/ROADMAP.md](docs/ROADMAP.md).

## How it is put together

```text
src/core/      statistics, exact distributions, post-hoc, diagnostics  (plain JS, no DOM)
src/app/       document model, store, figure engine, interface         (TypeScript + React)
src-tauri/     desktop shell                                           (Rust, Tauri 2)
validation/    R scripts and the golden fixtures they produce
tests/         unit, document-model, import, and R parity suites
examples/      worked projects, generated by npm run examples
scripts/       icon and example generators, licence check
```

Everything below the interface is free of DOM references, so the engine can be
tested in Node and reused by a future command-line or notebook interface.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: a statistical change needs a
fixture proving it against R, and a bug fix needs a test that fails without it.

## Licence

[AGPL-3.0-or-later](LICENSE). Third-party components and the published sources
of every statistical method are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

GraphPad and Prism are trademarks of GraphPad Software, LLC. AssayPlot is not
affiliated with or derived from GraphPad Software.

### The name

Checked before adoption: `assayplot` is free on npm, GitHub, PyPI and crates.io,
`assayplot.org` is unregistered, and no software product uses it.
