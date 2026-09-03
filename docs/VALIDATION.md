# How the statistics are validated

Every statistical procedure in AssayPlot is checked against **R** on every test
run. This document explains the arrangement, what it has caught, and what its
limits are.

## The arrangement

R is used as an *offline oracle*, not as a runtime dependency:

```
validation/generate/reference.R   →   validation/fixtures/reference.json
        (run by hand, or in CI)              (committed to the repository)
                                                      │
                                                      ▼
                                          tests/golden.test.js
                                     (runs in CI without R installed)
```

`reference.R` computes each procedure in R at full double precision and writes
inputs and expected outputs to JSON. Those fixtures are committed, so the test
suite validates the TypeScript engine on any machine with only Node installed.

A separate CI job installs R, regenerates the fixtures, and **fails if the
committed ones have drifted**. Drift is judged numerically at 1 × 10⁻¹²
relative, not byte for byte: R's own math library differs by an ulp between
macOS on ARM and Linux on x86. A handful of fields R computes by integration or
iteration are compared more loosely, and `scripts/compare-fixtures.mjs` names
each one and says why — R's `ptukey`, for instance, returns
2.1080936996043 × 10⁻¹⁰ on one platform and 2.10809036893522 × 10⁻¹⁰ on the
other for the same input. Even so the check still fails on a change of one part
in a million to a Tukey p-value, which is two orders of magnitude finer than
any real change to a procedure. That catches both a regression in AssayPlot and a
change in R's own behaviour, and it makes hand-editing a fixture to force a pass
impossible to hide.

```bash
npm test                                   # validate against committed fixtures
Rscript validation/generate/reference.R    # regenerate them (needs R 4.5 or later)
```

R 4.5 changed `wilcox.test`: with ties it now computes the exact conditional
distribution over the observed midranks instead of falling back to a normal
approximation. AssayPlot follows the newer behaviour, so regenerating the
fixtures with R 4.4 or earlier will produce different values for the two tied
cases. The generator refuses to run on an older R rather than writing them.

## Tolerances

| Kind of value | Bound | Why |
|---|---|---|
| Closed-form statistics and p-values | 1 × 10⁻¹⁰ relative | Should agree to near machine precision |
| Tukey confidence intervals | 1 × 10⁻⁷ relative | Inverted studentized range, numerically integrated |
| Tukey p-values | 1 × 10⁻⁴ relative | Far-tail cancellation; see below |
| Fisher conditional odds ratio | 1 × 10⁻³ relative | R's own estimate is the imprecise one |
| Both values below 1 × 10⁻⁹ | Treated as agreeing | Beyond the resolution of either implementation |

Two need explaining, because in both AssayPlot is not the less accurate side:

**Fisher's conditional odds ratio.** R's `fisher.test` finds it with `optimize()`
at its default tolerance, giving about four significant figures. AssayPlot solves
E[X | ψ] = a by bisection to about 1 × 10⁻¹², and was checked to satisfy that
equation more closely than R's own answer. The loose bound reflects the oracle's
precision, not ours.

**Tukey p-values.** The studentized range CDF is integrated numerically and
agrees with R's `ptukey` to about 1 × 10⁻¹⁰. The p-value is then `1 − CDF`, and
once the CDF saturates against 1 in double precision that subtraction discards
the leading digits. Raising the quadrature resolution does not help — the loss
is in the subtraction, not the integral. Below `RANGE_P_FLOOR` (1 × 10⁻¹⁰) the
value should be read as "smaller than this"; the floor is returned rather than
zero so a p-value never claims to be exactly zero.

An earlier version of this integrator was sixty times slower *and* sixty times
less accurate: it used 96 Gauss-Legendre nodes over 12 panels, and a polynomial
`erf` inside the integrand that put an 8 × 10⁻⁹ floor under every value. The
extra nodes could not get past that floor. Sharing the incomplete-gamma normal
CDF and dropping to 32 nodes over 4 panels improved accuracy to 1.3 × 10⁻¹⁰ and
cut a Tukey HSD on three groups from 2,400 ms to 140 ms — which matters, because
results recompute on every keystroke.

## What this has actually caught

Every one of these was invisible to a self-consistent test suite, and every one
was found by comparing against R:

| Defect | Effect |
|---|---|
| Mann–Whitney tie correction summed `t³ − t` once per **observation** instead of once per tie group | p-values wrong by ~6% whenever ties were present |
| Wilcoxon tie term divided by 24 instead of 48 | Small but systematic error |
| No exact branch for Mann–Whitney or Wilcoxon | 1.55 × 10⁻⁴ reported as 7.78 × 10⁻⁴ at *n* = 8 — a factor of five, in exactly the sample sizes lab work uses |
| `normalCdf` built on the Abramowitz–Stegun `erf` (1.5 × 10⁻⁷ *absolute* error) | All relative accuracy lost in the tail |
| Student-*t* and *F* tails computed as `2 × (1 − cdf)` | Cancels twice; extreme tails underflowed to zero |
| `friedmanTest` handed its matrix transposed by the caller | Wrong statistic whenever it was used |
| Friedman tie correction summed group **sizes** instead of `t³ − t` | Wrong correction with ties |
| `twoWayAnova` F tail computed as `1 − I_x` | Wrong from the 8th significant figure |
| 4PL model written as `(x/EC50)^hill`, inverting Top and Bottom | A 5 → 100 response reported as Top = 5, Bottom = 100 |
| Dose–response passed log₁₀(x) to a fitter expecting linear concentrations | Any dose below 1 rejected; EC50 wrong when it ran |
| ANOVA on data with no variation divided 0 by 0 | `p = NaN` shown as an empty dash rather than an explanation |
| Chi-square with an all-zero row or column divided by a zero expected count | Same |
| Values past ~1e154 overflowed every sum of squares | Statistic and p-value silently became NaN |
| Rank tests with ties used a normal approximation | Matched R 4.4 but not R 4.5+, which conditions on the observed midranks |
| The incomplete beta continued fraction applied its first term twice — the term already folded into the initialiser | *F* tails with more than one numerator degree of freedom returned p-values of 3.5 and −0.78 |
| `normalCdf` returned 0 for NaN, and NaN past about 150 standard deviations where squaring the argument overflows | A p-value of exactly 2 |

