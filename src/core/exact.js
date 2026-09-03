// Exact null distributions for the small-sample rank tests, and the conditional
// MLE odds ratio for a 2 x 2 table. Checked against R in validation/.

// R uses the exact distribution below these sizes; matching that keeps our
// p-values identical to its.
export const EXACT_MW_LIMIT = 50;
export const EXACT_WSR_LIMIT = 50;

// Counts arrangements of m A's and n B's by the number of (A after B)
// inversions, which is the null distribution of U. Appending one item at a
// time gives N(i,j,u) = N(i-1,j,u-j) + N(i,j-1,u); rolling over i keeps memory
// at O(n * mn) instead of O(mn * mn).
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

// Two-sided: double the smaller tail and cap at 1, as R does.
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

// Subsets of {1..n} counted by their sum: the null distribution of W+.
export function signedRankCounts(n) {
  const max = (n * (n + 1)) / 2;
  const counts = new Float64Array(max + 1);
  counts[0] = 1;
  for (let rank = 1; rank <= n; rank++) {
    for (let w = max; w >= rank; w--) counts[w] += counts[w - rank];
  }
  return counts;
}

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
 * ratio (a*d)/(b*c), which is what GraphPad Prism reports; AssayPlot reports
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

export const EXACT_SPEARMAN_LIMIT = 9;

// Complete enumeration of the n! permutations, as R does for small n. S (the
// sum of squared rank differences) decreases monotonically in rho, so the
// two-sided test doubles the smaller tail of S.
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
