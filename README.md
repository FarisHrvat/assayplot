# Statista

Statista is an open-source, offline-first scientific data analysis and graphing app for researchers who want a friendly alternative to expensive point-and-click tools.

## Current status

The repository contains a working local-first application slice: CSV/TSV/TXT and Excel workbook import, editable multi-column data, filtering and derived transforms, descriptive statistics, Welch/Mann–Whitney/ANOVA/correlation/regression analyses, guided recommendations, saved analysis provenance, editable SVG figures, PNG/JPEG export, print-to-PDF, XLSX/CSV export, project JSON persistence, figure templates, and a Tauri desktop shell. The browser bundle and Rust shell both pass local verification.

## Run locally

Because the first slice has no build dependencies, it can be opened directly in a browser or served by any static file server. For example:

```text
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Run the statistical core tests with `npm test`.

## Desktop shell

The repository includes a Tauri 2 desktop shell in `src-tauri/`. Install the Rust/Tauri prerequisites, then use the Tauri CLI to run or build the application. The shell points at the existing static frontend, so no hosted backend is required.

## Product direction

See [docs/ROADMAP.md](docs/ROADMAP.md) for the end-to-end product plan, scope boundaries, architecture, statistical validation strategy, licensing, and milestones.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the local-first desktop decision and capability matrix.

## Principles

- Offline by default: lab data stays on the device.
- Reproducible: projects preserve raw data, transformations, analysis settings, and outputs.
- Guided, not presumptive: the app explains assumptions and does not silently choose a test.
- Open formats: CSV import/export and human-readable JSON projects.
- Publication-ready: figures are editable and exportable without vendor lock-in.

## License

Planned license: AGPL-3.0-or-later for the application, with third-party dependencies tracked separately. This is a product decision to confirm before the first public release.
