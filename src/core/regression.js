// Regression models: linear with covariates, the generalised linear family,
// and Cox proportional hazards. Checked against R in validation/.

import { mean, clean, studentTCdf } from './stats.js';
import { normalCdf, chiSquareUpperTail } from './diagnostics.js';

// ---------------------------------------------------------------------------
// linear algebra
// ---------------------------------------------------------------------------

/** Solves a symmetric positive-definite system by Cholesky decomposition. */
function choleskySolve(matrix, vector) {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => new Float64Array(n));

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (sum <= 0) return null;
        lower[i][j] = Math.sqrt(sum);
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }

  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = vector[i];
    for (let k = 0; k < i; k += 1) sum -= lower[i][k] * y[k];
    y[i] = sum / lower[i][i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = y[i];
    for (let k = i + 1; k < n; k += 1) sum -= lower[k][i] * x[k];
    x[i] = sum / lower[i][i];
  }
  return x;
}

/** Inverse of a symmetric positive-definite matrix, for the covariance. */
function invertSymmetric(matrix) {
  const n = matrix.length;
  const inverse = Array.from({ length: n }, () => new Float64Array(n));
  for (let column = 0; column < n; column += 1) {
    const unit = new Float64Array(n);
    unit[column] = 1;
    const solved = choleskySolve(matrix, unit);
    if (!solved) return null;
    for (let row = 0; row < n; row += 1) inverse[row][column] = solved[row];
  }
  return inverse;
}

const transposeTimes = (design, weights, other) => {
  const p = design[0].length;
  const result = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < design.length; i += 1) {
    const w = weights ? weights[i] : 1;
    if (!w) continue;
    for (let a = 0; a < p; a += 1) {
      for (let b = 0; b <= a; b += 1) {
        result[a][b] += w * design[i][a] * design[i][b];
      }
    }
  }
  for (let a = 0; a < p; a += 1) for (let b = a + 1; b < p; b += 1) result[a][b] = result[b][a];
  void other;
  return result;
};

// ---------------------------------------------------------------------------
// generalised linear models
// ---------------------------------------------------------------------------

const FAMILIES = {
  binomial: {
    name: 'logistic regression',
    link: 'logit',
    linkName: 'log odds',
    mean: (eta) => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, eta)))),
    variance: (mu) => Math.max(1e-10, mu * (1 - mu)),
    derivative: (mu) => 1 / Math.max(1e-10, mu * (1 - mu)),
    start: (y) => Math.log((y + 0.5) / (1.5 - y)),
    deviance: (y, mu) => {
      const a = y > 0 ? y * Math.log(y / mu) : 0;
      const b = y < 1 ? (1 - y) * Math.log((1 - y) / (1 - mu)) : 0;
      return 2 * (a + b);
    },
  },
  poisson: {
    name: 'Poisson regression',
    link: 'log',
    linkName: 'log count',
    mean: (eta) => Math.exp(Math.max(-500, Math.min(500, eta))),
    variance: (mu) => Math.max(1e-10, mu),
    derivative: (mu) => 1 / Math.max(1e-10, mu),
    start: (y) => Math.log(y + 0.1),
    deviance: (y, mu) => 2 * ((y > 0 ? y * Math.log(y / mu) : 0) - (y - mu)),
  },
};

/**
 * Iteratively reweighted least squares, which is how R's glm fits these.
 * Returns coefficients, their standard errors, and the deviances needed for
 * the likelihood-ratio test against the intercept-only model.
 */
