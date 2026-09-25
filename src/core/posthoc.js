// Post-hoc comparisons and the studentized range distribution they rest on.
// Checked against R in validation/.

import { mean, variance, clean } from './stats.js';
import { normalCdf as normalCdfPrecise } from './diagnostics.js';

function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// A polynomial erf here used to put an 8e-9 floor under every studentized
// range value that no amount of quadrature could get past.
const normalCdf = normalCdfPrecise;

// Nodes and weights on [-1, 1], by Newton iteration on the Legendre polynomial.
function legendre(n) {
  const nodes = new Float64Array(n);
  const weights = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    for (let iteration = 0; iteration < 100; iteration += 1) {
      let p0 = 1;
      let p1 = 0;
      for (let j = 0; j < n; j += 1) {
        const p2 = p1;
        p1 = p0;
        p0 = ((2 * j + 1) * x * p1 - j * p2) / (j + 1);
      }
      const derivative = (n * (x * p0 - p1)) / (x * x - 1);
      const delta = p0 / derivative;
      x -= delta;
      if (Math.abs(delta) < 1e-15) break;
    }
    let p0 = 1;
    let p1 = 0;
    for (let j = 0; j < n; j += 1) {
      const p2 = p1;
      p1 = p0;
      p0 = ((2 * j + 1) * x * p1 - j * p2) / (j + 1);
    }
    const derivative = (n * (x * p0 - p1)) / (x * x - 1);
    nodes[i] = x;
    weights[i] = 2 / ((1 - x * x) * derivative * derivative);
  }
  return { nodes, weights };
}

// 32 nodes over 4 panels. Measured against R's ptukey, this is accurate to the
// same 8 significant figures as 96 nodes over 12 panels and roughly sixty times
// cheaper: the integrand is smooth, so Gauss-Legendre converges almost at once
// and the extra nodes bought nothing.
const GL = legendre(32);
const PANELS = 4;

function integrate(f, a, b, panels = 8) {
  const step = (b - a) / panels;
  let total = 0;
  for (let panel = 0; panel < panels; panel += 1) {
    const low = a + panel * step;
    const half = step / 2;
    const mid = low + half;
    for (let i = 0; i < GL.nodes.length; i += 1) {
      total += GL.weights[i] * f(mid + half * GL.nodes[i]);
    }
  }
  return total * ((b - a) / panels) / 2;
}

// P(W < w) for the range of k standard normals:
//   k * integral phi(z) [Phi(z) - Phi(z - w)]^(k-1) dz
function rangeCdf(w, k) {
  if (w <= 0) return 0;
  return k * integrate((z) => normalPdf(z) * Math.pow(normalCdf(z) - normalCdf(z - w), k - 1), -8.5, 8.5, PANELS);
}

// P(Q < q) for k means on df degrees of freedom, as R's ptukey. The outer
// integral mixes the range over the chi distribution of the pooled standard
// error.
export function studentizedRangeCdf(q, k, df) {
  if (!(q > 0)) return 0;
  if (!Number.isFinite(df) || df > 25000) return rangeCdf(q, k);

  // s = sqrt(chi2_df / df) scales the range; it concentrates near 1.
  const halfDf = df / 2;
  const logConstant = halfDf * Math.log(halfDf) - lgamma(halfDf) + Math.log(2);
  const density = (s) => Math.exp(logConstant + (df - 1) * Math.log(s) - (halfDf * s * s));

  const spread = 6 / Math.sqrt(2 * df);
  const low = Math.max(1e-8, 1 - spread * 1.8);
  const high = 1 + spread * 2.2;
  return Math.min(1, integrate((s) => density(s) * rangeCdf(q * s, k), low, high, PANELS));
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

/**
 * Upper-tail p-value for an observed studentized range statistic.
 *
 * Computed as 1 - CDF. Once the CDF saturates against 1 the subtraction loses
 * the leading digits, so far-tail values carry about three significant
 * figures. Raising the quadrature
 * resolution does not help, because the loss is in the subtraction, not the
 * integral. That is far more precision than a reported p-value needs.
 *
 * Below RANGE_P_FLOOR the value should be read as "smaller than this" rather
 * than as an estimate; the floor is returned instead of 0 so that a p-value
 * never claims to be exactly zero.
 */
export const RANGE_P_FLOOR = 1e-10;

export function studentizedRangeP(q, k, df) {
  const tail = 1 - studentizedRangeCdf(q, k, df);
  if (!(tail > RANGE_P_FLOOR)) return RANGE_P_FLOOR;
  return Math.min(1, tail);
}

// All pairwise comparisons with the family-wise error rate controlled exactly,
// assuming equal variances.
export function tukeyHSD(groups, labels = []) {
  const arrays = groups.map(clean).filter((values) => values.length > 1);
  if (arrays.length < 3) throw new Error('Tukey HSD needs at least three groups with two or more values.');

  const k = arrays.length;
  const total = arrays.reduce((sum, values) => sum + values.length, 0);
  const dfWithin = total - k;
  const meanSquareWithin =
    arrays.reduce((sum, values) => sum + (values.length - 1) * variance(values), 0) / dfWithin;

  // Each evaluation is a double numerical integration and the value depends
  // only on k and dfWithin, so it is computed once for the whole family.
  const critical = studentizedRangeQuantile(0.95, k, dfWithin);

  const comparisons = [];
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const a = arrays[i];
      const b = arrays[j];
      const difference = mean(a) - mean(b);
      const standardError = Math.sqrt((meanSquareWithin / 2) * (1 / a.length + 1 / b.length));
      const q = Math.abs(difference) / standardError;
      const pValue = studentizedRangeP(q, k, dfWithin);
      const margin = critical * standardError;
      comparisons.push({
        indexA: i,
        indexB: j,
        labelA: labels[i] ?? `Group ${i + 1}`,
        labelB: labels[j] ?? `Group ${j + 1}`,
        difference,
        standardError,
        q,
        pValue,
        pAdjusted: pValue,
        confidenceInterval95: [difference - margin, difference + margin],
      });
    }
  }

  return {
    method: 'Tukey honestly significant difference',
    groups: k,
    dfWithin,
    meanSquareWithin,
    comparisons,
  };
}

