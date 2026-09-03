// Properties of the multivariate procedures that no R fixture covers.
//
// PCA and hierarchical clustering are checked against R in the golden suite;
// what is checked here is the structure R's output does not expose — that the
// scores are orthogonal, that the tree's leaf order is a permutation, and that
// the PLS components are deflated properly. PLS-DA has no base-R oracle at all,
// so its defining properties are all there is.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pca, plsda, anosim, hierarchicalCluster, cutTree, dendrogramOrder, distanceMatrix,
} from '../src/core/multivariate.js';

const IRIS = [
  [5.1, 3.5, 1.4, 0.2], [4.9, 3.0, 1.4, 0.2], [4.7, 3.2, 1.3, 0.2], [4.6, 3.1, 1.5, 0.2],
  [7.0, 3.2, 4.7, 1.4], [6.4, 3.2, 4.5, 1.5], [6.9, 3.1, 4.9, 1.5], [5.5, 2.3, 4.0, 1.3],
  [6.3, 3.3, 6.0, 2.5], [5.8, 2.7, 5.1, 1.9], [7.1, 3.0, 5.9, 2.1], [6.3, 2.9, 5.6, 1.8],
];
const SPECIES = ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'c', 'c', 'c', 'c'];

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const column = (matrix, j) => matrix.map((row) => row[j]);

test('principal components are orthogonal and account for all the variance', () => {
  const fit = pca(IRIS, { scale: true });

  for (let a = 0; a < fit.eigenvalues.length; a += 1) {
    for (let b = a + 1; b < fit.eigenvalues.length; b += 1) {
      assert.ok(
        Math.abs(dot(column(fit.scores, a), column(fit.scores, b))) < 1e-9,
        `scores on PC${a + 1} and PC${b + 1} are not orthogonal`
      );
      assert.ok(
        Math.abs(dot(column(fit.loadings, a), column(fit.loadings, b))) < 1e-12,
        `loadings on PC${a + 1} and PC${b + 1} are not orthogonal`
      );
    }
    assert.ok(Math.abs(dot(column(fit.loadings, a), column(fit.loadings, a)) - 1) < 1e-12,
      `loading ${a + 1} is not a unit vector`);
  }

  // Scaled data has unit variance per column, so the eigenvalues sum to the
  // number of variables and the proportions sum to one.
  const total = fit.eigenvalues.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - fit.variables) < 1e-9, `eigenvalues sum to ${total}, not ${fit.variables}`);
  assert.ok(Math.abs(fit.cumulative[fit.cumulative.length - 1] - 1) < 1e-12);
  for (let i = 1; i < fit.eigenvalues.length; i += 1) {
    assert.ok(fit.eigenvalues[i] <= fit.eigenvalues[i - 1] + 1e-12, 'eigenvalues are not in descending order');
  }
});

test('a component sign is fixed, so the same data always draws the same figure', () => {
  const first = pca(IRIS, { scale: true });
  const second = pca(IRIS, { scale: true });
  assert.deepEqual(first.loadings, second.loadings);
  for (const loading of first.loadings[0].keys()) {
    const componentLoadings = first.loadings.map((row) => row[loading]);
    const biggest = componentLoadings.reduce((best, value) =>
      (Math.abs(value) > Math.abs(best) ? value : best), 0);
    assert.ok(biggest > 0, `component ${loading + 1} has a negative dominant loading`);
  }
});

test('a constant column is refused with a reason rather than dividing by zero', () => {
  const flat = IRIS.map((row) => [...row, 7]);
  assert.throws(() => pca(flat, { scale: true }), /no variation/);
  // Without scaling there is nothing to divide by, so it is allowed through
  // and simply contributes nothing.
  const fit = pca(flat, { scale: false });
  assert.ok(fit.eigenvalues[fit.eigenvalues.length - 1] < 1e-12);
});

test('the dendrogram leaf order is a permutation of the samples', () => {
  for (const linkage of ['average', 'complete', 'single', 'ward']) {
    const tree = hierarchicalCluster(IRIS, { linkage });
    const order = dendrogramOrder(tree.merges, tree.n);
    assert.deepEqual([...order].sort((a, b) => a - b), [...Array(IRIS.length).keys()],
      `${linkage} leaf order is not a permutation`);
    assert.equal(tree.heights.length, IRIS.length - 1);
    for (let i = 1; i < tree.heights.length; i += 1) {
      assert.ok(tree.heights[i] >= tree.heights[i - 1] - 1e-12,
        `${linkage} produced an inversion: a merge below the one before it`);
    }
  }
});

