// Dose-response fitting: parameter intervals, and a test between two fits.
//
// An EC50 without an interval is half an answer. Six scattered points can put
// it anywhere across a log unit, which four printed figures hide completely.
//
// Levenberg-Marquardt on the natural parameterisation, so the covariance comes
// out in the units the parameters are reported in.

import { studentTCdf, studentTQuantile } from './stats.js';
import { choleskySolve, invertSymmetric } from './regression.js';

/** Bottom + (Top - Bottom) / (1 + (EC50/x)^Hill). */
function response(parameters, x) {
  const [bottom, top, ec50, hill] = parameters;
  return bottom + (top - bottom) / (1 + (ec50 / x) ** hill);
}

// Analytic, not differenced: a numerical Jacobian loses half the digits, and
// those digits are the standard errors.
function gradient(parameters, x) {
  const [bottom, top, ec50, hill] = parameters;
  const ratio = ec50 / x;
  const d = ratio ** hill;
  const denominator = 1 + d;
  const span = top - bottom;

  return [
    d / denominator,
    1 / denominator,
    (-span * hill * d) / (ec50 * denominator * denominator),
    (-span * d * Math.log(ratio)) / (denominator * denominator),
  ];
}

const sumSquares = (parameters, x, y) =>
  y.reduce((sum, value, i) => sum + (value - response(parameters, x[i])) ** 2, 0);

/** Damping rises only on a failed step, which keeps it on a flat plateau. */
function levenbergMarquardt(start, x, y, fixed = {}, iterations = 400) {
  const free = [0, 1, 2, 3].filter((index) => !(index in fixed));
  let parameters = start.slice();
  for (const [index, value] of Object.entries(fixed)) parameters[Number(index)] = value;

  let residual = sumSquares(parameters, x, y);
  let damping = 1e-3;

  for (let step = 0; step < iterations; step += 1) {
    const size = free.length;
    const normal = Array.from({ length: size }, () => new Array(size).fill(0));
    const projected = new Array(size).fill(0);

    for (let i = 0; i < x.length; i += 1) {
      const all = gradient(parameters, x[i]);
      const error = y[i] - response(parameters, x[i]);
      for (let a = 0; a < size; a += 1) {
        projected[a] += all[free[a]] * error;
        for (let b = a; b < size; b += 1) normal[a][b] += all[free[a]] * all[free[b]];
      }
    }
    for (let a = 0; a < size; a += 1) for (let b = 0; b < a; b += 1) normal[a][b] = normal[b][a];

    let accepted = false;
    for (let attempt = 0; attempt < 40 && !accepted; attempt += 1) {
      const damped = normal.map((row, a) =>
        row.map((value, b) => (a === b ? value * (1 + damping) : value)));
      const delta = choleskySolve(damped, projected);
      if (!delta) { damping *= 10; continue; }

      const candidate = parameters.slice();
      free.forEach((index, a) => { candidate[index] += delta[a]; });
      // EC50 and the Hill slope are positive by construction; a step that
      // takes them negative is a step out of the model, not a better fit.
      if (!(candidate[2] > 0) || !(candidate[3] > 0)) { damping *= 10; continue; }

      const score = sumSquares(candidate, x, y);
      if (score < residual) {
        const improvement = residual - score;
        parameters = candidate;
        residual = score;
        damping = Math.max(damping / 10, 1e-12);
        accepted = true;
        if (improvement < 1e-14 * (1 + residual)) return { parameters, residual, converged: true };
      } else {
        damping *= 10;
      }
    }
    if (!accepted) break;
  }

  // Levenberg-Marquardt stops as soon as no damped step improves the residual,
  // which on a flat optimum can be a little short of it. Undamped Gauss-Newton
  // converges quadratically from there, so a few steps land on the same point
  // another implementation would report rather than merely near it.
  for (let polish = 0; polish < 12; polish += 1) {
    const size = free.length;
    const normal = Array.from({ length: size }, () => new Array(size).fill(0));
    const projected = new Array(size).fill(0);

    for (let i = 0; i < x.length; i += 1) {
      const all = gradient(parameters, x[i]);
      const error = y[i] - response(parameters, x[i]);
      for (let a = 0; a < size; a += 1) {
        projected[a] += all[free[a]] * error;
        for (let b = a; b < size; b += 1) normal[a][b] += all[free[a]] * all[free[b]];
      }
    }
    for (let a = 0; a < size; a += 1) for (let b = 0; b < a; b += 1) normal[a][b] = normal[b][a];

    const delta = choleskySolve(normal, projected);
    if (!delta) break;

    const candidate = parameters.slice();
    free.forEach((index, a) => { candidate[index] += delta[a]; });
    if (!(candidate[2] > 0) || !(candidate[3] > 0)) break;

    const score = sumSquares(candidate, x, y);
    if (!Number.isFinite(score) || score > residual * (1 + 1e-12)) break;

    const moved = Math.max(...free.map((index, a) =>
      Math.abs(delta[a]) / (Math.abs(parameters[index]) + 1e-12)));
    parameters = candidate;
    residual = score;
    if (moved < 1e-13) break;
  }

  return { parameters, residual, converged: true };
}