function fitGlm(design, response, family, { offset = null, maxIterations = 60, tolerance = 1e-11 } = {}) {
  const n = design.length;
  const p = design[0].length;
  let beta = new Float64Array(p);

  // Start from the link of a lightly shrunk response, as glm does.
  let eta = response.map((y) => family.start(y));
  if (offset) eta = eta.map((value, i) => value + offset[i]);
  let deviance = Infinity;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const mu = eta.map(family.mean);
    const weights = new Float64Array(n);
    const working = new Float64Array(n);

    for (let i = 0; i < n; i += 1) {
      const variance = family.variance(mu[i]);
      const derivative = family.derivative(mu[i]);
      weights[i] = 1 / Math.max(1e-12, derivative * derivative * variance);
      working[i] = eta[i] - (offset ? offset[i] : 0) + (response[i] - mu[i]) * derivative;
    }

    const information = transposeTimes(design, weights);
    const score = new Float64Array(p);
    for (let i = 0; i < n; i += 1) {
      for (let a = 0; a < p; a += 1) score[a] += weights[i] * design[i][a] * working[i];
    }

    const solved = choleskySolve(information, score);
    if (!solved) {
      throw new Error('The model could not be fitted: two or more predictors carry the same information, or a group is perfectly separated.');
    }
    beta = solved;

    eta = design.map((row, i) => {
      let sum = offset ? offset[i] : 0;
      for (let a = 0; a < p; a += 1) sum += row[a] * beta[a];
      return sum;
    });

    const next = eta.reduce((sum, value, i) => sum + family.deviance(response[i], family.mean(value)), 0);
    if (Math.abs(next - deviance) < tolerance * (Math.abs(next) + 0.1)) {
      deviance = next;
      break;
    }
    deviance = next;
  }

  const mu = eta.map(family.mean);
  const weights = mu.map((value) => {
    const variance = family.variance(value);
    const derivative = family.derivative(value);
    return 1 / Math.max(1e-12, derivative * derivative * variance);
  });
  const covariance = invertSymmetric(transposeTimes(design, weights));
  if (!covariance) throw new Error('The model is singular: check for a predictor that is constant or duplicated.');

  return {
    beta: Array.from(beta),
    standardErrors: Array.from({ length: p }, (_, a) => Math.sqrt(Math.max(0, covariance[a][a]))),
    covariance,
    fitted: mu,
    deviance,
  };
}

/** Builds the design matrix, with an intercept column first. */
function buildDesign(predictors, n) {
  return Array.from({ length: n }, (_, i) => [1, ...predictors.map((column) => column[i])]);
}

function summarise(fit, names, family, response, n) {
  const nullMean = mean(response);
  const nullDeviance = response.reduce((sum, y) => sum + family.deviance(y, nullMean), 0);
  const df = names.length; // predictors, excluding the intercept
  const likelihoodRatio = nullDeviance - fit.deviance;

  const terms = names.map((name, index) => {
    const estimate = fit.beta[index];
    const standardError = fit.standardErrors[index];
    const z = estimate / standardError;
    return {
      term: name,
      estimate,
      standardError,
      z,
      pValue: 2 * (1 - normalCdf(Math.abs(z))),
      confidenceInterval95: [estimate - 1.96 * standardError, estimate + 1.96 * standardError],
      // Exponentiated: an odds ratio for logistic, a rate ratio for Poisson.
      ratio: Math.exp(estimate),
      ratioConfidenceInterval95: [
        Math.exp(estimate - 1.96 * standardError),
        Math.exp(estimate + 1.96 * standardError),
      ],
    };
  });

  return {
    method: family.name[0].toUpperCase() + family.name.slice(1),
    link: family.link,
    n,
    terms,
    deviance: fit.deviance,
    nullDeviance,
    df,
    aic: fit.deviance + 2 * names.length,
    statistic: likelihoodRatio,
    statisticName: 'likelihood-ratio χ²',
    pValue: chiSquareUpperTail(likelihoodRatio, Math.max(1, df - 1)),
    fitted: fit.fitted,
  };
}

/**
 * Logistic regression. The outcome must be 0 or 1; the coefficients are on the
 * log-odds scale, and their exponentials are odds ratios.
 */
export function logisticRegression(predictors, outcome, names = []) {
  const y = outcome.map(Number);
  if (y.some((value) => value !== 0 && value !== 1)) {
    throw new Error('Logistic regression needs an outcome of 0 and 1 only.');
  }
  const n = y.length;
  if (predictors.some((column) => column.length !== n)) {
    throw new Error('Every predictor needs one value per observation.');
  }
  if (n < predictors.length + 2) {
    throw new Error(`Too few observations: ${n} rows cannot fit ${predictors.length + 1} parameters.`);
  }
  if (!y.some((value) => value === 1) || !y.some((value) => value === 0)) {
    throw new Error('The outcome is the same for every observation, so there is nothing to model.');
  }

  const design = buildDesign(predictors, n);
  const fit = fitGlm(design, y, FAMILIES.binomial);
  const labels = ['(Intercept)', ...predictors.map((_, i) => names[i] ?? `x${i + 1}`)];
  const summary = summarise(fit, labels, FAMILIES.binomial, y, n);

  // How well it separates: the area under the ROC curve.
  const positives = fit.fitted.filter((_, i) => y[i] === 1);
  const negatives = fit.fitted.filter((_, i) => y[i] === 0);
  let concordant = 0;
  for (const p of positives) for (const q of negatives) concordant += p > q ? 1 : p === q ? 0.5 : 0;
  const auc = concordant / (positives.length * negatives.length);

  return { ...summary, oddsRatios: true, auc };
}

