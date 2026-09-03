// Multivariate methods: principal components, hierarchical clustering with
// bootstrap support, ANOSIM and PLS-DA.
//
// Everything here works on a matrix given as an array of rows. Column vectors
// are avoided: laboratory data arrives one observation per row, and converting
// twice is how transposition bugs get in.

/** Column means of a row-major matrix. */
function columnMeans(rows) {
  const p = rows[0].length;
  const means = new Array(p).fill(0);
  for (const row of rows) for (let j = 0; j < p; j += 1) means[j] += row[j];
  return means.map((total) => total / rows.length);
}

function columnSds(rows, means) {
  const p = rows[0].length;
  const out = new Array(p).fill(0);
  for (const row of rows) for (let j = 0; j < p; j += 1) out[j] += (row[j] - means[j]) ** 2;
  return out.map((total) => Math.sqrt(total / (rows.length - 1)));
}

/**
 * Eigenvalues and eigenvectors of a symmetric matrix by the cyclic Jacobi
 * method. Slower than a tridiagonal reduction, but it is accurate to the last
 * bit on the small matrices a lab produces, and short enough to read.
 *
 * Returns eigenvalues in descending order with their eigenvectors as columns.
 */
export function symmetricEigen(input, tolerance = 1e-14, maxSweeps = 100) {
  const n = input.length;
  const a = input.map((row) => row.slice());
  const v = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) off += a[p][q] * a[p][q];
    }
    if (Math.sqrt(2 * off) < tolerance * Math.sqrt(a.reduce((sum, row, i) => sum + row[i] * row[i], 0) || 1)) break;

    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[y][y] - a[x][x]);
  return {
    values: order.map((index) => a[index][index]),
    vectors: Array.from({ length: n }, (_, row) => order.map((index) => v[row][index])),
  };
}

/**
 * Principal components of a matrix of observations.
 *
 * `scale` divides each column by its standard deviation, which is what you want
 * whenever the columns are in different units: without it the component with
 * the largest numbers wins regardless of what it means.
 *
 * Eigenvector signs are arbitrary. They are fixed here so the largest-magnitude
 * loading of each component is positive, which makes a figure reproducible.
 */
export function pca(rows, { scale = false } = {}) {
  const n = rows.length;
  const p = rows[0].length;
  if (n < 3) throw new Error(`Principal components need at least three observations; ${n} were given.`);
  if (p < 2) throw new Error('Principal components need at least two variables.');

  const means = columnMeans(rows);
  const sds = scale ? columnSds(rows, means) : new Array(p).fill(1);
  if (sds.some((sd) => !(sd > 0))) {
    throw new Error('A column has no variation, so it cannot be scaled. Remove it or turn scaling off.');
  }

  const centred = rows.map((row) => row.map((value, j) => (value - means[j]) / sds[j]));

  const covariance = Array.from({ length: p }, () => new Array(p).fill(0));
  for (const row of centred) {
    for (let i = 0; i < p; i += 1) {
      for (let j = i; j < p; j += 1) covariance[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < p; i += 1) {
    for (let j = i; j < p; j += 1) {
      covariance[i][j] /= n - 1;
      covariance[j][i] = covariance[i][j];
    }
  }

  const { values, vectors } = symmetricEigen(covariance);
  const eigenvalues = values.map((value) => Math.max(value, 0));

  const loadings = Array.from({ length: p }, (_, i) => vectors[i].slice());
  for (let component = 0; component < p; component += 1) {
    let biggest = 0;
    for (let i = 1; i < p; i += 1) {
      if (Math.abs(loadings[i][component]) > Math.abs(loadings[biggest][component])) biggest = i;
    }
    if (loadings[biggest][component] < 0) {
      for (let i = 0; i < p; i += 1) loadings[i][component] = -loadings[i][component];
    }
  }

  const total = eigenvalues.reduce((sum, value) => sum + value, 0);
  const scores = centred.map((row) =>
    Array.from({ length: p }, (_, component) =>
      row.reduce((sum, value, i) => sum + value * loadings[i][component], 0)));

  const explained = eigenvalues.map((value) => (total > 0 ? value / total : 0));
  const cumulative = [];
  explained.reduce((running, value) => {
    const next = running + value;
    cumulative.push(next);
    return next;
  }, 0);

  return {
    n,
    variables: p,
    scaled: scale,
    eigenvalues,
    standardDeviations: eigenvalues.map((value) => Math.sqrt(value)),
    explained,
    cumulative,
    loadings,
    scores,
    means,
    /** Components whose eigenvalue exceeds the average — the Kaiser rule. */
    kaiser: eigenvalues.filter((value) => value > total / p).length,
  };
}

const DISTANCES = {
  euclidean: (a, b) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0)),
  manhattan: (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0),
  maximum: (a, b) => a.reduce((worst, value, i) => Math.max(worst, Math.abs(value - b[i])), 0),
  correlation: (a, b) => {
    const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
    const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
    let cov = 0;
    let varA = 0;
    let varB = 0;
    for (let i = 0; i < a.length; i += 1) {
      cov += (a[i] - meanA) * (b[i] - meanB);
      varA += (a[i] - meanA) ** 2;
      varB += (b[i] - meanB) ** 2;
    }
    const denominator = Math.sqrt(varA * varB);
    return denominator > 0 ? 1 - cov / denominator : 1;
  },
};

