# Third-party notices

AssayPlot is licensed under AGPL-3.0-or-later (see [LICENSE](LICENSE)). It ships
the following third-party components. Every licence below is compatible with
AGPL-3.0 distribution.

Regenerate this inventory with `npm run licenses`.

## Bundled into the application

| Component | Licence | Used for |
|---|---|---|
| [React](https://react.dev) | MIT | User interface |
| [React DOM](https://react.dev) | MIT | Rendering |
| [Zustand](https://github.com/pmndrs/zustand) | MIT | Document store |
| [Immer](https://immerjs.github.io/immer/) | MIT | Immutable updates |
| [fflate](https://github.com/101arrowz/fflate) | MIT | Reading and writing the `.assayplot` ZIP container |
| [SheetJS (xlsx)](https://sheetjs.com) | Apache-2.0 | Reading `.xlsx`, `.xls`, and `.ods` workbooks |
| [@tauri-apps/api](https://tauri.app) | MIT / Apache-2.0 | Desktop runtime bridge |
| [@tauri-apps/plugin-http](https://tauri.app) | MIT / Apache-2.0 | Outbound requests to the Notion API, which a webview cannot make directly |

## Desktop shell

| Component | Licence | Used for |
|---|---|---|
| [Tauri](https://tauri.app) | MIT / Apache-2.0 | Desktop packaging, window, filesystem |
| tauri-plugin-http | MIT / Apache-2.0 | The Rust half of the same |
| Rust standard library and crates | MIT / Apache-2.0 | See `src-tauri/Cargo.lock` |

## Build and test only (not distributed)

| Component | Licence |
|---|---|
| [Vite](https://vite.dev) | MIT |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | MIT |
| [@tauri-apps/cli](https://tauri.app) | MIT / Apache-2.0 |

## Statistical methods

The numerical routines in `src/core/` are independent implementations. They were
written from the published descriptions cited below and validated against R; no
code was copied from R, from GraphPad Prism, or from any other statistics
package.

- Royston, P. (1995). A remark on Algorithm AS 181: the W test for normality.
  *Applied Statistics* 44(4), 547–551. — Shapiro–Wilk.
- Wichura, M. J. (1988). Algorithm AS 241: the percentage points of the normal
  distribution. *Applied Statistics* 37(3), 477–484. — normal quantiles.
- Tukey, J. W. (1949). Comparing individual means in the analysis of variance.
  *Biometrics* 5(2), 99–114. — honestly significant difference.
- Dunn, O. J. (1964). Multiple comparisons using rank sums. *Technometrics*
  6(3), 241–252.
- Holm, S. (1979). A simple sequentially rejective multiple test procedure.
  *Scandinavian Journal of Statistics* 6(2), 65–70.
- Benjamini, Y. & Hochberg, Y. (1995). Controlling the false discovery rate.
  *JRSS B* 57(1), 289–300.
- Welch, B. L. (1947). The generalization of Student's problem when several
  different population variances are involved. *Biometrika* 34(1–2), 28–35.
- Brown, M. B. & Forsythe, A. B. (1974). Robust tests for the equality of
  variances. *JASA* 69(346), 364–367. — Levene, median-centred.
- Grubbs, F. E. (1969). Procedures for detecting outlying observations in
  samples. *Technometrics* 11(1), 1–21.
- Kaplan, E. L. & Meier, P. (1958). Nonparametric estimation from incomplete
  observations. *JASA* 53(282), 457–481.
- D'Agostino, R. B. & Pearson, E. S. (1973). Tests for departure from normality.
  *Biometrika* 60(3), 613–622.
- Press, W. H. et al. (2007). *Numerical Recipes*, 3rd edn. — continued-fraction
  evaluation of the incomplete beta and gamma functions.

R is used only as an offline reference oracle when generating the fixtures in
`validation/fixtures/`. It is not required to build, run, or test AssayPlot, and
no part of R is distributed with it.

## Trademarks

GraphPad and Prism are trademarks of GraphPad Software, LLC. AssayPlot is not
affiliated with, endorsed by, or derived from GraphPad Software. References to
Prism in this repository describe an alternative product for comparison only.
