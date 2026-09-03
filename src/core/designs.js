// Designs and specialised models: mixed effects, GEE, robust outlier removal,
// genetic association, Mendelian randomisation, and Simon's two-stage plan.

import { studentTCdf } from './stats.js';
import { normalCdf, chiSquareUpperTail } from './diagnostics.js';
import { choleskySolve, invertSymmetric } from './regression.js';

/** Two-sided t tail. */
const tTail = (t, df) => 2 * (1 - studentTCdf(Math.abs(t), df));

/** Upper F tail: the chance of an F this large or larger. */
const fTail = (f, df1, df2) => {
  if (!(f > 0)) return 1;
  if (df1 === 1) return tTail(Math.sqrt(f), df2);
  return incompleteBeta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
};

/** Regularised incomplete beta by its continued fraction, for the F tail. */
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);

  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );

  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;

  // The recurrence alternates between two forms; the first is already folded
  // into d above, so the loop starts on the second.
  for (let i = 1; i <= 400; i += 1) {
    const m = i % 2 ? (i + 1) / 2 : i / 2;
    const numerator = i % 2
      ? (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
      : (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    const delta = c * d;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return (front * h) / a;
}

function logGamma(z) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i += 1) a += g[i] / (x + i + 1);
  const t = x + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const chiSquareTail = chiSquareUpperTail;

/**
 * Linear mixed model, one random intercept per subject, REML.
 *
 * Takes the place of repeated-measures ANOVA. Keeps a subject who missed one
 * measurement, and does not need the same count from everyone.
 *
 * With a single random intercept the covariance has a closed form, so the fit
 * reduces to a one-dimensional search over the variance ratio rather than a
 * general optimiser. `subjects` and `conditions` are parallel label arrays.
 */
export function mixedModel(values, subjects, conditions) {
  const n = values.length;
  if (n !== subjects.length || n !== conditions.length) {
    throw new Error('Every value needs a subject and a condition.');
  }

  const subjectNames = [...new Set(subjects)];
  const conditionNames = [...new Set(conditions)];
  const m = subjectNames.length;
  const k = conditionNames.length;
  if (k < 2) throw new Error(`A mixed model compares two or more conditions; ${k} was found.`);
  if (m < 2) throw new Error(`Needs at least two subjects; ${m} was found.`);
  if (n <= k + m - 1) throw new Error(`Too few observations: ${n} values cannot support ${k} conditions across ${m} subjects.`);

  // Design matrix: intercept plus treatment contrasts against the first level.
  const design = values.map((_, i) => {
    const row = new Array(k).fill(0);
    row[0] = 1;
    const level = conditionNames.indexOf(conditions[i]);
    if (level > 0) row[level] = 1;
    return row;
  });

  const blocks = subjectNames.map((name) => {
    const rows = [];
    for (let i = 0; i < n; i += 1) if (subjects[i] === name) rows.push(i);
    return rows;
  });

  /**
   * Generalised least squares at a given variance ratio. The inverse of
   * I + rho*J is I - rho/(1 + n*rho) * J, so no matrix is ever inverted per
   * subject; only the k by k cross-product is.
   */
  const gls = (rho) => {
    const xtx = Array.from({ length: k }, () => new Array(k).fill(0));
    const xty = new Array(k).fill(0);
    let yty = 0;
    let logDeterminant = 0;

    for (const rows of blocks) {
      const size = rows.length;
      const shrink = rho / (1 + size * rho);
      logDeterminant += Math.log(1 + size * rho);

      const sumX = new Array(k).fill(0);
      let sumY = 0;
      for (const i of rows) {
        sumY += values[i];
        for (let a = 0; a < k; a += 1) sumX[a] += design[i][a];
      }
      for (const i of rows) {
        yty += values[i] * values[i];
        for (let a = 0; a < k; a += 1) {
          xty[a] += design[i][a] * values[i];
          for (let b = a; b < k; b += 1) xtx[a][b] += design[i][a] * design[i][b];
        }
      }
      yty -= shrink * sumY * sumY;
      for (let a = 0; a < k; a += 1) {
        xty[a] -= shrink * sumX[a] * sumY;
        for (let b = a; b < k; b += 1) xtx[a][b] -= shrink * sumX[a] * sumX[b];
      }
    }
    for (let a = 0; a < k; a += 1) for (let b = 0; b < a; b += 1) xtx[a][b] = xtx[b][a];

    const beta = choleskySolve(xtx, xty);
    if (!beta) return null;
    const residual = yty - beta.reduce((sum, value, a) => sum + value * xty[a], 0);
    return { beta, residual, logDeterminant, xtx };
  };

  // Profiled REML criterion. Minimised over the variance ratio by golden
  // section, which needs no derivatives and cannot leave the feasible region.
  const criterion = (rho) => {
    const fit = gls(rho);
    if (!fit || !(fit.residual > 0)) return Infinity;
    const xtxDeterminant = logDeterminantOf(fit.xtx);
    if (xtxDeterminant === null) return Infinity;
    return fit.logDeterminant + xtxDeterminant + (n - k) * Math.log(fit.residual);
  };

  const rho = goldenSection(criterion, 0, 1e6);
  const fit = gls(rho);
  const sigmaSquared = fit.residual / (n - k);
  const covariance = invertSymmetric(fit.xtx);
  if (!covariance) throw new Error('The model is singular: a condition may have no observations.');

  const withinDf = n - m - (k - 1);
  const standardErrors = fit.beta.map((_, a) => Math.sqrt(sigmaSquared * covariance[a][a]));

  // Wald F for the condition effect, testing every contrast at once.
  const contrasts = fit.beta.slice(1);
  const sub = Array.from({ length: k - 1 }, (_, a) =>
    Array.from({ length: k - 1 }, (_, b) => covariance[a + 1][b + 1] * sigmaSquared));
  const solved = choleskySolve(sub, contrasts);
  const wald = solved ? contrasts.reduce((sum, value, a) => sum + value * solved[a], 0) : NaN;
  const f = wald / (k - 1);

  const between = sigmaSquared * rho;

  return {
    n,
    subjects: m,
    conditions: conditionNames,
    varianceRatio: rho,
    subjectVariance: between,
    residualVariance: sigmaSquared,
    /** Share of the variance that is between subjects rather than within. */
    intraclassCorrelation: between / (between + sigmaSquared),
    terms: conditionNames.map((name, index) => ({
      term: index === 0 ? '(Intercept)' : `${name} − ${conditionNames[0]}`,
      estimate: fit.beta[index],
      standardError: standardErrors[index],
      t: fit.beta[index] / standardErrors[index],
      pValue: tTail(fit.beta[index] / standardErrors[index], withinDf),
    })),
    fStatistic: f,
    numeratorDf: k - 1,
    denominatorDf: withinDf,
    pValue: fTail(f, k - 1, withinDf),
    restrictedLogLikelihood: -0.5 * (criterion(rho) + (n - k) * (1 + Math.log(2 * Math.PI / (n - k)))),
  };
}

function logDeterminantOf(matrix) {
  const k = matrix.length;
  const a = matrix.map((row) => row.slice());
  let total = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < i; j += 1) a[i][i] -= a[i][j] * a[i][j];
    if (!(a[i][i] > 0)) return null;
    a[i][i] = Math.sqrt(a[i][i]);
    total += 2 * Math.log(a[i][i]);
    for (let j = i + 1; j < k; j += 1) {
      let sum = matrix[j][i];
      for (let l = 0; l < i; l += 1) sum -= a[j][l] * a[i][l];
      a[j][i] = sum / a[i][i];
    }
  }
  return total;
}