export const DISTANCE_NAMES = Object.keys(DISTANCES);

/** Full distance matrix between the rows of a matrix. */
export function distanceMatrix(rows, metric = 'euclidean') {
  const measure = DISTANCES[metric];
  if (!measure) throw new Error(`Unknown distance "${metric}".`);
  const n = rows.length;
  const out = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      out[i][j] = measure(rows[i], rows[j]);
      out[j][i] = out[i][j];
    }
  }
  return out;
}

/**
 * Agglomerative hierarchical clustering.
 *
 * The merge sequence follows the convention R's hclust uses: negative numbers
 * are original observations, positive numbers are earlier merges. Ward's method
 * is ward.D2, which works on squared distances and is the one that actually
 * minimises the increase in within-cluster variance.
 */
export function hierarchicalCluster(rows, { metric = 'euclidean', linkage = 'average' } = {}) {
  const n = rows.length;
  if (n < 2) throw new Error('Clustering needs at least two observations.');

  const distance = distanceMatrix(rows, metric);
  const ward = linkage === 'ward';
  const d = distance.map((row, i) => row.map((value, j) => (ward && i !== j ? value * value : value)));

  const active = Array.from({ length: n }, (_, i) => i);
  const size = new Array(n).fill(1);
  const label = Array.from({ length: n }, (_, i) => -(i + 1));
  const merges = [];
  const heights = [];

  for (let step = 0; step < n - 1; step += 1) {
    let best = Infinity;
    let bestA = 0;
    let bestB = 1;
    for (let i = 0; i < active.length - 1; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const value = d[active[i]][active[j]];
        if (value < best) {
          best = value;
          bestA = i;
          bestB = j;
        }
      }
    }

    const a = active[bestA];
    const b = active[bestB];
    merges.push([label[a], label[b]].sort((x, y) => (x < 0 && y < 0 ? y - x : x - y)));
    heights.push(ward ? Math.sqrt(best) : best);

    for (const k of active) {
      if (k === a || k === b) continue;
      let updated;
      if (linkage === 'single') updated = Math.min(d[a][k], d[b][k]);
      else if (linkage === 'complete') updated = Math.max(d[a][k], d[b][k]);
      else if (linkage === 'average') {
        updated = (size[a] * d[a][k] + size[b] * d[b][k]) / (size[a] + size[b]);
      } else if (ward) {
        const total = size[a] + size[b] + size[k];
        updated = ((size[a] + size[k]) * d[a][k] + (size[b] + size[k]) * d[b][k] - size[k] * best) / total;
      } else {
        throw new Error(`Unknown linkage "${linkage}".`);
      }
      d[a][k] = updated;
      d[k][a] = updated;
    }

    size[a] += size[b];
    label[a] = step + 1;
    active.splice(bestB, 1);
  }

  return { merges, heights, metric, linkage, n, distance, order: dendrogramOrder(merges, n) };
}

