// Assumption checks and outlier screening.
//
// These are the tests a reviewer asks for: is it normal, are the variances
// equal, is that one point an outlier. Checked against R in validation/.

import { mean, variance, clean, studentTCdf, studentTQuantile } from './stats.js';

// ---------------------------------------------------------------------------
// normal quantile (Wichura AS 241), accurate to about 1e-16
// ---------------------------------------------------------------------------

export function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const q = p - 0.5;
  let r;
  if (Math.abs(q) <= 0.425) {
    r = 0.180625 - q * q;
    return (q * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r + 3.387132872796366608)) /
      (((((((5226.495278852854561 * r + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
  }
  r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let value;
  if (r <= 5) {
    r -= 1.6;
    value = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r + 1.42343711074968357734) /
      (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1);
  } else {
    r -= 5;
    value = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.00124266094738807843860) * r + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r + 6.6579046435011037772) /
      (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1);
  }
  return q < 0 ? -value : value;
}

/**
 * Derived from the incomplete gamma rather than a polynomial erf: the
 * Abramowitz-Stegun approximation has 1.5e-7 *absolute* error, which destroys
 * relative accuracy exactly where a normality p-value matters.
 */
function normalCdf(x) {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const tail = 0.5 * regularizedGammaQ(0.5, (x * x) / 2);
  return x >= 0 ? 1 - tail : tail;
}

// ---------------------------------------------------------------------------
// Shapiro-Wilk (Royston 1995, AS R94)
// ---------------------------------------------------------------------------

/**
 * The normality test most reviewers expect. Valid for 3 <= n <= 5000.
 *
 * Note the direction of the question: a large p-value is not evidence of
 * normality, only an absence of evidence against it. With small lab samples
 * this test has very little power, which the result states plainly.
 */
export function shapiroWilk(values) {
  const x = clean(values).sort((a, b) => a - b);
  const n = x.length;
  if (n < 3) throw new Error('The Shapiro-Wilk test needs at least three values.');
  if (n > 5000) throw new Error('The Shapiro-Wilk test is defined for at most 5000 values.');

  const m = new Array(n);
  for (let i = 0; i < n; i += 1) m[i] = normalQuantile((i + 1 - 0.375) / (n + 0.25));
  const ssumm2 = m.reduce((sum, value) => sum + value * value, 0);
  const rsn = 1 / Math.sqrt(n);
  const c = m.map((value) => value / Math.sqrt(ssumm2));

  const a = new Array(n).fill(0);
  let i1;
  let phi;

  if (n > 5) {
    // Royston's correction adds a polynomial in 1/sqrt(n) to c[n].
    a[n - 1] = c[n - 1] + 0.221157 * rsn - 0.147981 * rsn ** 2 - 2.071190 * rsn ** 3 + 4.434685 * rsn ** 4 - 2.706056 * rsn ** 5;
    a[n - 2] = c[n - 2] + 0.042981 * rsn - 0.293762 * rsn ** 2 - 1.752461 * rsn ** 3 + 5.682633 * rsn ** 4 - 3.582633 * rsn ** 5;
    i1 = 2;
    phi = (ssumm2 - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) / (1 - 2 * a[n - 1] ** 2 - 2 * a[n - 2] ** 2);
  } else {
    a[n - 1] = c[n - 1] + 0.221157 * rsn - 0.147981 * rsn ** 2 - 2.071190 * rsn ** 3 + 4.434685 * rsn ** 4 - 2.706056 * rsn ** 5;
    i1 = 1;
    phi = (ssumm2 - 2 * m[n - 1] ** 2) / (1 - 2 * a[n - 1] ** 2);
  }

  for (let i = i1; i < n - i1; i += 1) a[i] = m[i] / Math.sqrt(phi);
  for (let i = 0; i < i1; i += 1) a[i] = -a[n - 1 - i];

  const xbar = mean(x);
  const numerator = x.reduce((sum, value, i) => sum + a[i] * value, 0) ** 2;
  const denominator = x.reduce((sum, value) => sum + (value - xbar) ** 2, 0);
  const w = numerator / denominator;

  let pValue;
  if (n === 3) {
    pValue = Math.max(0, Math.min(1, (6 / Math.PI) * (Math.asin(Math.sqrt(w)) - Math.asin(Math.sqrt(0.75)))));
  } else if (n <= 11) {
    const gamma = -2.273 + 0.459 * n;
    const mu = 0.5440 - 0.39978 * n + 0.025054 * n ** 2 - 0.0006714 * n ** 3;
    const sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n ** 2 - 0.0020322 * n ** 3);
    const y = -Math.log(gamma - Math.log(1 - w));
    pValue = 1 - normalCdf((y - mu) / sigma);
  } else {
    const logN = Math.log(n);
    const mu = -1.5861 - 0.31082 * logN - 0.083751 * logN ** 2 + 0.0038915 * logN ** 3;
    const sigma = Math.exp(-0.4803 - 0.082676 * logN + 0.0030302 * logN ** 2);
    const y = Math.log(1 - w);
    pValue = 1 - normalCdf((y - mu) / sigma);
  }

  return {
    method: 'Shapiro-Wilk normality test',
    n,
    statistic: w,
    statisticName: 'W',
    pValue: Math.max(0, Math.min(1, pValue)),
    lowPower: n < 20,
    interpretation:
      pValue < 0.05
        ? 'The data depart from normality more than sampling alone would explain.'
        : n < 20
          ? 'No detectable departure from normality, but with this few values the test has very little power. Absence of evidence is not evidence of normality.'
          : 'No detectable departure from normality.',
  };
}

// ---------------------------------------------------------------------------
// D'Agostino-Pearson K^2
// ---------------------------------------------------------------------------

/** Combines skewness and kurtosis into an omnibus normality test. Needs n >= 20. */
export function dagostinoPearson(values) {
  const x = clean(values);
  const n = x.length;
  if (n < 20) throw new Error("The D'Agostino-Pearson test needs at least 20 values.");

  const m = mean(x);
  const moment = (power) => x.reduce((sum, value) => sum + (value - m) ** power, 0) / n;
  const m2 = moment(2);
  const skewness = moment(3) / m2 ** 1.5;
  const kurtosis = moment(4) / m2 ** 2;

  // Transformed skewness (D'Agostino 1970).
  const y = skewness * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
  const beta2 = (3 * (n ** 2 + 27 * n - 70) * (n + 1) * (n + 3)) / ((n - 2) * (n + 5) * (n + 7) * (n + 9));
  const w2 = -1 + Math.sqrt(2 * (beta2 - 1));
  const delta = 1 / Math.sqrt(0.5 * Math.log(w2));
  const alpha = Math.sqrt(2 / (w2 - 1));
  const zSkew = delta * Math.log(y / alpha + Math.sqrt((y / alpha) ** 2 + 1));

  // Transformed kurtosis (Anscombe & Glynn 1983).
  const meanKurtosis = (3 * (n - 1)) / (n + 1);
  const varianceKurtosis = (24 * n * (n - 2) * (n - 3)) / ((n + 1) ** 2 * (n + 3) * (n + 5));
  const standardised = (kurtosis - meanKurtosis) / Math.sqrt(varianceKurtosis);
  const sqrtBeta1 =
    ((6 * (n ** 2 - 5 * n + 2)) / ((n + 7) * (n + 9))) * Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
  const aCoefficient = 6 + (8 / sqrtBeta1) * (2 / sqrtBeta1 + Math.sqrt(1 + 4 / sqrtBeta1 ** 2));
  const zKurtosis =
    (Math.cbrt(1 - 2 / (9 * aCoefficient)) -
      Math.cbrt((1 - 2 / aCoefficient) / (1 + standardised * Math.sqrt(2 / (aCoefficient - 4))))) /
    Math.sqrt(2 / (9 * aCoefficient));

  const k2 = zSkew ** 2 + zKurtosis ** 2;
  // K^2 is chi-square on 2 df, whose survival function is exp(-k2/2).
  return {
    method: "D'Agostino-Pearson omnibus normality test",
    n,
    skewness,
    kurtosis,
    zSkew,
    zKurtosis,
    statistic: k2,
    statisticName: 'K²',
    df: 2,
    pValue: Math.exp(-k2 / 2),
  };
}

// ---------------------------------------------------------------------------
// equality of variance
// ---------------------------------------------------------------------------

/**
 * Levene's test on deviations from the group median (the Brown-Forsythe
 * variant), which is the robust form and R's default in car::leveneTest.
 */
export function leveneTest(groups) {
  const arrays = groups.map(clean).filter((values) => values.length > 1);
  if (arrays.length < 2) throw new Error("Levene's test needs at least two groups.");

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  const deviations = arrays.map((values) => {
    const centre = median(values);
    return values.map((value) => Math.abs(value - centre));
  });

  const k = arrays.length;
  const n = deviations.reduce((sum, values) => sum + values.length, 0);
  const grand = mean(deviations.flat());
  const between = deviations.reduce((sum, values) => sum + values.length * (mean(values) - grand) ** 2, 0);
  const within = deviations.reduce(
    (sum, values) => sum + values.reduce((inner, value) => inner + (value - mean(values)) ** 2, 0),
    0
  );
  const dfBetween = k - 1;
  const dfWithin = n - k;
  const f = (between / dfBetween) / (within / dfWithin);

  return {
    method: "Levene's test (centred on the median)",
    groups: k,
    statistic: f,
    statisticName: 'F',
    dfBetween,
    dfWithin,
    pValue: fUpperTail(f, dfBetween, dfWithin),
    interpretation:
      fUpperTail(f, dfBetween, dfWithin) < 0.05
        ? 'The group variances differ. Prefer Welch’s t-test or Welch’s ANOVA over the equal-variance forms.'
        : 'No detectable difference between the group variances.',
  };
}

/** Bartlett's test. More powerful than Levene under normality, less robust to departures from it. */
export function bartlettTest(groups) {
  const arrays = groups.map(clean).filter((values) => values.length > 1);
  if (arrays.length < 2) throw new Error("Bartlett's test needs at least two groups.");

  const k = arrays.length;
  const n = arrays.reduce((sum, values) => sum + values.length, 0);
  const pooled = arrays.reduce((sum, values) => sum + (values.length - 1) * variance(values), 0) / (n - k);
  const numerator =
    (n - k) * Math.log(pooled) -
    arrays.reduce((sum, values) => sum + (values.length - 1) * Math.log(variance(values)), 0);
  const correction =
    1 + (1 / (3 * (k - 1))) * (arrays.reduce((sum, values) => sum + 1 / (values.length - 1), 0) - 1 / (n - k));
  const statistic = numerator / correction;

  return {
    method: "Bartlett's test of equal variances",
    groups: k,
    statistic,
    statisticName: 'χ²',
    df: k - 1,
    pValue: chiSquareUpperTail(statistic, k - 1),
  };
}

// ---------------------------------------------------------------------------
// outliers
// ---------------------------------------------------------------------------

/** Grubbs' test for the single most extreme value in a roughly normal sample. */
export function grubbsTest(values) {
  const x = clean(values);
  const n = x.length;
  if (n < 3) throw new Error("Grubbs' test needs at least three values.");

  const m = mean(x);
  const sd = Math.sqrt(variance(x));
  if (!(sd > 0)) throw new Error('Every value is identical, so there is no outlier to find.');

  let index = 0;
  let statistic = 0;
  x.forEach((value, i) => {
    const deviation = Math.abs(value - m) / sd;
    if (deviation > statistic) {
      statistic = deviation;
      index = i;
    }
  });

  // Two-sided critical value inverted into a p-value.
  const df = n - 2;
  const tSquared = (statistic ** 2 * df) / ((n - 1) ** 2 - n * statistic ** 2);
  const t = Math.sqrt(Math.max(0, tSquared));
  const pValue = Math.min(1, 2 * n * (1 - studentTCdf(t, df)));

  return {
    method: "Grubbs' test for one outlier",
    n,
    value: x[index],
    statistic,
    statisticName: 'G',
    pValue,
    isOutlier: pValue < 0.05,
    caution:
      'Removing a value because a test flagged it changes the meaning of every subsequent p-value. Record the exclusion and the reason for it.',
  };
}

// ---------------------------------------------------------------------------
// one-sample comparison
// ---------------------------------------------------------------------------

/** Tests a sample mean against a hypothesised value. */
export function oneSampleTTest(values, hypothesised = 0) {
  const x = clean(values);
  const n = x.length;
  if (n < 2) throw new Error('A one-sample t-test needs at least two values.');

  const m = mean(x);
  const standardError = Math.sqrt(variance(x) / n);
  const df = n - 1;
  const t = (m - hypothesised) / standardError;
  const critical = studentTQuantile(0.975, df);

  return {
    method: 'One-sample t-test',
    n,
    mean: m,
    hypothesised,
    difference: m - hypothesised,
    standardError,
    statistic: t,
    statisticName: 't',
    t,
    df,
    pValue: 2 * (1 - studentTCdf(Math.abs(t), df)),
    confidenceInterval95: [m - critical * standardError, m + critical * standardError],
    effectSizeCohensD: (m - hypothesised) / Math.sqrt(variance(x)),
  };
}

// ---------------------------------------------------------------------------
// shared tail helpers
// ---------------------------------------------------------------------------

function fUpperTail(f, df1, df2) {
  if (!Number.isFinite(f) || f <= 0) return 1;
  return incompleteBetaTail(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}

function chiSquareUpperTail(value, df) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return regularizedGammaQ(df / 2, value / 2);
}

// Local copies so this module does not depend on stats.js internals.
function incompleteBetaTail(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function betacf(a, b, x) {
  const max = 500;
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
  for (let m = 1; m <= max; m += 1) {
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

function regularizedGammaQ(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n += 1) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * sum;
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
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
