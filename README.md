# AssayPlot

Statistics and publication figures for the lab. An open alternative to GraphPad
Prism, for people who would rather not write code.

It runs on your machine. There is no account, no cloud, and no subscription, and
your data never leaves the computer.

[User guide](docs/GUIDE.md) · [How the statistics are validated](docs/VALIDATION.md) · [Roadmap](docs/ROADMAP.md) · [Publishing this project](docs/OPEN-SOURCE.md)

## Status

v0.4.0, a testable alpha. The whole workflow works: get your data in, run a
test, build a figure, assemble a panel, export it, save the project, open it
again next week.

## What it does

Four table shapes, so the layout matches how the experiment was recorded:
Column for comparing groups, Grouped for two factors, XY for anything against a
concentration or a time, and Survival for time-to-event. It reads `.csv`,
`.tsv`, `.txt`, `.xlsx`, `.xls` and `.ods`, several files at once, and you can
paste a block straight out of Excel. The grid navigates with the arrow keys and
handles 100,000 rows.

Forty-three analyses:

| | |
|---|---|
| Describe | Descriptive statistics |
| One sample | One-sample *t*-test |
| Two groups | Welch, Student, paired *t*-test, Mann–Whitney, Wilcoxon signed-rank |
| Three or more | One-way ANOVA, Kruskal–Wallis, Friedman |
| Two factors | Two-way ANOVA with replication |
| X versus Y | Pearson, Spearman, linear regression, dose–response (EC50/IC50) |
| Survival | Kaplan–Meier with log-rank |
| Counts | Chi-square with Yates, Fisher's exact, McNemar |
| Modelling | Logistic, Poisson, ANCOVA, mixed effects, GEE, Cox proportional hazards |
| Multivariate | Principal components, hierarchical clustering with bootstrap, ANOSIM, PLS-DA |
| Agreement | Cohen's kappa, Bland–Altman, TOST equivalence |
| Meta-analysis | Cochran's *Q* and *I*², Mantel–Haenszel |
| Genetics | Transmission disequilibrium, Mendelian randomisation |
| Study design | Simon's two-stage, resource equation |
| Assumptions | Shapiro–Wilk, D'Agostino–Pearson, Levene, Bartlett, Grubbs, ROUT |

Post-hoc comparisons are done properly: Tukey HSD with real family-wise
confidence intervals, Dunn's test after Kruskal–Wallis, each group against a
control, or Holm and Benjamini–Hochberg on plain pairwise tests.

Thirty-seven plot types — bar, dot, box, violin, strip, beeswarm, mean with
error, lollipop, before/after lines, histogram, density, ECDF, Q–Q, scatter,
line, area, step, bubble, heatmap, correlation matrix, pie, donut,
Kaplan–Meier, Bland–Altman, forest, fitted probability curve, ROC, parallel
lines by group, hazard ratios, PCA scores with loadings, scree, dendrogram with
bootstrap support, clustered heatmap, PLS-DA scores, ANOSIM rank
dissimilarities, Mendelian randomisation scatter, and flagged outliers. You edit a figure by clicking it: click the title or an axis
label and type over it, click a bar or a curve to select that series and change
its colour. Gridlines, log axes, error-bar definition, significance brackets and
exact dimensions are all under your control. Panels assemble into multi-panel
figures with A/B/C labelling. Export is SVG with live text, or PNG at 300 or
600 dpi.

Three things make the results defensible rather than merely produced. Every
analysis writes a methods sentence you can paste into a manuscript. Clicking a
point in a figure takes you to the row it came from. And the report export
carries a SHA-256 of every data table beside the analysis that used it, so a
reviewer can confirm the numbers analysed were the numbers supplied.

Projects are a ZIP of readable JSON — unzip one and read your data without
AssayPlot installed. Work is autosaved and offered back after a crash. Reports
export as HTML or Markdown, or go straight to a page in your own Notion
workspace using an integration you create.

Not built yet: three-way ANOVA, crossed random effects, confidence intervals on
dose–response parameters, and subcolumn replicates. Repeated measures are handled
by the mixed-effects model, which uses every value a subject gave rather than
dropping the subject when one is missing.

## Download

Grab the build for your machine from the
[releases page](https://github.com/FarisHrvat/assayplot/releases) and open it.
Nothing else to install.

| Your machine | File |
|---|---|
| Mac, Apple Silicon (M1 and later) | `AssayPlot_x.y.z_aarch64.dmg` |
| Mac, Intel | `AssayPlot_x.y.z_x64.dmg` |
| Windows | `AssayPlot_x.y.z_x64-setup.exe` |
| Linux, Debian or Ubuntu | `AssayPlot_x.y.z_amd64.deb` |
| Linux, anything else | `AssayPlot_x.y.z_amd64.AppImage` |

Open one of the projects in [`examples/`](examples) to see a finished analysis.

## Building it yourself

Only needed if you want to change the code.

```bash
npm install
npm run dev                        # http://localhost:5173
npm run desktop:dev                # the desktop app, with reload
npm run desktop:dmg                # macOS, app and disk image
npm run desktop:build:installers   # Windows and Linux
```

## Are the numbers right?

Every procedure is checked against R on every test run.
`validation/generate/reference.R` computes each one in R at full precision and
writes the results to JSON. Those fixtures are committed, so the suite runs
anywhere Node runs; a second CI job regenerates them with R and fails if
anything has drifted.

```bash
npm test          # 254 tests, 61 of them checked against R
npm run typecheck
npm run licenses
```

Building that harness found seventeen real defects, none of which a
self-consistent test suite would have caught. A Mann–Whitney tie correction
wrong by six per cent. Tail p-values that underflowed to zero. A Friedman test
handed its matrix transposed. A dose–response model with Top and Bottom the
wrong way round, which fitted the data perfectly and so looked right in every
number except the labels. [The full list is in
docs/VALIDATION.md](docs/VALIDATION.md).

AssayPlot is not validated for clinical or regulatory use. For anything
consequential, check the result with a statistician.

## Installing an unsigned build

There are no signing certificates yet, so your system will object the first
time.

- **macOS** — right-click the app, choose Open, then Open again. Or
  `xattr -dr com.apple.quarantine /Applications/AssayPlot.app`.
- **Windows** — SmartScreen says "Windows protected your PC". Choose More info,
  then Run anyway.
- **Linux** — `chmod +x` the AppImage, or install the `.deb`.

Signing is a release blocker and needs an Apple Developer account and a Windows
certificate. [docs/RELEASING.md](docs/RELEASING.md) has the steps.

## Layout

```text
src/core/      statistics, exact distributions, post-hoc, diagnostics,
               regression, multivariate, study designs               (plain JS, no DOM)
src/app/       document model, store, figure engine, interface        (TypeScript, React)
src-tauri/     desktop shell                                          (Rust, Tauri 2)
validation/    R scripts and the fixtures they produce
tests/         unit, document, import, render, property and R parity suites
examples/      worked projects, from npm run examples
scripts/       icon, examples, DMG, licence check
```

Nothing below the interface touches the DOM, which is why 254 tests run in
Node in a few seconds.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md). Two rules: a statistical change needs a
fixture proving it against R, and a bug fix needs a test that fails without it.

## Licence

[AGPL-3.0-or-later](LICENSE). Bundled components and the published source of
every statistical method are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

GraphPad and Prism are trademarks of GraphPad Software, LLC. AssayPlot is not
affiliated with them.