/** Minimises a unimodal function on [low, high] without needing derivatives. */
function goldenSection(f, low, high, tolerance = 1e-10) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = low;
  let b = high;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 400 && b - a > tolerance * (1 + Math.abs(a) + Math.abs(b)); i += 1) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = f(d);
    }
  }
  const best = (a + b) / 2;
  return f(0) <= f(best) ? 0 : best;
}

/**
 * Transmission disequilibrium test. Counts, among heterozygous parents, how
 * often each allele was passed to an affected child. Because each parent acts
 * as their own control, population structure cannot produce a false positive
 * the way a case-control comparison can.
 */
export function transmissionDisequilibrium(transmitted, untransmitted) {
  const b = transmitted;
  const c = untransmitted;
  if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || c < 0) {
    throw new Error('Transmission counts must be whole numbers of heterozygous parents.');
  }
  if (b + c === 0) throw new Error('No heterozygous parent transmitted either allele, so there is nothing to test.');

  const statistic = (b - c) ** 2 / (b + c);
  const ratio = c > 0 ? b / c : Infinity;
  const logSe = Math.sqrt(1 / Math.max(b, 0.5) + 1 / Math.max(c, 0.5));

  return {
    transmitted: b,
    untransmitted: c,
    informativeParents: b + c,
    statistic,
    df: 1,
    pValue: chiSquareTail(statistic, 1),
    transmissionRatio: ratio,
    confidenceInterval95: [Math.exp(Math.log(ratio) - 1.96 * logSe), Math.exp(Math.log(ratio) + 1.96 * logSe)],
  };
}

