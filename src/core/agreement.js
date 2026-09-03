// Tests of agreement, paired counts, and equivalence.
// Checked against R in validation/.

import { mean, variance, clean, studentTCdf, studentTQuantile } from './stats.js';
import { normalCdf, chiSquareUpperTail } from './diagnostics.js';

/**
 * McNemar's test: paired binary outcomes, such as the same subjects tested
 * before and after. Only the discordant pairs carry information — the ones who
 * changed — so b and c are all the statistic uses.
 *
 * The table is [[a, b], [c, d]]: a agree positive, d agree negative, b and c
 * are the two ways of disagreeing.
 */
export function mcnemarTest(table, { correct = true } = {}) {
  if (!Array.isArray(table) || table.length !== 2 || table.some((row) => !Array.isArray(row) || row.length !== 2)) {
    throw new Error("McNemar's test needs a 2 x 2 table of paired counts.");
  }
  const [[a, b], [c, d]] = table.map((row) => row.map(Number));
  if ([a, b, c, d].some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Counts must be non-negative numbers.');
  }

  const discordant = b + c;
  if (discordant === 0) {
    throw new Error('Nobody changed between the two conditions, so there is nothing to test.');
  }

  // Below about 25 discordant pairs the chi-square approximation is poor and
  // the exact binomial is used instead, as most textbooks advise.
  if (discordant < 25) {
    let tail = 0;
    const smaller = Math.min(b, c);
    for (let k = 0; k <= smaller; k += 1) {
      let logChoose = 0;
      for (let i = 0; i < k; i += 1) logChoose += Math.log(discordant - i) - Math.log(i + 1);
      tail += Math.exp(logChoose - discordant * Math.LN2);
    }
    return {
      method: "McNemar's exact test (binomial)",
      table: [[a, b], [c, d]],
      discordant,
      statistic: smaller,
      statisticName: 'smaller discordant count',
      pValue: Math.min(1, 2 * tail),
      exact: true,
      oddsRatio: c === 0 ? Infinity : b / c,
    };
  }

  const deviation = Math.abs(b - c);
  const statistic = ((correct ? Math.max(0, deviation - 1) : deviation) ** 2) / discordant;
  return {
    method: correct ? "McNemar's test (continuity corrected)" : "McNemar's test",
    table: [[a, b], [c, d]],
    discordant,
    statistic,
    statisticName: 'χ²',
    df: 1,
    pValue: chiSquareUpperTail(statistic, 1),
    exact: false,
    oddsRatio: c === 0 ? Infinity : b / c,
  };
}

/**
 * Cohen's kappa: how far two raters agree beyond what chance would give. Raw
 * agreement is misleading when one category dominates — two raters who both
 * say "negative" ninety per cent of the time agree ninety per cent of the time
 * knowing nothing.
 *
 * `weights` may be 'unweighted', 'linear' or 'quadratic'; the weighted forms
 * are for ordered categories, where being one category out matters less than
 * being three out.
 */
export function cohensKappa(table, { weights = 'unweighted' } = {}) {
  const matrix = table.map((row) => row.map(Number));
  const k = matrix.length;
  if (!k || matrix.some((row) => row.length !== k)) {
    throw new Error("Cohen's kappa needs a square table: the same categories down and across.");
  }

  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new Error('The table is empty.');

  const rowTotals = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
  const columnTotals = matrix[0].map((_, j) => matrix.reduce((sum, row) => sum + row[j], 0));

  const weight = (i, j) => {
    if (weights === 'linear') return 1 - Math.abs(i - j) / (k - 1);
    if (weights === 'quadratic') return 1 - ((i - j) / (k - 1)) ** 2;
    return i === j ? 1 : 0;
  };

  let observed = 0;
  let expected = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      observed += weight(i, j) * (matrix[i][j] / total);
      expected += weight(i, j) * ((rowTotals[i] / total) * (columnTotals[j] / total));
    }
  }

  const kappa = (observed - expected) / (1 - expected);

  // Standard error under the null, as Fleiss gives it for the unweighted case.
  let standardError = NaN;
  if (weights === 'unweighted') {
    let sum = 0;
    for (let i = 0; i < k; i += 1) {
      const p = (rowTotals[i] / total) * (columnTotals[i] / total);
      sum += p * (1 - (rowTotals[i] / total + columnTotals[i] / total) * (1 - kappa)) ** 2;
    }
    let cross = 0;
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k; j += 1) {
        if (i === j) continue;
        cross += (rowTotals[i] / total) * (columnTotals[j] / total) * (columnTotals[i] / total + rowTotals[j] / total) ** 2;
      }
    }
    const variance =
      (sum + (1 - kappa) ** 2 * cross - (kappa - expected * (1 - kappa)) ** 2) /
      (total * (1 - expected) ** 2);
    standardError = Math.sqrt(Math.max(0, variance));
  }

  const interpretation =
    kappa < 0 ? 'worse than chance'
    : kappa < 0.2 ? 'slight'
    : kappa < 0.4 ? 'fair'
    : kappa < 0.6 ? 'moderate'
    : kappa < 0.8 ? 'substantial'
    : 'almost perfect';

  return {
    method: weights === 'unweighted' ? "Cohen's kappa" : `Cohen's kappa (${weights} weights)`,
    categories: k,
    n: total,
    observedAgreement: observed,
    expectedAgreement: expected,
    statistic: kappa,
    statisticName: 'kappa',
    kappa,
    standardError,
    confidenceInterval95: Number.isFinite(standardError)
      ? [kappa - 1.96 * standardError, kappa + 1.96 * standardError]
      : [NaN, NaN],
    interpretation,
  };
}