The last two matter: the fit was numerically perfect either way,
so `R²` and the EC50 both looked right. Only an assertion on the *labels* caught
it. A test suite that only checks the numbers a procedure is famous for will miss
this class of bug.

## Property tests

Beyond the fixtures, `tests/fuzz.test.ts` throws thousands of awkward tables at
every analysis — blanks, stray text, zeroes, negatives, values at 1e300 and
1e-300, single rows, columns of identical values — and asserts the invariants
that must hold whatever the input:

- Nothing throws.
- A p-value is a probability or absent. Never NaN, never outside [0, 1].
- Every result either reports something or explains why it cannot.
- Nothing a scientist reads is NaN or Infinity.
- Every refusal names something actionable, not "invalid input".
- An analysis is deterministic and never mutates the table it was given.

These found five defects. Three when they were written: ANOVA dividing 0 by 0
when every value is identical, chi-square dividing by a zero expected count, and
arithmetic overflow past about 1e154 turning every statistic into NaN. Two more
when the mixed model and Mendelian randomisation arrived, both in code the whole
suite already depended on: a continued fraction that applied its first term
twice, and a normal CDF that returned 0 for NaN and NaN for a very large
argument. Neither had shown up in any fixture, because no fixture had a reason
to evaluate an *F* tail on two numerator degrees of freedom or a *z* of 10²⁰⁰. `runAnalysis` now enforces
the p-value invariant globally, so anything not caught by a specific guard
becomes an explanation rather than reaching the screen.

## Edge cases every procedure is tested against

- *n* = 2, and *n* = 1 in one group
- Zero variance in a group; identical values throughout
- Heavy ties in rank-based procedures
- Missing values scattered, a whole column missing, a whole row missing
- Badly unbalanced group sizes
- Values spanning many orders of magnitude (10⁸ and above, to check
  catastrophic cancellation)
- Non-numeric contamination: a stray `N/A`, a trailing space, a comma decimal

## Coverage

**Every statistical procedure AssayPlot ships has a golden fixture**, or, where
no implementation exists to compare against, an external oracle of another kind.
61 fixture cases:

| Area | Procedures |
|---|---|
| *t*-tests | Welch, Student, paired, one-sample |
| Rank tests | Mann–Whitney and Wilcoxon, in both the exact and approximate branches; Kruskal–Wallis; Friedman |
| ANOVA | One-way, two-way with replication |
| Post-hoc | Tukey HSD (p-values and family-wise intervals), Dunn's test |
| Correlation and fitting | Pearson, Spearman, linear regression, four-parameter logistic |
| Counts | Chi-square with and without Yates, Fisher's exact |
| Assumptions | Shapiro–Wilk, Levene (Brown–Forsythe), Bartlett, Grubbs |
| Survival | Kaplan–Meier, log-rank |
| Multiplicity | Holm, Benjamini–Hochberg |
| Agreement | McNemar, Cohen's kappa, TOST, Bland–Altman, Mantel–Haenszel, Cochran's Q |
| Modelling | Logistic and Poisson regression (`glm`), ANCOVA (`lm` with `drop1`), Cox (`survival::coxph`, Efron ties), mixed effects (`nlme::lme`, REML), GEE (`geepack::geeglm`, exchangeable) |
| Multivariate | Principal components (`prcomp`, scaled and unscaled), hierarchical clustering (`hclust` × four linkages × three distances, with `cutree`), ANOSIM (`vegan::anosim`) |
| Genetics | Transmission disequilibrium (`mcnemar.test` without continuity correction), Mendelian randomisation (weighted `lm`, with and without an intercept) |

Levene, Dunn, Grubbs, and the 4PL fit are computed in the fixture script from
their published formulae in base R rather than by importing `car`, `dunn.test`
and `drc` — the same arithmetic those packages implement, and CI stays free of
extra R dependencies. The `nlme`, `geepack` and `vegan` cases are guarded by
`requireNamespace`, so the generator still runs on a bare R and simply writes
fewer cases; CI installs all three.

### The three without an R oracle

**Simon's two-stage design** is checked against the table published with the
method in 1989. `tests/designs.test.js` reproduces five entries — both the
optimal and the minimax design for each — as exact integers, which is a stronger
check than a tolerance: the search either finds the published `r1/n1, r/n` or it
does not.

**PLS-DA** has no reference implementation in base R, and `mixOmics` and `ropls`
disagree with each other on scaling and on how VIP is defined. The NIPALS
decomposition itself is checked by its defining property — successive components
are orthogonal and reconstruct the deflated matrix — and the number that is
actually reported to the user is the leave-one-out accuracy, which is computed by
refitting rather than by any formula that could be subtly wrong.

**ROUT** has no published per-dataset values to compare against, so it is tested
on the two claims the method makes: it finds a pair of outliers without either
masking the other, which is what it exists to do and what Grubbs cannot do; and
its false discovery rate on clean normal samples stays under the rate asked for,
measured over a thousand samples from a fixed generator.

## What validation does not mean

AssayPlot is **not validated for clinical or regulatory use**, and agreement with
R is not a claim of fitness for any particular purpose. It means the arithmetic
matches an independent, widely reviewed implementation on the cases tested. It
does not mean the test you chose was the right one for your experiment.