/**
 * Mendelian randomisation from summary statistics: each instrument contributes
 * its effect on the exposure and its effect on the outcome, and the causal
 * estimate is the slope through them.
 *
 * Three estimators, because agreement between them is the evidence:
 * inverse-variance weighted (efficient, but assumes no instrument affects the
 * outcome except through the exposure), MR-Egger (its intercept estimates the
 * average violation), and the weighted median (valid when up to half the
 * instruments are invalid).
 */
export function mendelianRandomization(instruments) {
  const usable = instruments.filter(
    (row) => Number.isFinite(row.exposureBeta) && Number.isFinite(row.outcomeBeta) && row.outcomeSe > 0
  );
  if (usable.length < 3) {
    throw new Error(`Needs at least three instruments; ${usable.length} usable one(s) were given.`);
  }

  // Orient every instrument so its effect on the exposure is positive; the
  // choice of effect allele is arbitrary and must not change the answer.
  const rows = usable.map((row) => (row.exposureBeta < 0
    ? { ...row, exposureBeta: -row.exposureBeta, outcomeBeta: -row.outcomeBeta }
    : row));

  const weights = rows.map((row) => 1 / row.outcomeSe ** 2);
  const sumWeighted = rows.reduce((sum, row, i) => sum + weights[i] * row.exposureBeta * row.outcomeBeta, 0);
  const sumSquares = rows.reduce((sum, row, i) => sum + weights[i] * row.exposureBeta ** 2, 0);
  if (!(sumSquares > 0)) {
    throw new Error('Every instrument has an effect of zero on the exposure, so there is nothing to divide the outcome effect by. Check the column holding the effect on the exposure.');
  }
  const ivw = sumWeighted / sumSquares;
  const ivwSe = Math.sqrt(1 / sumSquares);

  // Heterogeneity across instruments. A large Q means they disagree about the
  // causal effect, which is what pleiotropy looks like.
  const q = rows.reduce(
    (sum, row, i) => sum + weights[i] * (row.outcomeBeta - ivw * row.exposureBeta) ** 2, 0);
  const qDf = rows.length - 1;

  // MR-Egger: the same weighted regression, but with a free intercept.
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const meanX = rows.reduce((sum, row, i) => sum + weights[i] * row.exposureBeta, 0) / totalWeight;
  const meanY = rows.reduce((sum, row, i) => sum + weights[i] * row.outcomeBeta, 0) / totalWeight;
  const sxx = rows.reduce((sum, row, i) => sum + weights[i] * (row.exposureBeta - meanX) ** 2, 0);
  const sxy = rows.reduce(
    (sum, row, i) => sum + weights[i] * (row.exposureBeta - meanX) * (row.outcomeBeta - meanY), 0);
  if (!(sxx > 0)) {
    throw new Error('Every instrument has the same effect on the exposure, so MR-Egger cannot tell a slope from an intercept. The column holding the effect on the exposure needs to vary.');
  }
  const eggerSlope = sxy / sxx;
  const eggerIntercept = meanY - eggerSlope * meanX;
  const eggerResidual = rows.reduce(
    (sum, row, i) => sum + weights[i] * (row.outcomeBeta - eggerIntercept - eggerSlope * row.exposureBeta) ** 2, 0);
  const eggerSigma = Math.sqrt(eggerResidual / (rows.length - 2));
  const eggerSlopeSe = eggerSigma / Math.sqrt(sxx);
  const eggerInterceptSe = eggerSigma * Math.sqrt(1 / totalWeight + (meanX * meanX) / sxx);

  // Weighted median of the per-instrument ratio estimates.
  const ratios = rows
    .map((row, i) => ({ ratio: row.outcomeBeta / row.exposureBeta, weight: weights[i] * row.exposureBeta ** 2 }))
    .sort((a, b) => a.ratio - b.ratio);
  const ratioTotal = ratios.reduce((sum, entry) => sum + entry.weight, 0);
  let running = 0;
  let median = ratios[ratios.length - 1].ratio;
  for (let i = 0; i < ratios.length; i += 1) {
    const before = running / ratioTotal;
    running += ratios[i].weight;
    const after = running / ratioTotal;
    if (after >= 0.5) {
      median = ratios[i].ratio + (ratios[i + 1] ? (ratios[i + 1].ratio - ratios[i].ratio) * (0.5 - before) / (after - before) : 0);
      break;
    }
  }

  const wald = (estimate, se) => 2 * (1 - normalCdf(Math.abs(estimate / se)));

  return {
    instruments: rows.length,
    ivw: { estimate: ivw, standardError: ivwSe, pValue: wald(ivw, ivwSe),
      confidenceInterval95: [ivw - 1.96 * ivwSe, ivw + 1.96 * ivwSe] },
    egger: {
      slope: eggerSlope, slopeSe: eggerSlopeSe, slopePValue: tTail(eggerSlope / eggerSlopeSe, rows.length - 2),
      intercept: eggerIntercept, interceptSe: eggerInterceptSe,
      interceptPValue: tTail(eggerIntercept / eggerInterceptSe, rows.length - 2),
    },
    weightedMedian: median,
    heterogeneity: { q, df: qDf, pValue: chiSquareTail(q, qDf),
      iSquared: Math.max(0, (q - qDf) / q) },
  };
}

