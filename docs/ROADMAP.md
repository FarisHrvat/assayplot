# AssayPlot roadmap

Where the project is, and what is deliberately not built yet.

## Where it is

**v0.3.0 — testable alpha.** The workflow is complete end to end: import data,
run a defensible analysis, build a figure, assemble a panel, export it, save the
project, reopen it later. 164 tests pass, 36 of them checked against R 4.4.2.

| Milestone | State |
|---|---|
| M0 · Statistical core validated against R | Done |
| M1 · Document model, live recompute, project format | Done |
| M2 · Data grid, import, undo | Done |
| M3 · Analyses, post-hoc, assumption checks | Done |
| M4 · Figure engine, direct editing, export | Done |
| M5 · Nonlinear regression | Partial — 4PL fits, but no parameter intervals |
| M6 · Layouts, packaging, docs, accessibility | Mostly done — signing outstanding |

## Release blockers

Things that must be settled before calling this 1.0 and asking labs to rely on it.

**Code signing.** Builds are unsigned, so macOS Gatekeeper and Windows
SmartScreen both warn on first launch. Unsigned scientific software gets
abandoned at the security dialog. This needs:

- An Apple Developer account, a Developer ID certificate, and notarisation.
- A Windows code-signing certificate. These increasingly require hardware-backed
  key storage and issuance is measured in weeks.

Both require the project owner's identity and payment; neither can be automated
away. Start them early — the technical wiring is an afternoon, the paperwork is
not.

**Beta with real labs.** The interface has been designed from an inferred
workflow, not an observed one. Watching five people use it on their own data
will change decisions that no amount of testing will surface.

**Confidence intervals on dose–response parameters.** An EC50 without an
interval is half an answer, and pharmacology is the use case most likely to
adopt this. Needs the covariance matrix from the fit, or a profile-likelihood or
bootstrap interval.

## Next, in rough priority order

1. **Dose–response parameter intervals**, plus comparison of fits by
   extra-sum-of-squares F-test and AICc, and shared parameters across datasets.
   This is the single biggest gap for the labs most likely to switch.
2. **Repeated-measures ANOVA.** Friedman covers the non-parametric case; the
   parametric one is a common request and needs a subject factor in the model.
3. **Subcolumn replicates.** Technical replicates side by side within one
   treatment column, as Prism does. A deep change to the data model, which is
   why it has waited.
4. **Analysis in a worker.** Everything currently recomputes on the main thread.
   That is fine today — 100k rows analyse in about 100 ms — but a slow procedure
   on a large table would freeze the interface.
5. **Prism import.** Its CSV and XML exports, not the proprietary binary. Purely
   an on-ramp for people with years of existing projects.
6. **More figure control**: discontinuous axes, secondary Y axes, annotation
   layers, per-point styling.

## Deliberately not doing

- **A cloud service.** Local-first is the point. Optional sync could come later,
  but analysis will never require an account.
- **Cloning Prism's interface or file format.** Independent implementation, open
  format, and citations to the statistical literature.
- **Claiming clinical or regulatory validation.** Agreement with R on a test
  suite is not the same thing, and saying otherwise would be dishonest.
- **Telemetry.** There is none, and none is planned.
- **Every advanced method.** Breadth after depth. A wrong number in an obscure
  procedure damages trust in every correct one beside it.

## Principles that have held up

Worth recording, because each one caught something real:

- **The engine never touches the DOM.** Every result is a pure function of a
  table and a specification, which is why 164 tests can run in Node in seconds.
- **Validate against an independent implementation.** Ten defects have been
  found by comparing against R; several had survived a fully green test suite.
  Self-consistent tests confirm that code does what it does.
- **Test what a procedure is not famous for.** The dose–response model had Top
  and Bottom inverted. R² and the EC50 were both perfect. Only an assertion on
  the labels caught it.
- **Explain, never choose.** The app says why a method is unavailable and what
  each one assumes, and refuses to pick a test for the user.
- **An affordance is not part of the figure.** Editing placeholders and
  selection outlines are stripped from every export.