/** Left-to-right leaf order, so a dendrogram draws without crossing branches. */
export function dendrogramOrder(merges, n) {
  const expand = (node) => {
    if (node < 0) return [-node - 1];
    const [left, right] = merges[node - 1];
    return [...expand(left), ...expand(right)];
  };
  return expand(merges.length);
}

/** Members of each cluster after cutting the tree into k groups. */
export function cutTree(tree, k) {
  const n = tree.n;
  if (k < 1 || k > n) throw new Error(`Cannot cut a tree of ${n} observations into ${k} clusters.`);

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  const members = (node) => (node < 0 ? [-node - 1] : (() => {
    const [left, right] = tree.merges[node - 1];
    return [...members(left), ...members(right)];
  })());

  for (let step = 0; step < n - k; step += 1) {
    const [left, right] = tree.merges[step];
    const a = find(members(left)[0]);
    const b = find(members(right)[0]);
    parent[b] = a;
  }

  const seen = new Map();
  return Array.from({ length: n }, (_, i) => {
    const root = find(i);
    if (!seen.has(root)) seen.set(root, seen.size + 1);
    return seen.get(root);
  });
}

/**
 * Bootstrap support for each split in the tree. Variables are resampled with
 * replacement, the tree is rebuilt, and each cluster is scored by how often the
 * same set of members appears again. A split below about 70 per cent is not
 * evidence of anything.
 */
export function bootstrapSupport(rows, { metric = 'euclidean', linkage = 'average', replicates = 500, random = Math.random } = {}) {
  const tree = hierarchicalCluster(rows, { metric, linkage });
  const p = rows[0].length;

  const membersOf = (merges, node) => (node < 0 ? [-node - 1] : (() => {
    const [left, right] = merges[node - 1];
    return [...membersOf(merges, left), ...membersOf(merges, right)];
  })());

  const key = (list) => list.slice().sort((a, b) => a - b).join(',');
  const observed = tree.merges.map((_, index) => key(membersOf(tree.merges, index + 1)));
  const counts = new Array(observed.length).fill(0);

  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const picks = Array.from({ length: p }, () => Math.floor(random() * p));
    const resampled = rows.map((row) => picks.map((index) => row[index]));
    let candidate;
    try {
      candidate = hierarchicalCluster(resampled, { metric, linkage });
    } catch {
      continue;
    }
    const present = new Set(candidate.merges.map((_, index) => key(membersOf(candidate.merges, index + 1))));
    observed.forEach((cluster, index) => {
      if (present.has(cluster)) counts[index] += 1;
    });
  }

  return {
    ...tree,
    replicates,
    support: counts.map((count) => count / replicates),
    clusters: observed.map((cluster) => cluster.split(',').map(Number)),
  };
}

/** Average of the ranks of tied values, used by ANOSIM. */
function rankWithTies(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    const mean = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k].index] = mean;
    i = j + 1;
  }
  return ranks;
}

function anosimStatistic(ranks, groups, n) {
  let within = 0;
  let withinCount = 0;
  let between = 0;
  let betweenCount = 0;
  let at = 0;
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (groups[i] === groups[j]) {
        within += ranks[at];
        withinCount += 1;
      } else {
        between += ranks[at];
        betweenCount += 1;
      }
      at += 1;
    }
  }
  if (!withinCount || !betweenCount) return null;
  return (between / betweenCount - within / withinCount) / (n * (n - 1) / 4);
}