/**
 * Poisson regression for counts. Coefficients are on the log scale; their
 * exponentials are rate ratios. An offset carries exposure (person-years, area
 * surveyed) and turns the model into one for a rate.
 */
export function poissonRegression(predictors, counts, names = [], { exposure = null } = {}) {
  const y = counts.map(Number);
  if (y.some((value) => !Number.isFinite(value) || value < 0 || !Number.isInteger(value))) {
    throw new Error('Poisson regression needs whole non-negative counts.');
  }
  const n = y.length;
  if (n < predictors.length + 2) {
    throw new Error(`Too few observations: ${n} rows cannot fit ${predictors.length + 1} parameters.`);
  }

  const design = buildDesign(predictors, n);
  const offset = exposure ? exposure.map((value) => Math.log(Math.max(1e-12, value))) : null;
  const fit = fitGlm(design, y, FAMILIES.poisson, { offset });
  const labels = ['(Intercept)', ...predictors.map((_, i) => names[i] ?? `x${i + 1}`)];
  const summary = summarise(fit, labels, FAMILIES.poisson, y, n);

  // Counts are often more variable than Poisson allows for; say so when they are.
  const pearson = y.reduce(
    (sum, value, i) => sum + (value - fit.fitted[i]) ** 2 / Math.max(1e-10, fit.fitted[i]), 0
  );
  const residualDf = n - labels.length;
  const dispersion = pearson / Math.max(1, residualDf);

  return {
    ...summary,
    rateRatios: true,
    dispersion,
    overdispersed: dispersion > 1.5,
    dispersionNote: dispersion > 1.5
      ? `The counts vary about ${dispersion.toFixed(1)} times more than Poisson allows. Standard errors here are too small; a negative binomial model would fit better.`
      : null,
  };
}

/**
 * Analysis of covariance: compares group means after adjusting for a continuous
 * covariate. Fitted as ordinary least squares with indicator columns.
 *
 * `groups` is an array of arrays of the outcome, `covariates` matches it.
 */
