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
| Tukey far-tail p-values | 5 × 10⁻³ relative | See below |
| Fisher conditional odds ratio | 1 × 10⁻³ relative | R's own estimate is the imprecise one |
| Both values below 1 × 10⁻⁹ | Treated as agreeing | Beyond the resolution of either implementation |

Two of these deserve explanation, because in both cases AssayPlot is *not* the
less accurate side:

**Fisher's conditional odds ratio.** R's `fisher.test` finds it with `optimize()`
at its default tolerance, giving about four significant figures. AssayPlot solves
E[X | ψ] = a by bisection to about 1 × 10⁻¹², and was checked to satisfy that
equation more closely than R's own answer. The loose bound reflects the oracle's
precision, not ours.

**Tukey far-tail p-values.** These come from `1 − CDF` of a numerically
integrated studentized range. Once the CDF saturates against 1 in double
precision the subtraction discards the leading digits. Raising the quadrature
resolution does not help — the loss is in the subtraction, not the integral —
so far-tail values carry roughly three significant figures. That is far more
precision than a reported p-value needs. Below `RANGE_P_FLOOR` (1 × 10⁻¹⁰) the
value should be read as "smaller than this"; the floor is returned rather than
zero so a p-value never claims to be exactly zero.

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

The last two are worth dwelling on: the fit was numerically perfect either way,
so `R²` and the EC50 both looked right. Only an assertion on the *labels* caught
it. A test suite that only checks the numbers a procedure is famous for will miss
this class of bug.

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

32 golden cases across: Welch, Student, paired and one-sample *t*-tests;
Mann–Whitney and Wilcoxon in both exact and approximate branches; one-way and
two-way ANOVA; Kruskal–Wallis; Friedman; Tukey HSD; Pearson, Spearman and linear
regression; chi-square with and without Yates; Fisher's exact; Shapiro–Wilk;
Bartlett; Kaplan–Meier; the log-rank test; and the Holm and Benjamini–Hochberg
corrections.

Procedures **not** yet covered by a fixture, because no trusted reference was
available in R without adding a dependency: Dunn's test, Levene's test, Grubbs'
test, and the four-parameter logistic fit. These are covered by unit tests
against published worked examples and by round-trip tests that recover known
parameters from synthetic data — weaker evidence, and stated as such.

## What validation does not mean

AssayPlot is **not validated for clinical or regulatory use**, and agreement with
R is not a claim of fitness for any particular purpose. It means the arithmetic
matches an independent, widely reviewed implementation on the cases tested. It
does not mean the test you chose was the right one for your experiment.