/** A starting point good enough for LM to find the optimum from. */
function initialGuess(x, y) {
  const low = Math.min(...y);
  const high = Math.max(...y);
  const sorted = [...x].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];

  // Rising or falling: which end of the x range the high responses sit at.
  const first = y.slice(0, Math.ceil(y.length / 2));
  const last = y.slice(Math.floor(y.length / 2));
  const rising = last.reduce((s, v) => s + v, 0) / last.length
    >= first.reduce((s, v) => s + v, 0) / first.length;

  return [rising ? low : high, rising ? high : low, middle, 1];
}

const NAMES = ['bottom', 'top', 'ec50', 'hillSlope'];

/**
 * Fits the curve and reports each parameter with its interval.
 *
 * `fixed` pins a parameter instead of estimating it. `{ 3: 1 }` gives the
 * three-parameter model, the usual thing to compare a four-parameter fit to.
 *
 * Intervals are Wald: estimate plus or minus t times the standard error, from
 * the covariance at the optimum. Where the curve is poorly determined they are
 * optimistic; a profile-likelihood interval would be wider and asymmetric,
 * and the result says so when the fit looks that way.
 */
export function fitDoseResponse(xValues, yValues, { fixed = {}, level = 0.95 } = {}) {
  const pairs = xValues
    .map((value, i) => [Number(value), Number(yValues[i])])
    .filter((pair) => pair.every(Number.isFinite) && pair[0] > 0);

  const parameterCount = 4 - Object.keys(fixed).length;
  if (pairs.length < parameterCount + 1) {
    throw new Error(
      `A ${parameterCount}-parameter curve needs more than ${parameterCount} concentrations; ${pairs.length} usable point(s) were given.`
    );
  }

  const x = pairs.map((pair) => pair[0]);
  const y = pairs.map((pair) => pair[1]);
  const n = pairs.length;

  const fit = levenbergMarquardt(initialGuess(x, y), x, y, fixed);
  const parameters = fit.parameters;
  const residualDf = n - parameterCount;
  const variance = residualDf > 0 ? fit.residual / residualDf : NaN;

  // Covariance of the free parameters only: a fixed one has no error, and
  // including it makes the normal matrix singular.
  const free = [0, 1, 2, 3].filter((index) => !(index in fixed));
  const normal = Array.from({ length: free.length }, () => new Array(free.length).fill(0));
  for (let i = 0; i < n; i += 1) {
    const all = gradient(parameters, x[i]);
    for (let a = 0; a < free.length; a += 1) {
      for (let b = a; b < free.length; b += 1) normal[a][b] += all[free[a]] * all[free[b]];
    }
  }
  for (let a = 0; a < free.length; a += 1) for (let b = 0; b < a; b += 1) normal[a][b] = normal[b][a];

  const inverse = invertSymmetric(normal);
  const t = residualDf > 0 ? studentTQuantile(1 - (1 - level) / 2, residualDf) : NaN;

  const terms = NAMES.map((name, index) => {
    const estimate = parameters[index];
    if (index in fixed) {
      return { name, estimate, standardError: null, confidenceInterval: null, pValue: null, fixed: true };
    }
    const at = free.indexOf(index);
    const standardError = inverse ? Math.sqrt(Math.max(variance * inverse[at][at], 0)) : NaN;
    const statistic = estimate / standardError;
    return {
      name,
      estimate,
      standardError,
      confidenceInterval: Number.isFinite(standardError)
        ? [estimate - t * standardError, estimate + t * standardError]
        : null,
      // Against zero, as nls reports. Rarely the question for EC50 or the Hill
      // slope, so it stays off screen.
      pValue: Number.isFinite(statistic) ? 2 * (1 - studentTCdf(Math.abs(statistic), residualDf)) : null,
      fixed: false,
    };
  });

  const mean = y.reduce((sum, value) => sum + value, 0) / n;
  const total = y.reduce((sum, value) => sum + (value - mean) ** 2, 0);

  const ec50 = terms[2];
  // An interval below zero, or spanning two orders of magnitude, means these
  // concentrations did not locate the EC50.
  const interval = ec50.confidenceInterval;
  const poorlyDetermined = !interval || interval[0] <= 0 || interval[1] / Math.max(interval[0], 1e-300) > 100;

  return {
    method: `${parameterCount}-parameter logistic dose–response fit`,
    n,
    parameterCount,
    residualDf,
    bottom: parameters[0],
    top: parameters[1],
    ec50: parameters[2],
    hillSlope: parameters[3],
    terms,
    residualSumSquares: fit.residual,
    r2: total ? 1 - fit.residual / total : NaN,
    rmse: Math.sqrt(fit.residual / n),
    sigma: Math.sqrt(variance),
    aicc: akaike(n, fit.residual, parameterCount + 1),
    converged: fit.converged,
    covariance: inverse ? inverse.map((row) => row.map((value) => value * variance)) : null,
    poorlyDetermined,
    predictions: x.map((value) => response(parameters, value)),
    model: (value) => response(parameters, value),
    x,
    y,
  };
}

