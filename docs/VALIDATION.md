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
committed ones have drifted**. That catches both a regression in AssayPlot and a
change in R's own behaviour, and it makes hand-editing a fixture to force a pass
impossible to hide.

```bash
npm test                                   # validate against committed fixtures
Rscript validation/generate/reference.R    # regenerate them (needs R)
```

## Tolerances

| Kind of value | Bound | Why |
|---|---|---|
| Closed-form statistics and p-values | 1 × 10⁻¹⁰ relative | Should agree to near machine precision |
| Tukey confidence intervals | 1 × 10⁻⁷ relative | Inverted studentized range, numerically integrated |
| Tukey p-values | 1 × 10⁻⁴ relative | Far-tail cancellation; see below |
| Fisher conditional odds ratio | 1 × 10⁻³ relative | R's own estimate is the imprecise one |
| Both values below 1 × 10⁻⁹ | Treated as agreeing | Beyond the resolution of either implementation |

Two of these deserve explanation, because in both cases AssayPlot is *not* the
less accurate side:

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

The last two are worth dwelling on: the fit was numerically perfect either way,
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

These found three further defects: ANOVA dividing 0 by 0 when every value is
identical, chi-square dividing by a zero expected count, and arithmetic overflow
past about 1e154 turning every statistic into NaN. `runAnalysis` now enforces
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

**Every statistical procedure AssayPlot ships has a golden fixture.** 36 cases:

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

Levene, Dunn, Grubbs, and the 4PL fit are computed in the fixture script from
their published formulae in base R rather than by importing `car`, `dunn.test`
and `drc` — the same arithmetic those packages implement, and CI stays free of
extra R dependencies.

## What validation does not mean

AssayPlot is **not validated for clinical or regulatory use**, and agreement with
R is not a claim of fitness for any particular purpose. It means the arithmetic
matches an independent, widely reviewed implementation on the cases tested. It
does not mean the test you chose was the right one for your experiment.
