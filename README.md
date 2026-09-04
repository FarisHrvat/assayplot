<div align="center">

<img src="docs/assets/logo.svg" width="76" alt="">

# AssayPlot

**Free, open-source statistics and publication figures for the lab.**

[![Release](https://img.shields.io/badge/release-v0.7.0-0C6259)](https://github.com/FarisHrvat/assayplot/releases/latest)
[![Tests](https://img.shields.io/badge/tests-256%20passing-2e6b36)](docs/VALIDATION.md)
[![Checked against R](https://img.shields.io/badge/checked%20against%20R-63%20cases-0C6259)](docs/VALIDATION.md)
[![Licence](https://img.shields.io/badge/licence-AGPL--3.0-6B7A77)](LICENSE)
[![Platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-supported-6B7A77)](https://github.com/FarisHrvat/assayplot/releases/latest)

### [→ farishrvat.github.io/assayplot](https://farishrvat.github.io/assayplot/)

What it does, what it can analyse, how the numbers are checked, and where to
download it — all on one page.

</div>

---

43 analyses, 37 plot types, every procedure checked against R. Runs on your
machine: no account, no cloud, no telemetry, no subscription.

**[Download](https://github.com/FarisHrvat/assayplot/releases/latest)** ·
**[User guide](docs/GUIDE.md)** ·
**[How the statistics are validated](docs/VALIDATION.md)** ·
**[Roadmap](docs/ROADMAP.md)** ·
**[Releasing](docs/RELEASING.md)**

## Building it

Only needed to change the code.

```bash
npm install
npm run dev        # http://localhost:5173
npm run desktop:dev
npm test           # 256 tests, 63 of them checked against R
```

```text
src/core/    statistics, exact distributions, post-hoc, diagnostics,
             regression, multivariate, nonlinear, designs  (plain JS, no DOM)
src/app/     document model, store, figure engine, interface (TypeScript, React)
src-tauri/   desktop shell                                  (Rust, Tauri 2)
validation/  R scripts and the fixtures they produce
tests/       unit, document, import, render, property and R parity suites
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the two rules: a statistical change needs
a fixture proving it against R, and a bug fix needs a test that fails without it.

## Licence

Copyright (C) 2026 Faris Hrvat.

Released under the [GNU Affero General Public License v3.0 or later](LICENSE).
You may use, study, change and share it; if you run a modified copy as a network
service you must publish your changes. Bundled components are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

AssayPlot is not validated for clinical or regulatory use.
