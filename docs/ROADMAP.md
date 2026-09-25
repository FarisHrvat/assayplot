# AssayPlot roadmap

Where the project is, what is left, and what is deliberately not being built.

## Where it is

**v0.7.1 — testable alpha.** The workflow is complete end to end: import data,
run a defensible analysis, build a figure, assemble a panel, export it, save the
project, reopen it later. 256 tests pass, 63 of them checked against R 4.6.1.

| Milestone | State |
|---|---|
| M0 · Statistical core validated against R | Done |
| M1 · Document model, live recompute, project format | Done |
| M2 · Data grid, import, undo | Done |
| M3 · Analyses, post-hoc, assumption checks | Done |
| M4 · Figure engine, direct editing, export | Done |
| M5 · Nonlinear regression | Done — parameter intervals, model comparison, AICc |
| M6 · Layouts, packaging, docs, accessibility | Done |
| M7 · Desktop shell, updates, preferences | Done |
| M8 · Signing and a beta with real labs | Needs the project owner |

## Release blockers

Two things stand between this and calling it 1.0. Neither is code.

**Code signing.** Builds are unsigned, so macOS Gatekeeper and Windows
SmartScreen both warn on first launch, and unsigned scientific software gets
abandoned at the security dialog.

The workflow is already wired for it: each signing step skips itself when its
secret is unset, so the day a certificate arrives nothing else has to change.
[docs/RELEASING.md](RELEASING.md) lists exactly which secrets to add. What
cannot be automated is the paperwork:

- An Apple Developer account, a Developer ID certificate, and notarisation.
- A Windows certificate. These now require hardware-backed key storage, which
  in practice means Azure Trusted Signing or a comparable service; issuance is
  measured in weeks.

Both need the project owner's identity and payment. Start them early — the
technical wiring is done, the paperwork is not.

**Beta with real labs.** The interface was designed from an inferred workflow,
not an observed one. Watching five people use it on their own data will change
decisions no amount of testing will surface. This is the single highest-value
thing left, and it cannot be done from inside the repository.

## Next, in rough priority order

1. **Subcolumn replicates.** Technical replicates side by side within one
   treatment column, averaged or carried through to the analysis as the user
   chooses. This is a change to the data model, the grid, the file format and
   every analysis that reads a column, which is why it has waited: it is the
   kind of change that should land on its own, with its own test pass, rather
   than beside anything else.
2. **Crossed random effects.** The mixed-effects model takes one random
   intercept per subject, which covers repeated measures and is validated
   against `nlme`. Two crossed factors — subject and batch, say — need a
   general optimiser rather than the closed form a single intercept allows, and
   there is no oracle installed to check it against. Doing it without one would
   break the rule the whole project rests on.
3. **Profile-likelihood intervals** on dose–response parameters, alongside the
   Wald ones. Where a curve is poorly determined the Wald interval is
   optimistic, and the result says so, but saying so is not the same as fixing
   it.
4. **Three-way ANOVA**, and repeated measures with two within-subject factors.

## Considered and not done

**Analysis in a worker.** Everything recomputes on the main thread. The
temptation is to move it off, but 100,000 rows analyse in about 100 ms, and
moving the engine across a worker boundary makes every result asynchronous and
every table a serialisation cost. That is a large change to the store and every
view in exchange for a problem nobody has hit. It will be worth doing the first
time someone reports a freeze, and not before.

## Deliberately not doing

- **A cloud service.** Local-first is the point. Optional sync could come later,
  but analysis will never require an account.
- **Cloning any commercial package's interface or file format.** Independent
  implementation, open format, and citations to the statistical literature.
- **Claiming clinical or regulatory validation.** Agreement with R on a test
  suite is not the same thing, and saying otherwise would be dishonest.
- **Telemetry.** There is none, and none is planned. The update check asks
  GitHub which release is newest and sends nothing about the user or their data.
- **Every advanced method.** Breadth after depth. A wrong number in an obscure
  procedure damages trust in every correct one beside it.

## Principles that have held up

Worth recording, because each one caught something real:

- **The engine never touches the DOM.** Every result is a pure function of a
  table and a specification, which is why 256 tests run in Node in seconds.
- **Validate against an independent implementation.** Sixteen defects have been
  found by comparing against R; several had survived a fully green test suite.
  Self-consistent tests confirm that code does what it does.
- **Test what a procedure is not famous for.** The dose–response model had Top
  and Bottom inverted. R² and the EC50 were both perfect. Only an assertion on
  the labels caught it.
- **Look at the output.** Rendering the multivariate figures and looking at them
  caught four things no assertion would have: clipped labels, a curve drawn
  against the wrong axis, and two names written on top of each other.
- **Explain, never choose.** The app says why a method is unavailable and what
  each one assumes, and refuses to pick a test for the user.
- **An affordance is not part of the figure.** Editing placeholders and
  selection outlines are stripped from every export.