/**
 * Two one-sided tests: the question is whether two groups are close enough to
 * be considered equivalent, which a t-test cannot answer. Failing to reject a
 * difference is not evidence of equivalence; this tests for it directly.
 *
 * `bound` is the largest difference you would still call equivalent, in the
 * units of the data. Both one-sided tests must pass, so the p-value is the
 * larger of the two.
 */
export function tost(groupA, groupB, bound, { paired = false } = {}) {
  const a = clean(groupA);
  const b = clean(groupB);
  if (!(bound > 0)) throw new Error('The equivalence bound must be a positive number.');

  if (paired) {
    if (a.length !== b.length) throw new Error('A paired test needs the same number of values in both columns.');
    const differences = a.map((value, index) => value - b[index]);
    return tostFromSample(differences, bound, 'Paired');
  }

  if (a.length < 2 || b.length < 2) throw new Error('Each group needs at least two values.');

  const difference = mean(a) - mean(b);
  const standardError = Math.sqrt(variance(a) / a.length + variance(b) / b.length);
  const df =
    standardError ** 4 /
    ((variance(a) / a.length) ** 2 / (a.length - 1) + (variance(b) / b.length) ** 2 / (b.length - 1));

  return assembleTost(difference, standardError, df, bound, "Welch's TOST", a.length + b.length);
}

function tostFromSample(values, bound, label) {
  const n = values.length;
  if (n < 2) throw new Error('At least two pairs are needed.');
  const difference = mean(values);
  const standardError = Math.sqrt(variance(values) / n);
  return assembleTost(difference, standardError, n - 1, bound, `${label} TOST`, n);
}

function assembleTost(difference, standardError, df, bound, method, n) {
  // Lower test: is the difference above -bound? Upper: is it below +bound?
  const tLower = (difference + bound) / standardError;
  const tUpper = (difference - bound) / standardError;
  const pLower = 1 - studentTCdf(tLower, df);
  const pUpper = studentTCdf(tUpper, df);
  const pValue = Math.max(pLower, pUpper);

  // The 90% interval is the one that corresponds to two 5% one-sided tests.
  const critical = studentTQuantile(0.95, df);
  const interval = [difference - critical * standardError, difference + critical * standardError];

  return {
    method,
    n,
    difference,
    standardError,
    df,
    bound,
    tLower,
    tUpper,
    pLower,
    pUpper,
    statistic: pLower > pUpper ? tLower : tUpper,
    statisticName: 't',
    pValue,
    confidenceInterval90: interval,
    equivalent: pValue < 0.05,
    interpretation:
      pValue < 0.05
        ? `The difference falls inside ±${bound}, so the groups are equivalent at this bound.`
        : `Equivalence within ±${bound} cannot be concluded. This is not the same as showing a difference.`,
  };
}

/**
 * Bland-Altman: how two ways of measuring the same thing disagree across the
 * range. A correlation between two methods only says they rank subjects alike,
 * which is not the question when one is meant to replace the other.
 */