const quantileCache = new Map();

/**
 * Inverse studentized range, by bisection. Used for the Tukey intervals.
 *
 * Depends only on (probability, k, df), and each evaluation is a double
 * numerical integration, so results are remembered: a project re-renders its
 * figures on every keystroke and must not re-derive this each time.
 *
 * 40 bisections over [0, 20] resolves to about 2e-11, far below the accuracy of
 * the integral being inverted.
 */
export function studentizedRangeQuantile(probability, k, df) {
  const key = `${probability}|${k}|${df}`;
  const cached = quantileCache.get(key);
  if (cached !== undefined) return cached;

  let low = 0;
  let high = 20;
  for (let i = 0; i < 40; i += 1) {
    const middle = (low + high) / 2;
    if (studentizedRangeCdf(middle, k, df) < probability) low = middle;
    else high = middle;
  }
  const value = (low + high) / 2;
  if (quantileCache.size > 500) quantileCache.clear();
  quantileCache.set(key, value);
  return value;
}

// The rank-based post-hoc that belongs after Kruskal-Wallis: pooled ranking
// with a tie correction, as in the dunn.test package.
export function dunnTest(groups, labels = [], adjust = (p) => p) {
  const arrays = groups.map(clean).filter((values) => values.length > 0);
  if (arrays.length < 3) throw new Error("Dunn's test needs at least three groups.");

  const pooled = [];
  arrays.forEach((values, groupIndex) => {
    values.forEach((value) => pooled.push({ value, groupIndex }));
  });
  pooled.sort((a, b) => a.value - b.value);

  const tieSizes = [];
  for (let i = 0; i < pooled.length;) {
    let j = i + 1;
    while (j < pooled.length && pooled[j].value === pooled[i].value) j += 1;
    const averageRank = (i + 1 + j) / 2;
    for (let m = i; m < j; m += 1) pooled[m].rank = averageRank;
    if (j - i > 1) tieSizes.push(j - i);
    i = j;
  }

  const n = pooled.length;
  const tieTerm = tieSizes.reduce((sum, size) => sum + (size ** 3 - size), 0);
  const meanRanks = arrays.map((_, groupIndex) => {
    const ranks = pooled.filter((entry) => entry.groupIndex === groupIndex).map((entry) => entry.rank);
    return ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
  });

  const sigmaBase = (n * (n + 1)) / 12 - tieTerm / (12 * (n - 1));

  const raw = [];
  const pairs = [];
  for (let i = 0; i < arrays.length; i += 1) {
    for (let j = i + 1; j < arrays.length; j += 1) {
      const standardError = Math.sqrt(sigmaBase * (1 / arrays[i].length + 1 / arrays[j].length));
      const z = (meanRanks[i] - meanRanks[j]) / standardError;
      const pValue = 2 * (1 - normalCdf(Math.abs(z)));
      raw.push(pValue);
      pairs.push({
        indexA: i,
        indexB: j,
        labelA: labels[i] ?? `Group ${i + 1}`,
        labelB: labels[j] ?? `Group ${j + 1}`,
        meanRankA: meanRanks[i],
        meanRankB: meanRanks[j],
        z,
        pValue,
      });
    }
  }

  const adjusted = adjust(raw);
  return {
    method: "Dunn's test",
    groups: arrays.length,
    n,
    comparisons: pairs.map((pair, index) => ({ ...pair, pAdjusted: adjusted[index] })),
  };
}

// Every group against one control, Sidak-corrected. Deliberately not called
// Dunnett's test: Dunnett uses the joint multivariate-t of the comparisons and
// is slightly less conservative. The result says so, so nobody reports the
// wrong procedure.
export function versusControl(groups, controlIndex, labels = [], tTest) {
  const arrays = groups.map(clean);
  if (arrays.length < 2) throw new Error('Comparing against a control needs at least two groups.');
  if (!arrays[controlIndex]) throw new Error('The chosen control column has no numeric values.');

  const comparisons = [];
  const count = arrays.length - 1;
  for (let i = 0; i < arrays.length; i += 1) {
    if (i === controlIndex) continue;
    const test = tTest(arrays[i], arrays[controlIndex]);
    const pAdjusted = 1 - Math.pow(1 - test.pValue, count);
    comparisons.push({
      indexA: i,
      indexB: controlIndex,
      labelA: labels[i] ?? `Group ${i + 1}`,
      labelB: labels[controlIndex] ?? 'Control',
      difference: test.difference,
      pValue: test.pValue,
      pAdjusted: Math.min(1, pAdjusted),
    });
  }

  return {
    method: 'Comparisons against a control (Šídák corrected)',
    note: 'Not Dunnett’s test: Šídák treats the comparisons as independent, which is slightly more conservative than Dunnett’s joint multivariate-t.',
    control: labels[controlIndex] ?? 'Control',
    comparisons,
  };
}