export function ancova(groups, covariates) {
  const k = groups.length;
  if (k < 2) throw new Error('ANCOVA needs at least two groups.');
  if (covariates.length !== k) throw new Error('Every group needs its covariate values.');

  const y = [];
  const covariate = [];
  const indicator = [];
  groups.forEach((values, index) => {
    if (values.length !== covariates[index].length) {
      throw new Error(`Group ${index + 1} has ${values.length} outcomes but ${covariates[index].length} covariate values.`);
    }
    values.forEach((value, i) => {
      y.push(Number(value));
      covariate.push(Number(covariates[index][i]));
      // Treatment coding: the first group is the reference.
      indicator.push(Array.from({ length: k - 1 }, (_, j) => (index === j + 1 ? 1 : 0)));
    });
  });

  const n = y.length;
  if (n < k + 2) throw new Error(`Too few observations: ${n} rows cannot fit ${k + 1} parameters.`);

  const fitLeastSquares = (design) => {
    const p = design[0].length;
    const information = transposeTimes(design, null);
    const score = new Float64Array(p);
    for (let i = 0; i < n; i += 1) for (let a = 0; a < p; a += 1) score[a] += design[i][a] * y[i];
    const beta = choleskySolve(information, score);
    if (!beta) throw new Error('The model is singular: the covariate may be constant, or a group may be empty.');
    const fitted = design.map((row) => row.reduce((sum, value, a) => sum + value * beta[a], 0));
    const residualSumSquares = y.reduce((sum, value, i) => sum + (value - fitted[i]) ** 2, 0);
    return { beta: Array.from(beta), fitted, residualSumSquares, p, information };
  };

  const full = fitLeastSquares(indicator.map((row, i) => [1, covariate[i], ...row]));
  const withoutGroup = fitLeastSquares(covariate.map((value) => [1, value]));
  const withoutCovariate = fitLeastSquares(indicator.map((row) => [1, ...row]));

  const residualDf = n - full.p;
  const meanSquareError = full.residualSumSquares / residualDf;

  const fTest = (reduced, df) => {
    const f = ((reduced.residualSumSquares - full.residualSumSquares) / df) / meanSquareError;
    return { f, df, pValue: fUpperTail(f, df, residualDf) };
  };

  // Type II sums of squares: each term tested with the other already in the
  // model. R's aov() gives sequential (Type I) values, where the covariate is
  // tested before the group is added; drop1() gives these. Type II is what
  // ANCOVA is usually asked for - the group effect adjusted for the covariate,
  // and the covariate adjusted for the group.
  const groupEffect = fTest(withoutGroup, k - 1);
  const covariateEffect = fTest(withoutCovariate, 1);

  // Adjusted to the overall covariate mean: the groups compared as if every
  // subject had the same covariate value.
  const grandCovariate = mean(covariate);
  const slope = full.beta[1];
  const adjustedMeans = groups.map((values, index) => {
    const raw = mean(values.map(Number));
    const groupCovariate = mean(covariates[index].map(Number));
    return { group: index, raw, adjusted: raw - slope * (groupCovariate - grandCovariate), n: values.length };
  });

  const covarianceMatrix = invertSymmetric(full.information);
  const slopeStandardError = covarianceMatrix ? Math.sqrt(meanSquareError * covarianceMatrix[1][1]) : NaN;

  return {
    method: 'Analysis of covariance',
    n,
    groups: k,
    slope,
    slopeStandardError,
    slopePValue: 2 * (1 - studentTCdf(Math.abs(slope / slopeStandardError), residualDf)),
    adjustedMeans,
    groupF: groupEffect.f,
    groupDf: groupEffect.df,
    groupPValue: groupEffect.pValue,
    covariateF: covariateEffect.f,
    covariatePValue: covariateEffect.pValue,
    residualDf,
    meanSquareError,
    statistic: groupEffect.f,
    statisticName: 'F',
    pValue: groupEffect.pValue,
  };
}

/**
 * Cox proportional hazards, fitted by Newton-Raphson on Efron's partial
 * likelihood, the tie handling R uses by default.
 *
 * `rows` are { time, event, x: number[] }.
 */