export function blandAltman(methodA, methodB) {
  const a = clean(methodA);
  const b = clean(methodB);
  if (a.length !== b.length || a.length < 3) {
    throw new Error('Bland-Altman needs at least three subjects measured by both methods, in matching rows.');
  }

  const differences = a.map((value, index) => value - b[index]);
  const averages = a.map((value, index) => (value + b[index]) / 2);
  const bias = mean(differences);
  const sd = Math.sqrt(variance(differences));
  const n = differences.length;

  // The limits hold 95% of differences; their own uncertainty is roughly
  // sqrt(3) times the standard error of the mean.
  const limitStandardError = sd * Math.sqrt(3 / n);
  const critical = studentTQuantile(0.975, n - 1);
  const biasStandardError = sd / Math.sqrt(n);

  // Does the disagreement change across the range? A slope here means the
  // limits should not be quoted as a single pair.
  const meanAverage = mean(averages);
  const covariance = averages.reduce(
    (sum, value, index) => sum + (value - meanAverage) * (differences[index] - bias), 0
  ) / (n - 1);
  const slope = covariance / variance(averages);
  const correlation = covariance / Math.sqrt(variance(averages) * variance(differences));
  const tSlope = correlation * Math.sqrt((n - 2) / Math.max(1e-300, 1 - correlation ** 2));

  return {
    method: 'Bland-Altman agreement',
    n,
    bias,
    biasConfidenceInterval95: [bias - critical * biasStandardError, bias + critical * biasStandardError],
    sd,
    upperLimit: bias + 1.96 * sd,
    lowerLimit: bias - 1.96 * sd,
    upperLimitConfidenceInterval95: [
      bias + 1.96 * sd - critical * limitStandardError,
      bias + 1.96 * sd + critical * limitStandardError,
    ],
    lowerLimitConfidenceInterval95: [
      bias - 1.96 * sd - critical * limitStandardError,
      bias - 1.96 * sd + critical * limitStandardError,
    ],
    proportionalBiasSlope: slope,
    proportionalBiasP: 2 * (1 - studentTCdf(Math.abs(tSlope), n - 2)),
    differences,
    averages,
    statistic: bias,
    statisticName: 'bias',
    pValue: 2 * (1 - studentTCdf(Math.abs(bias / biasStandardError), n - 1)),
  };
}

/**
 * Mantel-Haenszel: pools 2 x 2 tables across strata, which is the right way to
 * combine results from several experiments or sites without pretending they
 * were one. Pooling the raw counts instead would let Simpson's paradox through.
 *
 * Each stratum is [[a, b], [c, d]].
 */
export function mantelHaenszel(strata) {
  const tables = strata.map((table) => table.map((row) => row.map(Number)));
  if (tables.length < 2) throw new Error('At least two strata are needed; with one, use a plain 2 x 2 test.');

  let numerator = 0;
  let denominator = 0;
  let observed = 0;
  let expected = 0;
  let varianceSum = 0;

  for (const [[a, b], [c, d]] of tables) {
    const n = a + b + c + d;
    if (!(n > 0)) continue;
    numerator += (a * d) / n;
    denominator += (b * c) / n;
    observed += a;
    expected += ((a + b) * (a + c)) / n;
    if (n > 1) {
      varianceSum += ((a + b) * (c + d) * (a + c) * (b + d)) / (n * n * (n - 1));
    }
  }

  if (!(denominator > 0)) throw new Error('The pooled odds ratio is undefined: no stratum has discordant counts.');

  const oddsRatio = numerator / denominator;
  const deviation = Math.abs(observed - expected) - 0.5;
  const statistic = (Math.max(0, deviation) ** 2) / varianceSum;

  // Robins-Breslow-Greenland standard error on the log odds ratio.
  let sumPR = 0;
  let sumPS_QR = 0;
  let sumQS = 0;
  let sumR = 0;
  let sumS = 0;
  for (const [[a, b], [c, d]] of tables) {
    const n = a + b + c + d;
    if (!(n > 0)) continue;
    const P = (a + d) / n;
    const Q = (b + c) / n;
    const R = (a * d) / n;
    const S = (b * c) / n;
    sumPR += P * R;
    sumPS_QR += P * S + Q * R;
    sumQS += Q * S;
    sumR += R;
    sumS += S;
  }
  const logStandardError = Math.sqrt(
    sumPR / (2 * sumR ** 2) + sumPS_QR / (2 * sumR * sumS) + sumQS / (2 * sumS ** 2)
  );

  return {
    method: 'Mantel-Haenszel pooled odds ratio',
    strata: tables.length,
    oddsRatio,
    logOddsRatio: Math.log(oddsRatio),
    logStandardError,
    confidenceInterval95: [
      Math.exp(Math.log(oddsRatio) - 1.96 * logStandardError),
      Math.exp(Math.log(oddsRatio) + 1.96 * logStandardError),
    ],
    statistic,
    statisticName: 'χ²',
    df: 1,
    pValue: chiSquareUpperTail(statistic, 1),
  };
}

