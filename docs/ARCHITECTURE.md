# Architecture decision: local-first desktop

## Decision

AssayPlot will be designed as an offline-first application that runs analysis, rendering, import, and export on the researcher’s computer. The user interface will be built with web technologies and packaged as a cross-platform desktop application. A browser build may be published as a companion mode, but no cloud service is required for the core product.

## Why

- Lab data can remain on the device by default.
- Compute and storage scale with the user’s machine rather than our server bill.
- Large or sensitive datasets do not need to be uploaded.
- A project can be saved, moved, and reopened as a portable artifact.
- The same interface can later support optional collaboration without making accounts mandatory.

## Runtime layers

```text
Desktop shell (Tauri)
  native file dialogs, filesystem, menus, installers, optional embedded runtime

Application UI (TypeScript)
  workspace, data grid, analysis wizard, figure editor, project navigator

Domain core (pure TypeScript/WASM)
  schema, transformations, analysis specifications, graph grammar, migrations

Numerical backends
  validated distributions, linear algebra, optimization, R/WASM adapters where needed

Import/export adapters
  CSV/TSV/TXT, XLSX/XLS, JSON project, SVG, PNG, PDF, JPEG, TIFF
```

All user-visible outputs should be generated from a project state and an explicit analysis specification. The UI must never contain the only copy of a statistical calculation.

## Capability matrix

| Capability | Current prototype | Desktop target |
|---|---|---|
| CSV import/export | Working | Working, with validation and encoding detection |
| TXT/TSV and paste | Table editing only | Robust delimiter detection and paste preview |
| XLSX/XLS | Planned | Bundled local parser; no upload required |
| JSON project | Working export | Versioned portable project container with migrations |
| SVG | Working export | Editable vector export with fonts, dimensions, and metadata |
| PNG/JPEG | Planned | Deterministic raster export at chosen DPI |
| PDF/TIFF | Planned | Local print/PDF and scientific raster export with color profiles |
| Graphs | Dot/mean preview | 40+ named templates implemented as composable layers |
| Statistics | Welch t-test + descriptives | Validated library with assumptions, effect sizes, intervals, and citations |
| Collaboration | None | Optional service, never required for local analysis |

## File handling policy

Import is a staged operation: inspect → preview → map columns → confirm → create immutable source table. Original imported bytes and a content hash are retained in the project when the user chooses “keep source”. Derived tables never overwrite raw data. Export must show the selected format, dimensions/DPI, color mode, and whether text remains editable.

## Scalability

The core workload is client-side. For large tables, use virtualized rendering, chunked parsing, worker threads, and typed arrays. Analysis jobs should run in workers so the interface remains responsive. An optional server, if added later, should only handle collaboration/sync and never be required to calculate a result.

## Packaging path

1. Keep the current static prototype dependency-light while the data model and UX are explored.
2. Move application code to TypeScript modules with unit tests and schema validation.
3. Add a worker-based analysis engine and adapters for spreadsheet parsing and export.
4. Package the UI and local core with Tauri; expose native open/save dialogs and project directories.
5. Add signed installers for macOS, Windows, and Linux, plus a portable project format.

The initial shell is in `src-tauri/`. It intentionally has no analysis-specific native commands yet; those will be added only for capabilities that need filesystem access, background workers, or a bundled numerical runtime.