export function coxRegression(rows, names = []) {
  const data = rows
    .map((row) => ({ time: Number(row.time), event: row.event ? 1 : 0, x: row.x.map(Number) }))
    .filter((row) => Number.isFinite(row.time) && row.time >= 0 && row.x.every(Number.isFinite))
    .sort((a, b) => a.time - b.time);

  const n = data.length;
  if (n < 3) throw new Error('Cox regression needs at least three subjects.');
  const p = data[0].x.length;
  if (!p) throw new Error('At least one predictor is needed.');
  const events = data.filter((row) => row.event === 1).length;
  if (!events) throw new Error('No subject had the event, so there is nothing to model.');
  if (events < p + 1) {
    throw new Error(`Only ${events} event(s) for ${p} predictor(s). A Cox model needs roughly ten events per predictor to be trustworthy.`);
  }

  let beta = new Float64Array(p);

  const step = () => {
    let logLikelihood = 0;
    const gradient = new Float64Array(p);
    const hessian = Array.from({ length: p }, () => new Float64Array(p));

    // Distinct event times, latest first, accumulating the risk set as we go.
    const uniqueTimes = [...new Set(data.filter((row) => row.event).map((row) => row.time))].sort((a, b) => b - a);
    let riskIndex = n - 1;
    let riskSum = 0;
    const riskWeighted = new Float64Array(p);
    const riskSquare = Array.from({ length: p }, () => new Float64Array(p));

    for (const time of uniqueTimes) {
      while (riskIndex >= 0 && data[riskIndex].time >= time) {
        const row = data[riskIndex];
        const weight = Math.exp(row.x.reduce((sum, value, a) => sum + value * beta[a], 0));
        riskSum += weight;
        for (let a = 0; a < p; a += 1) {
          riskWeighted[a] += weight * row.x[a];
          for (let b = 0; b < p; b += 1) riskSquare[a][b] += weight * row.x[a] * row.x[b];
        }
        riskIndex -= 1;
      }

      const tied = data.filter((row) => row.time === time && row.event === 1);
      const d = tied.length;

      // Efron's correction removes a share of the tied subjects' weight at each
      // step, which is what R's coxph does unless told otherwise.
      let tiedSum = 0;
      const tiedWeighted = new Float64Array(p);
      const tiedSquare = Array.from({ length: p }, () => new Float64Array(p));
      for (const row of tied) {
        const weight = Math.exp(row.x.reduce((sum, value, a) => sum + value * beta[a], 0));
        tiedSum += weight;
        for (let a = 0; a < p; a += 1) {
          tiedWeighted[a] += weight * row.x[a];
          for (let b = 0; b < p; b += 1) tiedSquare[a][b] += weight * row.x[a] * row.x[b];
        }
        logLikelihood += row.x.reduce((sum, value, a) => sum + value * beta[a], 0);
        for (let a = 0; a < p; a += 1) gradient[a] += row.x[a];
      }

      for (let l = 0; l < d; l += 1) {
        const fraction = l / d;
        const denominator = riskSum - fraction * tiedSum;
        logLikelihood -= Math.log(denominator);
        for (let a = 0; a < p; a += 1) {
          const numeratorA = riskWeighted[a] - fraction * tiedWeighted[a];
          gradient[a] -= numeratorA / denominator;
          for (let b = 0; b < p; b += 1) {
            const numeratorB = riskWeighted[b] - fraction * tiedWeighted[b];
            hessian[a][b] +=
              (riskSquare[a][b] - fraction * tiedSquare[a][b]) / denominator -
              (numeratorA * numeratorB) / (denominator * denominator);
          }
        }
      }
    }

    return { logLikelihood, gradient, hessian };
  };

  let previous = -Infinity;
  let current = step();
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const delta = choleskySolve(current.hessian, current.gradient);
    if (!delta) throw new Error('The model is singular: check for a predictor that is constant or duplicated.');
    for (let a = 0; a < p; a += 1) beta[a] += delta[a];
    const next = step();
    if (Math.abs(next.logLikelihood - previous) < 1e-11 * (Math.abs(next.logLikelihood) + 0.1)) {
      current = next;
      break;
    }
    previous = current.logLikelihood;
    current = next;
  }

  const covariance = invertSymmetric(current.hessian);
  if (!covariance) throw new Error('The model is singular and its standard errors cannot be found.');

  const nullLogLikelihood = (() => {
    const saved = beta;
    beta = new Float64Array(p);
    const value = step().logLikelihood;
    beta = saved;
    return value;
  })();

  const terms = Array.from({ length: p }, (_, a) => {
    const estimate = beta[a];
    const standardError = Math.sqrt(Math.max(0, covariance[a][a]));
    const z = estimate / standardError;
    return {
      term: names[a] ?? `x${a + 1}`,
      estimate,
      standardError,
      z,
      pValue: 2 * (1 - normalCdf(Math.abs(z))),
      hazardRatio: Math.exp(estimate),
      hazardRatioConfidenceInterval95: [
        Math.exp(estimate - 1.96 * standardError),
        Math.exp(estimate + 1.96 * standardError),
      ],
    };
  });

  const likelihoodRatio = 2 * (current.logLikelihood - nullLogLikelihood);

  return {
    method: 'Cox proportional hazards',
    n,
    events,
    terms,
    logLikelihood: current.logLikelihood,
    statistic: likelihoodRatio,
    statisticName: 'likelihood-ratio χ²',
    df: p,
    pValue: chiSquareUpperTail(likelihoodRatio, p),
    concordanceNote:
      'The model assumes hazards stay proportional over time. Check that before relying on a hazard ratio.',
  };
}

function fUpperTail(f, df1, df2) {
  if (!Number.isFinite(f) || f <= 0) return 1;
  return incompleteBetaTail(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}

function incompleteBetaTail(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function betacf(a, b, x) {
  const eps = 1e-16;
  const fpmin = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }
  return h;
}

function lgamma(z) {
  const c = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = 0.9999999999998099;
  for (let i = 0; i < c.length; i += 1) x += c[i] / (z + i + 1);
  const t = z + c.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export { clean, choleskySolve, invertSymmetric };
