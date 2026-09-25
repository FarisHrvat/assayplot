<div align="center">

<img src="docs/assets/logo.svg" width="76" alt="">

# AssayPlot

**Free, open-source statistics and publication figures for the lab.**

[![Release](https://img.shields.io/github/v/release/FarisHrvat/assayplot?include_prereleases&sort=semver&label=release&color=0C6259)](https://github.com/FarisHrvat/assayplot/releases/latest)
[![CI](https://github.com/FarisHrvat/assayplot/actions/workflows/ci.yml/badge.svg)](https://github.com/FarisHrvat/assayplot/actions/workflows/ci.yml)
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
**[Releasing](docs/RELEASING.md)** ·
**[Building on GitLab](docs/GITLAB.md)**

## Downloads

| Your machine | File |
|---|---|
| Mac with Apple Silicon (M1 and later) | `AssayPlot_x.y.z_macOS_AppleSilicon.dmg` |
| Mac with an Intel processor | `AssayPlot_x.y.z_macOS_Intel.dmg` |
| Windows | `AssayPlot_x.y.z_Windows_x64_setup.exe` |
| Debian, Ubuntu, Mint | `AssayPlot_x.y.z_Linux_Debian-Ubuntu_x64.deb` |
| Fedora, RHEL, openSUSE | `AssayPlot_x.y.z_Linux_Fedora-RHEL_x64.rpm` |
| Any other Linux | `AssayPlot_x.y.z_Linux_x64.AppImage` |

Not sure which Mac you have? Apple menu → About This Mac. "Apple M1/M2/M3/M4"
means Apple Silicon; "Intel Core" means Intel.

Builds are not signed, so the first launch is blocked:

- **macOS** — **System Settings → Privacy & Security**, scroll to Security, press
  **Open Anyway**. The right-click-then-Open trick stopped working in macOS 15.
  Or `xattr -dr com.apple.quarantine /Applications/AssayPlot.app`.
- **Windows** — SmartScreen: **More info**, then **Run anyway**.
- **Linux** — `chmod +x` the AppImage, or `sudo dpkg -i` the `.deb`.

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