/**
 * Cochran's Q and I² for a meta-analysis: is the variation between studies more
 * than sampling error explains? I² is the share of the variation that is real
 * heterogeneity rather than chance, and is the number usually quoted.
 */
export function cochranQ(effects, standardErrors) {
  const y = clean(effects);
  const se = clean(standardErrors);
  if (y.length !== se.length || y.length < 2) {
    throw new Error('Cochran\'s Q needs at least two studies, each with an effect and its standard error.');
  }
  if (se.some((value) => !(value > 0))) throw new Error('Every standard error must be above zero.');

  const weights = se.map((value) => 1 / value ** 2);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const pooled = y.reduce((sum, value, index) => sum + weights[index] * value, 0) / totalWeight;

  const q = y.reduce((sum, value, index) => sum + weights[index] * (value - pooled) ** 2, 0);
  const df = y.length - 1;
  const iSquared = Math.max(0, (q - df) / q) * 100;

  // Between-study variance by DerSimonian and Laird.
  const sumSquaredWeights = weights.reduce((sum, value) => sum + value * value, 0);
  const tauSquared = Math.max(0, (q - df) / (totalWeight - sumSquaredWeights / totalWeight));

  const fixedStandardError = Math.sqrt(1 / totalWeight);
  const randomWeights = se.map((value) => 1 / (value ** 2 + tauSquared));
  const randomTotal = randomWeights.reduce((sum, value) => sum + value, 0);
  const randomPooled = y.reduce((sum, value, index) => sum + randomWeights[index] * value, 0) / randomTotal;
  const randomStandardError = Math.sqrt(1 / randomTotal);

  return {
    method: "Cochran's Q with I²",
    studies: y.length,
    statistic: q,
    statisticName: 'Q',
    df,
    pValue: chiSquareUpperTail(q, df),
    iSquared,
    tauSquared,
    fixedEffect: pooled,
    fixedConfidenceInterval95: [pooled - 1.96 * fixedStandardError, pooled + 1.96 * fixedStandardError],
    randomEffect: randomPooled,
    randomConfidenceInterval95: [
      randomPooled - 1.96 * randomStandardError,
      randomPooled + 1.96 * randomStandardError,
    ],
    interpretation:
      iSquared < 25 ? 'Little heterogeneity; a fixed-effect summary is reasonable.'
      : iSquared < 50 ? 'Moderate heterogeneity.'
      : iSquared < 75 ? 'Substantial heterogeneity; prefer the random-effects summary.'
      : 'Considerable heterogeneity; a single pooled number may not mean much.',
  };
}

/**
 * The resource equation: a rough check on animal numbers when no effect size is
 * available to power against. The residual degrees of freedom should land
 * between 10 and 20 — fewer and the experiment cannot detect anything, more and
 * animals are being used without gain.
 */
export function resourceEquation({ groups, perGroup }) {
  const k = Math.round(Number(groups));
  const n = Math.round(Number(perGroup));
  if (!(k >= 2) || !(n >= 1)) throw new Error('Give at least two groups and at least one subject per group.');

  const total = k * n;
  const residualDf = total - k;

  return {
    method: 'Resource equation',
    groups: k,
    perGroup: n,
    total,
    statistic: residualDf,
    statisticName: 'residual df',
    residualDf,
    withinRange: residualDf >= 10 && residualDf <= 20,
    minimumPerGroup: Math.ceil(10 / k) + 1,
    maximumPerGroup: Math.floor(20 / k) + 1,
    interpretation:
      residualDf < 10
        ? `Residual df of ${residualDf} is below 10: too few animals to detect anything but a very large effect.`
        : residualDf > 20
          ? `Residual df of ${residualDf} is above 20: extra animals are being used for little further gain.`
          : `Residual df of ${residualDf} is in the usual 10 to 20 range.`,
    caution:
      'This is a fallback for when no effect size is available. A power calculation from a pilot or from published data is always better.',
  };
}

/** Shared with the app: normal CDF, re-exported so callers need one import. */
export { normalCdf };