test('cutting the tree gives every sample exactly one cluster', () => {
  const tree = hierarchicalCluster(IRIS, { linkage: 'average' });
  for (let k = 1; k <= IRIS.length; k += 1) {
    const membership = cutTree(tree, k);
    assert.equal(membership.length, IRIS.length);
    assert.equal(new Set(membership).size, k, `cutting into ${k} gave ${new Set(membership).size} clusters`);
  }
  assert.throws(() => cutTree(tree, 0), /Cannot cut/);
  assert.throws(() => cutTree(tree, IRIS.length + 1), /Cannot cut/);
});

test('every distance is symmetric, non-negative, and zero only on the diagonal', () => {
  for (const metric of ['euclidean', 'manhattan', 'maximum', 'correlation']) {
    const d = distanceMatrix(IRIS, metric);
    for (let i = 0; i < d.length; i += 1) {
      assert.equal(d[i][i], 0, `${metric} has a non-zero diagonal`);
      for (let j = 0; j < d.length; j += 1) {
        assert.ok(d[i][j] >= 0, `${metric} produced a negative distance`);
        assert.ok(Math.abs(d[i][j] - d[j][i]) < 1e-12, `${metric} is not symmetric`);
      }
    }
  }
});

test('ANOSIM R stays in range and collapses when the labels mean nothing', () => {
  const separated = anosim(IRIS, SPECIES, { permutations: 199 });
  assert.ok(separated.statistic > 0.5, `R was ${separated.statistic} on well separated groups`);
  assert.ok(separated.statistic <= 1 && separated.statistic >= -1);

  // Labels assigned round-robin carry no information about the samples.
  const meaningless = IRIS.map((_, index) => ['a', 'b', 'c'][index % 3]);
  const noise = anosim(IRIS, meaningless, { permutations: 199 });
  assert.ok(Math.abs(noise.statistic) < 0.4, `R was ${noise.statistic} on meaningless labels`);
  assert.ok(noise.pValue > 0.05, `P was ${noise.pValue} on meaningless labels`);

  // A permutation p-value can never be zero: the observed arrangement is one
  // of the arrangements counted.
  assert.ok(separated.pValue >= 1 / 200);
});

test('PLS components are orthogonal and each is deflated out of the next', () => {
  const fit = plsda(IRIS, SPECIES, { components: 3 });
  for (let a = 0; a < fit.components; a += 1) {
    for (let b = a + 1; b < fit.components; b += 1) {
      const product = dot(column(fit.scores, a), column(fit.scores, b));
      assert.ok(Math.abs(product) < 1e-8,
        `components ${a + 1} and ${b + 1} share information: t'.t = ${product}`);
    }
    const weight = fit.loadings[a];
    assert.ok(Math.abs(Math.hypot(...weight) - 1) < 1e-10, `weight ${a + 1} is not a unit vector`);
  }
});

test('VIP scores average to one, which is what makes 1 the threshold', () => {
  const fit = plsda(IRIS, SPECIES, { components: 2 });
  const meanSquare = fit.vip.reduce((sum, value) => sum + value * value, 0) / fit.vip.length;
  assert.ok(Math.abs(meanSquare - 1) < 1e-9, `mean square VIP was ${meanSquare}`);
});

test('PLS-DA reports honest accuracy on labels that carry no information', () => {
  // Leave-one-out, so a model that has merely memorised its training data
  // cannot score well: on a table with more variables than samples the
  // resubstitution accuracy of a PLS-DA model is essentially always 100%.
  // Averaged over many random tables, because on any single small one the
  // accuracy is noisy in its own right.
  let state = 90210;
  const uniform = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const normal = () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());

  let total = 0;
  const trials = 40;
  for (let trial = 0; trial < trials; trial += 1) {
    const rows = Array.from({ length: 24 }, () => Array.from({ length: 30 }, normal));
    const labels = rows.map(() => (uniform() < 0.5 ? 'a' : 'b'));
    if (new Set(labels).size < 2) continue;
    total += plsda(rows, labels, { components: 2 }).accuracy;
  }
  const average = total / trials;
  assert.ok(average < 0.62, `leave-one-out accuracy averaged ${average.toFixed(3)} on pure noise`);
});

test('too few samples is refused with a count, not a crash', () => {
  assert.throws(() => pca([[1, 2], [3, 4]]), /at least three observations/);
  assert.throws(() => plsda([[1, 2], [3, 4]], ['a', 'b']), /Too few samples/);
  assert.throws(() => anosim(IRIS, SPECIES.map(() => 'same')), /two or more groups/);
});