/**
 * Analysis of similarities: are samples more alike within a group than between
 * groups? R runs from −1 to 1, and its p-value comes from permuting the group
 * labels, so no distributional assumption is made about the dissimilarities.
 */
export function anosim(rows, groups, { metric = 'euclidean', permutations = 999, random = Math.random } = {}) {
  const n = rows.length;
  if (n !== groups.length) throw new Error('Every row needs a group label.');
  const levels = [...new Set(groups)];
  if (levels.length < 2) throw new Error(`ANOSIM compares two or more groups; ${levels.length} was found.`);
  if (n < 4) throw new Error(`ANOSIM needs at least four samples; ${n} were given.`);

  const distance = distanceMatrix(rows, metric);
  const flat = [];
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) flat.push(distance[i][j]);
  }
  const ranks = rankWithTies(flat);
  const observed = anosimStatistic(ranks, groups, n);

  let atLeastAsExtreme = 0;
  const shuffled = groups.slice();
  for (let permutation = 0; permutation < permutations; permutation += 1) {
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const value = anosimStatistic(ranks, shuffled, n);
    if (value !== null && value >= observed) atLeastAsExtreme += 1;
  }

  return {
    n,
    groups: levels.length,
    statistic: observed,
    permutations,
    // The observed arrangement counts as one of the permutations, which keeps
    // the p-value from ever being exactly zero.
    pValue: (atLeastAsExtreme + 1) / (permutations + 1),
    metric,
  };
}

/**
 * Partial least squares discriminant analysis by NIPALS.
 *
 * Y is one column per class, coded 1 for membership. Classification is by
 * nearest predicted class score, and the reported accuracy is leave-one-out,
 * because the resubstitution accuracy of a PLS-DA model is almost always 100
 * per cent and means nothing.
 */