/**
 * Simon's two-stage design for a single-arm phase II trial.
 *
 * Enumerates every (r1, n1, r, n) meeting the type I and type II error
 * constraints and returns the optimal design, which minimises the expected
 * sample size under the null, and the minimax design, which minimises the
 * maximum sample size.
 */
export function simonTwoStage(p0, p1, alpha = 0.05, beta = 0.2, maxN = 100) {
  if (!(p1 > p0)) throw new Error('The response rate worth pursuing must be higher than the one not worth pursuing.');
  if (!(p0 > 0 && p1 < 1)) throw new Error('Both response rates must be between 0 and 1.');

  const logFactorial = [0];
  for (let i = 1; i <= maxN + 1; i += 1) logFactorial[i] = logFactorial[i - 1] + Math.log(i);
  const pmf = (k, n, p) => Math.exp(logFactorial[n] - logFactorial[k] - logFactorial[n - k]
    + k * Math.log(p) + (n - k) * Math.log(1 - p));

  // Binomial mass and cumulative for every n up to the largest considered,
  // computed once: the search evaluates them millions of times otherwise.
  const table = (p) => {
    const mass = [];
    const cumulative = [];
    for (let n = 0; n <= maxN; n += 1) {
      mass[n] = Array.from({ length: n + 1 }, (_, k) => pmf(k, n, p));
      cumulative[n] = [];
      let running = 0;
      for (let k = 0; k <= n; k += 1) {
        running += mass[n][k];
        cumulative[n][k] = Math.min(1, running);
      }
    }
    return { mass, cumulative };
  };

  const under = [table(p0), table(p1)];
  const atMost = (which, k, n) => (k < 0 ? 0 : under[which].cumulative[n][Math.min(k, n)]);

  /** Chance the drug is abandoned: stop at stage one, or too few responses overall. */
  const abandon = (which, r1, n1, r, n) => {
    let total = atMost(which, r1, n1);
    const stage2 = n - n1;
    for (let x = r1 + 1; x <= Math.min(n1, r); x += 1) {
      total += under[which].mass[n1][x] * atMost(which, r - x, stage2);
    }
    return Math.min(1, total);
  };

  let optimal = null;
  let minimax = null;

  for (let n = 2; n <= maxN; n += 1) {
    for (let n1 = 1; n1 < n; n1 += 1) {
      for (let r1 = 0; r1 < n1; r1 += 1) {
        // Stopping early must not itself cost more than the whole type II
        // budget; raising r1 only makes that worse.
        if (atMost(1, r1, n1) > beta) break;

        // Both the size and the power fall as r rises, so the first r that
        // controls the size is also the one with the most power.
        for (let r = r1; r < n; r += 1) {
          const size = 1 - abandon(0, r1, n1, r, n);
          if (size > alpha) continue;
          const power = 1 - abandon(1, r1, n1, r, n);
          if (power < 1 - beta) break;

          const probabilityEarlyStop = atMost(0, r1, n1);
          const expectedN = n1 + (1 - probabilityEarlyStop) * (n - n1);
          const design = { r1, n1, r, n, expectedN, probabilityEarlyStop, alpha: size, power };
          if (!optimal || expectedN < optimal.expectedN - 1e-9) optimal = design;
          if (!minimax || n < minimax.n || (n === minimax.n && expectedN < minimax.expectedN - 1e-9)) minimax = design;
          break;
        }
      }
    }
  }

  if (!optimal) {
    throw new Error(`No design of up to ${maxN} patients meets those error rates. Widen the gap between the two response rates, or accept a larger alpha.`);
  }
  return { p0, p1, alpha, beta, optimal, minimax };
}

