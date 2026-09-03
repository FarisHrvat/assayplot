# Contributing to AssayPlot

Thanks for looking. This is a tool people will put in papers, so the bar for
statistical code is deliberately higher than for interface code.

## Getting set up

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 127 tests
npm run typecheck
```

R is optional. You only need it to regenerate the validation fixtures:

```bash
Rscript validation/generate/reference.R
```

## The two rules

**1. A statistical change needs a fixture proving it against R.**

Add a case to `validation/generate/reference.R`, regenerate, and register a
runner in `tests/golden.test.js`. If R cannot compute it without an extra
package, say so in `docs/VALIDATION.md` under "not yet covered by a fixture" and
test against a published worked example instead. Do not add a procedure with no
independent check at all.

Never edit a file in `validation/fixtures/` by hand. CI regenerates them with R
and fails on any drift, which is the point.

**2. A bug fix needs a test that fails without it.**

Ten real defects have been found in this codebase so far, every one by comparing
against an independent implementation rather than by reasoning about the code.
Several passed a full green test suite for weeks. If you cannot write a test
that fails before your fix, you have probably not found the bug yet.

The dose–response bug is the instructive one: the model was written with Top and
Bottom inverted. The fit was numerically perfect either way, so R² and the EC50
both looked right. Only an assertion on the *labels* caught it. Test the things a
procedure is not famous for.

## Where things live

| Path | What belongs there |
|---|---|
| `src/core/` | Pure statistics. No DOM, no imports from `src/app`. Plain JS. |
| `src/app/model.ts` | Document types, and the pure function from (table, spec) to result. |
| `src/app/store.ts` | State, undo, the dependency graph. Every mutation goes through `commit`. |
| `src/app/plot.tsx` | FigureSpec → SVG. The same tree that is exported. |
| `src/app/io.ts` | Import, export, the project container, and migrations. |
| `src/app/ui.tsx` | React components. No calculation here — ever. |

The rule that matters: **no statistical calculation in a component.** Everything
visible must be derived from a project state plus an explicit specification, so
it can be tested in Node and reproduced from a saved file.

## Style

Match the surrounding code. `src/core/stats.js` is written in a very compressed
style for historical reasons; new numerical modules (`posthoc.js`,
`diagnostics.js`) are written expanded, because those are the routines whose
correctness is hardest to inspect. Prefer the expanded style for anything new.

Comments should say *why*, not *what*. A comment explaining that a tie correction
sums per tie group rather than per observation is worth its space; one saying
"loop over the rows" is not.

## Changing the file format

Bump `SCHEMA_VERSION` in `src/app/model.ts` and extend `migrate()` in
`src/app/io.ts`. Migrations run **forward only** — never mutate a file in place
to suit an older reader. Add a test that opens a project written under the
previous version.

## Adding an analysis

1. Implement it in `src/core/`, taking and returning plain values.
2. Check it against R by hand first. Every core function checked so far has had
   at least one defect.
3. Add a `METHODS` entry in `model.ts` with the shapes it accepts and a
   plain-language statement of what it assumes.
4. Add a branch to `runAnalysis`, returning actionable errors rather than
   throwing. "Paired tests need equal numbers of values (8 vs 6)" beats
   "invalid input".
5. Add a methods sentence.
6. Add a fixture.

## Adding a plot type

Add it to `PLOT_KINDS` in `plot.tsx` with the table shape it expects, then a
branch in `Plot`. Marks should carry a `<title>` for hover and, where it makes
sense, a click handler that traces back to the source row.

Anything drawn only as an editing affordance — a placeholder label, a selection
outline — must not appear in an export. Placeholders are tagged
`data-placeholder` and stripped in `svgSource`.

## Reporting a wrong number

This is the most valuable kind of report. Please include the data, the analysis
you ran, what AssayPlot said, and what you expected — ideally with the R or Prism
output beside it. A reproducible disagreement with a trusted implementation goes
straight to the front of the queue.

## Licence

Contributions are made under [AGPL-3.0-or-later](LICENSE).