/**
 * AICc: Akaike's criterion with the small-sample correction. Dose-response
 * curves are usually fitted to eight or ten points, which is exactly where the
 * uncorrected version prefers models that are too complicated.
 *
 * `k` counts the variance as a parameter, as R's AIC does for a Gaussian fit.
 */
export function akaike(n, residualSumSquares, k) {
  const aic = n * Math.log(residualSumSquares / n) + 2 * k + n * (1 + Math.log(2 * Math.PI));
  const penalty = n - k - 1 > 0 ? (2 * k * (k + 1)) / (n - k - 1) : Infinity;
  return aic + penalty;
}

/**
 * Extra sum-of-squares F test between nested fits.
 *
 * The question it answers is whether the extra parameters earned their place:
 * a fit with more of them always has a smaller residual, so "it fits better"
 * is not evidence of anything on its own.
 */
export function compareFits(simpler, richer) {
  const dfSimple = simpler.residualDf;
  const dfRich = richer.residualDf;
  if (!(dfSimple > dfRich)) {
    throw new Error('The first fit must be the simpler one: it needs more residual degrees of freedom than the second.');
  }
  if (!(richer.residualSumSquares > 0)) {
    throw new Error('The richer fit passes exactly through every point, so there is nothing left to test.');
  }

  const numeratorDf = dfSimple - dfRich;
  const f =
    ((simpler.residualSumSquares - richer.residualSumSquares) / numeratorDf) /
    (richer.residualSumSquares / dfRich);

  return {
    fStatistic: f,
    numeratorDf,
    denominatorDf: dfRich,
    pValue: fTail(f, numeratorDf, dfRich),
    aiccSimpler: simpler.aicc,
    aiccRicher: richer.aicc,
    /** The difference in AICc, positive when the simpler model is preferred. */
    aiccDifference: simpler.aicc - richer.aicc,
  };
}

/** F tail via the squared-t identity when it applies, and the beta otherwise. */
function fTail(f, df1, df2) {
  if (!(f > 0)) return 1;
  if (df1 === 1) return 2 * (1 - studentTCdf(Math.sqrt(f), df2));
  return incompleteBeta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}

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

/**
 * Fits every dataset separately, then again with one EC50 shared between them,
 * and tests whether the shared fit is good enough. This is the question behind
 * "is the curve shifted?". A potency comparison, not a comparison of means.
 */
export function compareEc50(datasets) {
  if (datasets.length < 2) throw new Error('Comparing potencies needs at least two curves.');

  const separate = datasets.map((set) => fitDoseResponse(set.x, set.y));
  const separateRss = separate.reduce((sum, fit) => sum + fit.residualSumSquares, 0);
  const separateDf = separate.reduce((sum, fit) => sum + fit.residualDf, 0);

  // One EC50 for all of them, every other parameter still per-curve. Searched
  // over the shared value, with the rest refitted at each step: a
  // one-dimensional search is enough and cannot diverge.
  const candidates = separate.map((fit) => fit.ec50).sort((a, b) => a - b);
  const lowest = Math.log(candidates[0]) - 1;
  const highest = Math.log(candidates[candidates.length - 1]) + 1;

  const atShared = (logEc50) => {
    const shared = Math.exp(logEc50);
    let total = 0;
    for (const set of datasets) {
      total += fitDoseResponse(set.x, set.y, { fixed: { 2: shared } }).residualSumSquares;
    }
    return total;
  };

  const phi = (Math.sqrt(5) - 1) / 2;
  let low = lowest;
  let high = highest;
  let c = high - phi * (high - low);
  let d = low + phi * (high - low);
  let fc = atShared(c);
  let fd = atShared(d);
  for (let i = 0; i < 80 && high - low > 1e-8; i += 1) {
    if (fc < fd) { high = d; d = c; fd = fc; c = high - phi * (high - low); fc = atShared(c); }
    else { low = c; c = d; fc = fd; d = low + phi * (high - low); fd = atShared(d); }
  }
  const sharedEc50 = Math.exp((low + high) / 2);

  const sharedFits = datasets.map((set) =>
    fitDoseResponse(set.x, set.y, { fixed: { 2: sharedEc50 } }));
  const sharedRss = sharedFits.reduce((sum, fit) => sum + fit.residualSumSquares, 0);
  // One shared EC50 replaces one per curve, and costs one parameter overall.
  const sharedDf = separateDf + datasets.length - 1;

  const numeratorDf = sharedDf - separateDf;
  const f = ((sharedRss - separateRss) / numeratorDf) / (separateRss / separateDf);

  return {
    separate,
    sharedEc50,
    sharedResidualSumSquares: sharedRss,
    separateResidualSumSquares: separateRss,
    fStatistic: f,
    numeratorDf,
    denominatorDf: separateDf,
    pValue: fTail(f, numeratorDf, separateDf),
    ratios: separate.slice(1).map((fit, index) => ({
      label: `${datasets[index + 1].name ?? `Curve ${index + 2}`} vs ${datasets[0].name ?? 'Curve 1'}`,
      ratio: fit.ec50 / separate[0].ec50,
    })),
  };
}