/**
 * ROUT outlier identification (Motulsky and Brown, 2006).
 *
 * Fits robustly by minimising a Lorentzian merit function, which gives extreme
 * points almost no influence, then treats the robust residuals as a hypothesis
 * test and controls the false discovery rate. Unlike Grubbs it can flag several
 * outliers at once without masking, and unlike a plain 2-SD rule it does not
 * scale the threshold with the outliers themselves.
 *
 * `q` is the maximum false discovery rate, not a significance level: at the
 * usual 1 per cent, roughly one in a hundred flagged points is expected to be
 * a false alarm.
 */
export function routOutliers(values, { q = 0.01 } = {}) {
  const n = values.length;
  if (n < 4) throw new Error(`ROUT needs at least four values; ${n} were given.`);

  const sorted = values.slice().sort((a, b) => a - b);
  let centre = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  // Iteratively reweighted fit of a constant under a Lorentzian merit, with
  // the scale re-estimated each pass from the robust spread.
  let scale = medianAbsoluteDeviation(values, centre) * 1.4826 || 1e-12;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const weights = values.map((value) => 1 / (1 + ((value - centre) / scale) ** 2 / 2));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const next = values.reduce((sum, value, i) => sum + weights[i] * value, 0) / total;
    const nextScale = Math.max(medianAbsoluteDeviation(values, next) * 1.4826, 1e-12);
    const moved = Math.abs(next - centre) + Math.abs(nextScale - scale);
    centre = next;
    scale = nextScale;
    if (moved < 1e-12) break;
  }

  const residuals = values.map((value) => value - centre);
  // Robust standard deviation of the residuals: the 68.27th percentile of the
  // absolute residuals, adjusted for the parameter the fit used up.
  const absolute = residuals.map(Math.abs).sort((a, b) => a - b);
  const percentileIndex = 0.6827 * (n - 1);
  const low = Math.floor(percentileIndex);
  const high = Math.min(low + 1, n - 1);
  const percentile = absolute[low] + (absolute[high] - absolute[low]) * (percentileIndex - low);
  const rsdr = percentile * n / Math.max(n - 1, 1);

  if (!(rsdr > 0)) {
    return { values, centre, robustScale: rsdr, q, outliers: [], flagged: 0 };
  }

  const df = Math.max(n - 1, 1);
  const candidates = residuals
    .map((residual, index) => ({
      index,
      value: values[index],
      residual,
      t: Math.abs(residual) / rsdr,
    }))
    .map((entry) => ({ ...entry, pValue: tTail(entry.t, df) }))
    .sort((a, b) => a.pValue - b.pValue);

  // Benjamini-Hochberg, walked from the largest residual down: everything up to
  // the last index that clears its threshold is flagged.
  let lastFlagged = -1;
  for (let i = 0; i < candidates.length; i += 1) {
    if (candidates[i].pValue < ((i + 1) * q) / n) lastFlagged = i;
  }
  const outliers = candidates.slice(0, lastFlagged + 1).sort((a, b) => a.index - b.index);

  return {
    n,
    centre,
    robustScale: rsdr,
    q,
    outliers,
    flagged: outliers.length,
    kept: values.filter((_, index) => !outliers.some((entry) => entry.index === index)),
  };
}