export function plsda(rows, labels, { components = 2, iterations = 200, tolerance = 1e-10 } = {}) {
  const n = rows.length;
  if (n !== labels.length) throw new Error('Every row needs a class label.');
  const classes = [...new Set(labels)];
  if (classes.length < 2) throw new Error('PLS-DA needs at least two classes.');
  if (n < classes.length + 2) throw new Error(`Too few samples: ${n} rows across ${classes.length} classes.`);

  const p = rows[0].length;
  const maxComponents = Math.max(1, Math.min(components, p, n - 1));

  const fit = (trainRows, trainLabels) => {
    const means = columnMeans(trainRows);
    const sds = columnSds(trainRows, means).map((sd) => (sd > 0 ? sd : 1));
    const X = trainRows.map((row) => row.map((value, j) => (value - means[j]) / sds[j]));
    const Y = trainLabels.map((label) => classes.map((name) => (label === name ? 1 : 0)));
    const yMeans = columnMeans(Y);
    const Yc = Y.map((row) => row.map((value, j) => value - yMeans[j]));

    const weights = [];
    const loadings = [];
    const yLoadings = [];
    const scores = [];

    let Xr = X.map((row) => row.slice());
    let Yr = Yc.map((row) => row.slice());

    for (let component = 0; component < maxComponents; component += 1) {
      let u = Yr.map((row) => row[0]);
      let w = new Array(p).fill(0);
      let t = new Array(n).fill(0);
      let q = new Array(classes.length).fill(0);

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        w = new Array(p).fill(0);
        for (let i = 0; i < Xr.length; i += 1) {
          for (let j = 0; j < p; j += 1) w[j] += Xr[i][j] * u[i];
        }
        const wNorm = Math.hypot(...w);
        if (!(wNorm > 0)) break;
        w = w.map((value) => value / wNorm);

        t = Xr.map((row) => row.reduce((sum, value, j) => sum + value * w[j], 0));
        const tt = t.reduce((sum, value) => sum + value * value, 0);
        if (!(tt > 0)) break;

        q = new Array(classes.length).fill(0);
        for (let i = 0; i < Yr.length; i += 1) {
          for (let j = 0; j < classes.length; j += 1) q[j] += Yr[i][j] * t[i];
        }
        q = q.map((value) => value / tt);

        const qq = q.reduce((sum, value) => sum + value * value, 0);
        const next = qq > 0 ? Yr.map((row) => row.reduce((sum, value, j) => sum + value * q[j], 0) / qq) : u;
        const change = Math.hypot(...next.map((value, i) => value - u[i]));
        u = next;
        if (change < tolerance) break;
      }

      const tt = t.reduce((sum, value) => sum + value * value, 0);
      if (!(tt > 0)) break;
      const pLoading = new Array(p).fill(0);
      for (let i = 0; i < Xr.length; i += 1) {
        for (let j = 0; j < p; j += 1) pLoading[j] += Xr[i][j] * t[i];
      }
      const loading = pLoading.map((value) => value / tt);

      Xr = Xr.map((row, i) => row.map((value, j) => value - t[i] * loading[j]));
      Yr = Yr.map((row, i) => row.map((value, j) => value - t[i] * q[j]));

      weights.push(w);
      loadings.push(loading);
      yLoadings.push(q);
      scores.push(t);
    }

    return { means, sds, weights, loadings, yLoadings, yMeans, classes };
  };

  const predict = (model, row) => {
    const centred = row.map((value, j) => (value - model.means[j]) / model.sds[j]);
    const residual = centred.slice();
    const predicted = model.yMeans.slice();
    for (let component = 0; component < model.weights.length; component += 1) {
      const t = residual.reduce((sum, value, j) => sum + value * model.weights[component][j], 0);
      for (let j = 0; j < residual.length; j += 1) residual[j] -= t * model.loadings[component][j];
      for (let j = 0; j < predicted.length; j += 1) predicted[j] += t * model.yLoadings[component][j];
    }
    let best = 0;
    for (let j = 1; j < predicted.length; j += 1) if (predicted[j] > predicted[best]) best = j;
    return { predicted, label: model.classes[best] };
  };

  const model = fit(rows, labels);

  let correct = 0;
  for (let held = 0; held < n; held += 1) {
    const trainRows = rows.filter((_, index) => index !== held);
    const trainLabels = labels.filter((_, index) => index !== held);
    if (new Set(trainLabels).size < classes.length) continue;
    const trained = fit(trainRows, trainLabels);
    if (predict(trained, rows[held]).label === labels[held]) correct += 1;
  }

  // Variable importance in projection: how much each variable contributes,
  // across components, to explaining the class separation.
  const componentCount = model.scores ? model.scores.length : model.weights.length;
  const explained = model.weights.map((_, component) => {
    const q = model.yLoadings[component];
    return q.reduce((sum, value) => sum + value * value, 0);
  });
  const totalExplained = explained.reduce((sum, value) => sum + value, 0) || 1;
  const vip = Array.from({ length: p }, (_, j) => {
    const total = model.weights.reduce(
      (sum, w, component) => sum + explained[component] * w[j] * w[j], 0);
    return Math.sqrt((p * total) / totalExplained);
  });

  const scores = rows.map((row) => {
    const centred = row.map((value, j) => (value - model.means[j]) / model.sds[j]);
    const residual = centred.slice();
    return model.weights.map((w, component) => {
      const t = residual.reduce((sum, value, j) => sum + value * w[j], 0);
      for (let j = 0; j < residual.length; j += 1) residual[j] -= t * model.loadings[component][j];
      return t;
    });
  });

  return {
    n,
    classes,
    components: model.weights.length,
    scores,
    loadings: model.weights,
    vip,
    accuracy: correct / n,
    // The rate you would get by always guessing the commonest class. An
    // accuracy below this is worse than useless.
    baseline: Math.max(...classes.map((name) => labels.filter((label) => label === name).length)) / n,
  };
}
