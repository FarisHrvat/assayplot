// Exact distributions for small-sample rank tests, plus the conditional
// maximum-likelihood odds ratio for 2 x 2 tables.
//
// Written in expanded form rather than the compressed style used elsewhere in
// src/core: these are the routines whose correctness is hardest to inspect, and
// they are checked against R in validation/.

/** Largest group sizes for which the exact Mann-Whitney distribution is built. */
export const EXACT_MW_LIMIT = 50;
/** Largest n for which the exact signed-rank distribution is built. */
export const EXACT_WSR_LIMIT = 50;

/**
 * Counts of arrangements of m "A" items and n "B" items by number of
 * (A after B) inversions, i.e. the null distribution of the Mann-Whitney U.
 *
 * Recurrence (appending one item to the right of the sequence):
 *   N(i, j, u) = N(i-1, j, u-j)   append an A, which follows j B's
 *              + N(i, j-1, u)     append a B, which adds no inversion
 *
 * Rolls over i so memory is O(n * m * n) rather than O(m * n * m * n).
 *
 * @returns {Float64Array} counts indexed by u, length m*n+1. Sums to C(m+n, m).
 */
export function mannWhitneyCounts(m, n) {
  const max = m * n;
  let previous = Array.from({ length: n + 1 }, () => new Float64Array(max + 1));
  // i = 0: only B's remain, so there are zero inversions in exactly one way.
  for (let j = 0; j <= n; j++) previous[j][0] = 1;

  for (let i = 1; i <= m; i++) {
    const current = Array.from({ length: n + 1 }, () => new Float64Array(max + 1));
    for (let j = 0; j <= n; j++) {
      const target = current[j];
      const fromA = previous[j];
      for (let u = j; u <= max; u++) target[u] += fromA[u - j];
      if (j > 0) {
        const fromB = current[j - 1];
        for (let u = 0; u <= max; u++) target[u] += fromB[u];
      }
    }
    previous = current;
  }
  return previous[n];
}

/**
 * Two-sided exact Mann-Whitney p-value for an observed U.
 * Mirrors R's convention: double the smaller tail, capped at 1.
 */
export function mannWhitneyExactP(u, m, n) {
  const counts = mannWhitneyCounts(m, n);
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += counts[i];

  let lower = 0;
  for (let i = 0; i <= u; i++) lower += counts[i];
  let upper = 0;
  for (let i = u; i < counts.length; i++) upper += counts[i];

  return Math.min(1, (2 * Math.min(lower, upper)) / total);
}

/**
 * Counts of subsets of {1..n} by their sum, i.e. the null distribution of the
 * Wilcoxon signed-rank W+. Sums to 2^n.
 *
 * @returns {Float64Array} counts indexed by w, length n*(n+1)/2 + 1.
 */
export function signedRankCounts(n) {
  const max = (n * (n + 1)) / 2;
  const counts = new Float64Array(max + 1);
  counts[0] = 1;
  for (let rank = 1; rank <= n; rank++) {
    for (let w = max; w >= rank; w--) counts[w] += counts[w - rank];
  }
  return counts;
}

/** Two-sided exact Wilcoxon signed-rank p-value for an observed W. */
export function signedRankExactP(w, n) {
  const counts = signedRankCounts(n);
  const total = Math.pow(2, n);

  let lower = 0;
  for (let i = 0; i <= w; i++) lower += counts[i];
  let upper = 0;
  for (let i = w; i < counts.length; i++) upper += counts[i];

  return Math.min(1, (2 * Math.min(lower, upper)) / total);
}

/**
 * Conditional maximum-likelihood estimate of the odds ratio for a 2 x 2 table,
 * as reported by R's fisher.test. This differs from the sample cross-product
 * ratio (a*d)/(b*c), which is what GraphPad Prism reports; Statista reports
 * both, each explicitly labelled.
 *
 * Solves E[X | psi] = a over the noncentral hypergeometric distribution of the
 * top-left cell, by bisection on log(psi).
 */
export function conditionalOddsRatio(a, b, c, d, logChoose) {
  const rowOne = a + b;
  const columnOne = a + c;
  const columnTwo = b + d;

  const minX = Math.max(0, rowOne - columnTwo);
  const maxX = Math.min(rowOne, columnOne);

  if (minX === maxX) return NaN;          // no information about the odds ratio
  if (a === maxX) return Infinity;        // boundary: MLE diverges
  if (a === minX) return 0;

  // log of the hypergeometric weight for x, up to an additive constant.
  const logWeight = (x) => logChoose(columnOne, x) + logChoose(columnTwo, rowOne - x);

  const expectation = (logPsi) => {
    let maxTerm = -Infinity;
    const terms = [];
    for (let x = minX; x <= maxX; x++) {
      const term = logWeight(x) + x * logPsi;
      terms.push(term);
      if (term > maxTerm) maxTerm = term;
    }
    let weightSum = 0;
    let valueSum = 0;
    for (let i = 0; i < terms.length; i++) {
      const weight = Math.exp(terms[i] - maxTerm);
      weightSum += weight;
      valueSum += (minX + i) * weight;
    }
    return valueSum / weightSum;
  };

  let low = -50;
  let high = 50;
  for (let iteration = 0; iteration < 200; iteration++) {
    const middle = (low + high) / 2;
    if (expectation(middle) < a) low = middle;
    else high = middle;
  }
  return Math.exp((low + high) / 2);
}

/** Largest n for which the exact Spearman permutation distribution is built. */
export const EXACT_SPEARMAN_LIMIT = 9;

/**
 * Two-sided exact Spearman p-value by complete enumeration of the n!
 * permutations of the y-ranks, matching R's behaviour for small n without ties.
 *
 * Uses S = sum of squared rank differences, which is a monotone decreasing
 * function of rho, so the two-sided test doubles the smaller tail of S.
 */
export function spearmanExactP(rankX, rankY) {
  const n = rankX.length;
  const observedS = rankX.reduce((sum, rank, i) => sum + (rank - rankY[i]) ** 2, 0);

  let atOrBelow = 0;
  let atOrAbove = 0;
  let total = 0;

  const permutation = rankY.slice();
  const permute = (k) => {
    if (k === n) {
      let s = 0;
      for (let i = 0; i < n; i++) s += (rankX[i] - permutation[i]) ** 2;
      total++;
      // tolerance absorbs float noise on sums of squared half-integer ranks
      if (s <= observedS + 1e-9) atOrBelow++;
      if (s >= observedS - 1e-9) atOrAbove++;
      return;
    }
    for (let i = k; i < n; i++) {
      [permutation[k], permutation[i]] = [permutation[i], permutation[k]];
      permute(k + 1);
      [permutation[k], permutation[i]] = [permutation[i], permutation[k]];
    }
  };
  permute(0);

  return Math.min(1, (2 * Math.min(atOrBelow, atOrAbove)) / total);
}