function medianAbsoluteDeviation(values, centre) {
  const deviations = values.map((value) => Math.abs(value - centre)).sort((a, b) => a - b);
  const mid = deviations.length / 2;
  return deviations.length % 2 ? deviations[Math.floor(mid)] : (deviations[mid - 1] + deviations[mid]) / 2;
}

/**
 * GEE with an exchangeable working correlation.
 *
 * Different question from a mixed model: coefficients are population-average,
 * not within-subject. Sandwich standard errors, so they hold up even when the
 * assumed correlation is wrong.
 */
export function gee(predictors, response, clusters, options = {}) {
  const { family = 'gaussian', iterations = 50, tolerance = 1e-10 } = options;
  const names = options.names ?? [];
  const n = response.length;
  const p = predictors.length + 1;
  if (predictors.some((column) => column.length !== n) || clusters.length !== n) {
    throw new Error('Every observation needs a response, a cluster and one value per predictor.');
  }
  const clusterNames = [...new Set(clusters)];
  if (clusterNames.length < 2) throw new Error('GEE needs at least two clusters.');
  if (n <= p) throw new Error(`Too few observations: ${n} rows cannot fit ${p} parameters.`);

  const link = {
    gaussian: { mean: (eta) => eta, derivative: () => 1, variance: () => 1 },
    binomial: {
      mean: (eta) => 1 / (1 + Math.exp(-eta)),
      derivative: (mu) => mu * (1 - mu),
      variance: (mu) => mu * (1 - mu),
    },
    poisson: { mean: (eta) => Math.exp(eta), derivative: (mu) => mu, variance: (mu) => mu },
  }[family];
  if (!link) throw new Error(`Unknown family "${family}".`);

  const design = Array.from({ length: n }, (_, i) => [1, ...predictors.map((column) => column[i])]);
  const blocks = clusterNames.map((name) => {
    const rows = [];
    for (let i = 0; i < n; i += 1) if (clusters[i] === name) rows.push(i);
    return rows;
  });

  let beta = new Array(p).fill(0);
  if (family === 'gaussian') beta[0] = response.reduce((sum, value) => sum + value, 0) / n;
  let alpha = 0;
  let dispersion = 1;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const eta = design.map((row) => row.reduce((sum, value, j) => sum + value * beta[j], 0));
    const mu = eta.map(link.mean);
    const pearson = response.map((value, i) => (value - mu[i]) / Math.sqrt(link.variance(mu[i])));

    // n, not n - p: geepack's convention, and what the working correlation
    // below is defined against. The sandwich cancels it either way.
    dispersion = pearson.reduce((sum, value) => sum + value * value, 0) / n;

    // Exchangeable correlation, estimated from the within-cluster products.
    let pairs = 0;
    let total = 0;
    for (const rows of blocks) {
      for (let a = 0; a < rows.length - 1; a += 1) {
        for (let b = a + 1; b < rows.length; b += 1) {
          total += pearson[rows[a]] * pearson[rows[b]];
          pairs += 1;
        }
      }
    }
    alpha = pairs ? total / (pairs * dispersion) : 0;
    // The exchangeable matrix stops being positive definite outside this
    // range, so the estimate is held just inside it.
    const largest = Math.max(...blocks.map((rows) => rows.length));
    const floor = -0.999 / Math.max(1, largest - 1);
    alpha = Math.max(floor, Math.min(0.999, alpha));

    const information = Array.from({ length: p }, () => new Array(p).fill(0));
    const score = new Array(p).fill(0);

    for (const rows of blocks) {
      const size = rows.length;
      // (1 - a)I + a J has the inverse below, so no working matrix is formed.
      const scaleDiagonal = 1 / (1 - alpha);
      const scaleOff = -alpha / ((1 - alpha) * (1 + (size - 1) * alpha));

      const d = rows.map((i) => design[i].map((value) => value * link.derivative(mu[i])));
      const sd = rows.map((i) => Math.sqrt(link.variance(mu[i])));
      const residual = rows.map((i) => (response[i] - mu[i]));

      for (let a = 0; a < size; a += 1) {
        for (let b = 0; b < size; b += 1) {
          const weight = ((a === b ? scaleDiagonal + scaleOff : scaleOff) / (sd[a] * sd[b])) / dispersion;
          for (let u = 0; u < p; u += 1) {
            score[u] += d[a][u] * weight * residual[b];
            for (let v = 0; v < p; v += 1) information[u][v] += d[a][u] * weight * d[b][v];
          }
        }
      }
    }

    const step = choleskySolve(information, score);
    if (!step) throw new Error('The model is singular: check for a predictor that is constant or duplicated.');
    beta = beta.map((value, j) => value + step[j]);
    if (Math.hypot(...step) < tolerance) break;
  }

  // Sandwich variance: the model-based information, with the empirical
  // variability of the score in the middle.
  const eta = design.map((row) => row.reduce((sum, value, j) => sum + value * beta[j], 0));
  const mu = eta.map(link.mean);
  const bread = Array.from({ length: p }, () => new Array(p).fill(0));
  const meat = Array.from({ length: p }, () => new Array(p).fill(0));

  for (const rows of blocks) {
    const size = rows.length;
    const scaleDiagonal = 1 / (1 - alpha);
    const scaleOff = -alpha / ((1 - alpha) * (1 + (size - 1) * alpha));
    const d = rows.map((i) => design[i].map((value) => value * link.derivative(mu[i])));
    const sd = rows.map((i) => Math.sqrt(link.variance(mu[i])));
    const residual = rows.map((i) => response[i] - mu[i]);

    const contribution = new Array(p).fill(0);
    for (let a = 0; a < size; a += 1) {
      for (let b = 0; b < size; b += 1) {
        const weight = ((a === b ? scaleDiagonal + scaleOff : scaleOff) / (sd[a] * sd[b])) / dispersion;
        for (let u = 0; u < p; u += 1) {
          contribution[u] += d[a][u] * weight * residual[b];
          for (let v = 0; v < p; v += 1) bread[u][v] += d[a][u] * weight * d[b][v];
        }
      }
    }
    for (let u = 0; u < p; u += 1) {
      for (let v = 0; v < p; v += 1) meat[u][v] += contribution[u] * contribution[v];
    }
  }

  const inverseBread = invertSymmetric(bread);
  if (!inverseBread) throw new Error('The model is singular and its standard errors cannot be found.');
  const covariance = Array.from({ length: p }, (_, u) =>
    Array.from({ length: p }, (_, v) =>
      inverseBread[u].reduce((sum, value, a) =>
        sum + value * meat[a].reduce((inner, entry, b) => inner + entry * inverseBread[b][v], 0), 0)));

  const label = (index) => (index === 0 ? '(Intercept)' : names[index - 1] ?? `x${index}`);
  return {
    n,
    clusters: clusterNames.length,
    family,
    workingCorrelation: alpha,
    dispersion,
    terms: beta.map((estimate, index) => {
      const se = Math.sqrt(covariance[index][index]);
      const z = estimate / se;
      return {
        term: label(index),
        estimate,
        standardError: se,
        z,
        pValue: 2 * (1 - normalCdf(Math.abs(z))),
        confidenceInterval95: [estimate - 1.96 * se, estimate + 1.96 * se],
      };
    }),
  };
}
