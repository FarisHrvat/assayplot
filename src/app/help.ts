import { type Method, type TableShape } from './model.ts';

export interface MethodHelp {
  /** What question it answers, in one sentence. */
  answers: string;
  /** The layout it expects. */
  needs: string;
  /** What must be true of the data for the answer to mean anything. */
  assumes: string[];
  /** What it does not do, so nobody reads more into it than it says. */
  doesNot: string[];
  /** Steps, from a table to a result. */
  how: string[];
  /** What to put in the paper. */
  reports: string;
  /** When something else would be the better choice. */
  insteadUse?: string;
}

export const SHAPE_HELP: Record<TableShape, { title: string; body: string; example: string }> = {
  column: {
    title: 'Column',
    body:
      'One column per treatment, one row per replicate. The layout most bench notebooks already use, ' +
      'and the one to pick when you are comparing groups. Columns may have different numbers of ' +
      'values; blanks are ignored rather than treated as zero.',
    example: 'Vehicle   Drug 1 µM   Drug 10 µM\n92        78          61\n88        74          58\n95        81          66',
  },
  grouped: {
    title: 'Grouped',
    body:
      'For two factors at once. The first column names the row factor and the remaining columns are ' +
      'the levels of the second. Repeat a row label to enter replicates — that is what gives two-way ' +
      'ANOVA the within-cell variation it needs.',
    example: 'Sex      Control   Low   High\nMale     12        18    25\nMale     14        20    27\nFemale   10        15    19\nFemale   11        17    21',
  },
  xy: {
    title: 'XY',
    body:
      'Paired measurements. The first column is X and every other column is a Y series measured at ' +
      'those X values. Rows missing either value are left out rather than counted as zero.',
    example: 'Concentration   Response\n0.5             6.1\n5               13.4\n50              52.0\n500             91.7',
  },
  survival: {
    title: 'Survival',
    body:
      'One row per subject. Time is how long they were followed, the event column is 1 if the event ' +
      'happened and 0 if they were censored — still event-free when you last saw them — and the group ' +
      'column says which arm they were in. Words like "died" and "censored" are understood too.',
    example: 'Days   Event   Arm\n12     1       Vehicle\n20     0       Vehicle\n26     1       Drug\n60     0       Drug',
  },
};

export const METHOD_HELP: Record<Method, MethodHelp> = {
  mixed: {
    answers: 'Did the measurement change across conditions, using every value each subject gave?',
    needs: 'One row per subject, one column per condition. Blanks are fine.',
    assumes: [
      'Each subject contributes a constant offset of their own — some people simply read high, others low.',
      'The residual scatter is roughly normal and of similar size in every condition.',
      'Missing values are missing for reasons unrelated to what the value would have been.',
    ],
    doesNot: [
      'Discard a subject who missed one measurement, which is what repeated-measures ANOVA has to do.',
      'Model anything more complicated than one offset per subject. Two crossed random effects need a specialist tool.',
    ],
    how: [
      'Lay the table out with subjects down the rows and conditions across the columns.',
      'Pick Mixed-effects model. Leave the blanks blank.',
      'Read the F for the condition effect, then the per-condition contrasts beneath it.',
    ],
    reports: 'The fixed-effect estimates with standard errors, F with both degrees of freedom, P, and the two variance components. Say which software fitted it and that estimation was REML.',
    insteadUse: 'Repeated-measures ANOVA only if the design is complete and balanced, in which case the two agree exactly.',
  },

  gee: {
    answers: 'On average across the population, how does the outcome change with the predictor when measurements are clustered?',
    needs: 'One row per measurement: the outcome, a column naming the subject or cluster, and one or more predictors.',
    assumes: [
      'The mean model is right. The correlation structure need not be: the standard errors are robust to getting it wrong.',
      'Clusters are independent of one another, even though measurements inside one are not.',
      'Enough clusters for the robust variance to settle down — about forty is the usual advice, and fewer than fifteen is uncomfortable.',
    ],
    doesNot: [
      'Estimate what happens within one subject. That is what a mixed model does, and for a binary outcome the two answers genuinely differ.',
      'Handle missing values that depend on the unobserved outcome.',
    ],
    how: [
      'Choose the outcome column and the column naming the cluster under Options.',
      'Every other selected column is a predictor.',
      'Read the coefficients: they are population-average effects with sandwich standard errors.',
    ],
    reports: 'Coefficients with robust standard errors and confidence intervals, the working correlation used, and the number of clusters.',
    insteadUse: 'A mixed-effects model when the question is about change within an individual rather than a shift in the population average.',
  },

  pca: {
    answers: 'How many independent things is this table actually measuring, and which variables move together?',
    needs: 'One row per sample, one column per measured variable.',
    assumes: [
      'The interesting structure is linear. Components are straight-line combinations of the variables.',
      'Scaling is a decision, not a detail: without it the variable with the largest numbers dominates regardless of what it means.',
    ],
    doesNot: [
      'Test anything. There is no p-value in a PCA and none is implied.',
      'Know about your groups. It finds the directions of most variance, which need not be the directions that separate treatments.',
    ],
    how: [
      'Pick Principal component analysis, and turn on scaling if the columns are in different units.',
      'Read the scree: how much variance each component explains, and how quickly it falls off.',
      'Read the loadings to see which variables define each component.',
    ],
    reports: 'The percentage of variance explained by each retained component, the scaling used, and the loadings of the components you interpret.',
    insteadUse: 'PLS-DA when you want the directions that separate known groups rather than the directions of most variance.',
  },

  cluster: {
    answers: 'Which samples group together, and is the grouping real?',
    needs: 'One row per sample, one column per variable.',
    assumes: [
      'The distance chosen reflects what you mean by similar. Euclidean distance treats a large variable as more important; correlation distance treats shape as what matters.',
      'Every clustering method returns clusters, including on noise. The bootstrap is what separates a branch from an artefact.',
    ],
    doesNot: [
      'Decide how many clusters there are. Cutting the tree is your judgement, informed by the support values.',
      'Test whether groups differ. Use ANOSIM for that.',
    ],
    how: [
      'Choose a distance and a linkage; average linkage on Euclidean distance is the usual default.',
      'Read the bootstrap support beside each branch.',
      'Treat anything under about 70 per cent as undecided.',
    ],
    reports: 'The distance, the linkage, the number of bootstrap replicates, and the support for every branch you draw a conclusion from.',
  },

  anosim: {
    answers: 'Are samples within a group more alike than samples from different groups?',
    needs: 'One row per sample, one column naming its group, and the measured variables in the rest.',
    assumes: [
      'The dissimilarities are meaningful. Everything else is handled by permuting the labels.',
      'Groups are of roughly similar spread — a group that is simply more variable can produce a large R on its own.',
    ],
    doesNot: [
      'Say which variables drive the separation, or by how much. R measures separation, not effect size in any unit you can report.',
    ],
    how: [
      'Choose the column that names the group under Options.',
      'Read R: near 0 means the groups are indistinguishable, near 1 means every sample is closer to its own group than to any other.',
    ],
    reports: 'R, the number of permutations, and P. Say which dissimilarity was used.',
  },

  plsda: {
    answers: 'Can these variables tell my classes apart, and which ones do the work?',
    needs: 'One row per sample, one column naming its class, the measured variables in the rest.',
    assumes: [
      'Nothing distributional, but a great deal about honesty: with more variables than samples a PLS-DA model can separate anything, including random noise.',
    ],
    doesNot: [
      'Prove the classes differ. Only the cross-validated accuracy speaks to that, and it must beat the rate you would get by guessing the commonest class.',
      'Give a p-value. If you need one, permute the labels and refit.',
    ],
    how: [
      'Choose the column naming the class under Options.',
      'Compare the leave-one-out accuracy against the baseline shown beside it.',
      'Read the VIP scores: above 1 marks a variable that contributes more than its share.',
    ],
    reports: 'The number of components, the cross-validated accuracy against the baseline rate, and the variables with VIP above 1.',
    insteadUse: 'PCA first, always. If the classes already separate without being told about, the supervised model is not doing the work.',
  },

  tdt: {
    answers: 'Is this allele transmitted to affected children more often than chance?',
    needs: 'The count of heterozygous parents who transmitted the allele and the count who did not.',
    assumes: [
      'Parents are heterozygous at the marker; homozygous parents carry no information and are excluded.',
      'One affected child per family, or the correlation between siblings has to be accounted for.',
    ],
    doesNot: [
      'Suffer from population structure. That is the whole point: each parent is their own control.',
      'Distinguish linkage from association on its own in a single family study.',
    ],
    how: [
      'Count the transmissions and enter both numbers under Options.',
      'Read the chi-square on one degree of freedom and the transmission ratio.',
    ],
    reports: 'Both counts, chi-square, P, and the transmission ratio with its confidence interval.',
  },

  mendelian: {
    answers: 'Does the exposure cause the outcome, judged from genetic variants that affect the exposure?',
    needs: 'One row per instrument: its effect on the exposure, its effect on the outcome, and the standard error of that outcome effect.',
    assumes: [
      'Every instrument really does affect the exposure. Weak ones bias the answer towards the confounded association.',
      'No instrument affects the outcome except through the exposure. This is the assumption that fails, and MR-Egger exists to detect it.',
      'No instrument shares a confounder with the outcome.',
    ],
    doesNot: [
      'Prove causation. It tests one causal model against a very specific set of assumptions, none of which can be verified from the data alone.',
    ],
    how: [
      'Put the three columns in the table in that order, or select them under Columns used.',
      'Compare the three estimates. Agreement between them is the evidence; disagreement means pleiotropy.',
      'Check the MR-Egger intercept: if it differs from zero, the IVW estimate is biased.',
    ],
    reports: 'All three estimates with confidence intervals, the MR-Egger intercept and its P value, and the heterogeneity statistic.',
  },

  simon: {
    answers: 'How many patients does a single-arm phase II trial need, and when may it stop early?',
    needs: 'No data. Two response rates: the one not worth pursuing, and the one that is.',
    assumes: [
      'A binary response assessed the same way in every patient.',
      'Accrual can pause while stage one is assessed, which in practice is the hard part.',
    ],
    doesNot: [
      'Allow stopping early for a good result. Both designs stop only for futility.',
      'Cover randomised trials, or continuous outcomes.',
    ],
    how: [
      'Enter both response rates and the error rates you will accept.',
      'The optimal design has the smallest expected size if the drug does not work; the minimax design has the smallest maximum size.',
    ],
    reports: 'Both stages as r1/n1 and r/n, the expected sample size under the null, the chance of stopping early, and the exact size and power achieved.',
  },

  rout: {
    answers: 'Which of these points are outliers, without one outlier hiding another?',
    needs: 'One or more columns of measurements.',
    assumes: [
      'The points that are not outliers are roughly normal around a common value.',
      'Q is a false discovery rate: at 1 per cent, about one in a hundred flagged points is expected to be a false alarm.',
    ],
    doesNot: [
      'Give you permission to delete data. An outlier is a question about the experiment, not a licence to remove an inconvenient number.',
      'Work on values that are legitimately skewed, such as concentrations, unless they are transformed first.',
    ],
    how: [
      'Pick ROUT and set Q, usually 1 per cent.',
      'Look at every flagged point and decide, from the experiment rather than the statistics, whether it is a mistake.',
      'If you exclude a point, say so in the paper and say why.',
    ],
    reports: 'The value of Q, how many points were flagged, and what was done about each. Analyses with and without them is better still.',
    insteadUse: "Grubbs's test if you are looking for exactly one outlier and want the classical test.",
  },

  descriptive: {
    answers: 'What do these columns look like?',
    needs: 'Any Column, Grouped or XY table.',
    assumes: ['Nothing. Every number is described as it is.'],
    doesNot: ['Test anything. There is no p-value here, and none is implied.'],
    how: ['Press Analyse and pick Descriptive statistics.', 'Every column gets n, mean, SD, SEM, median, range and a 95% confidence interval.'],
    reports: 'Report mean ± SD for roughly symmetric data, or median with range when it is skewed. Say which you used.',
  },

  onesample: {
    answers: 'Is this group different from a specific number I care about?',
    needs: 'One column of measurements.',
    assumes: ['The values are roughly normal.', 'They are independent — one measurement per subject, not repeated readings of the same one.'],
    doesNot: ['Compare two groups. For that use a two-sample test.'],
    how: ['Pick One-sample t-test.', 'Type the value to compare against in Options — a known standard, a theoretical 100%, or zero for a change score.'],
    reports: 'The mean, its 95% confidence interval, the value tested against, t, df and P.',
  },

  welch: {
    answers: 'Do these two independent groups differ on average?',
    needs: 'Exactly two columns of measurements.',
    assumes: ['The two groups are independent — different subjects in each.', 'Each is roughly normal. With very small n this is hard to check, so lean on what you know about the measurement.'],
    doesNot: ['Assume the two groups have the same spread. That is why it is the safer default.'],
    how: ['Pick Welch t-test.', 'If the table has more than two columns, tick exactly two under "Columns used".'],
    reports: 'The difference of means with its 95% confidence interval, then t, df and P. The confidence interval matters more than the P value.',
    insteadUse: "Student's t-test only if you have a real reason to believe the variances are equal; the gain is tiny and the risk is not.",
  },

  student: {
    answers: 'Do these two independent groups differ on average, assuming equal spread?',
    needs: 'Exactly two columns.',
    assumes: ['Independence and rough normality, as for Welch.', 'The two groups have the same variance. Check this with Levene before relying on it.'],
    doesNot: ['Protect you when the variances differ, particularly with unequal group sizes.'],
    how: ['Run Levene first.', 'If the variances look comparable, pick Student\'s t-test; otherwise use Welch.'],
    reports: 'Difference of means, 95% CI, t, df and P, and state that equal variances were assumed.',
    insteadUse: 'Welch t-test, unless you specifically need the pooled-variance version.',
  },

  paired: {
    answers: 'Did the same subjects change between two conditions?',
    needs: 'Two columns, one row per subject, in matching order.',
    assumes: ['Each row is one subject measured twice.', 'The differences are roughly normal — not the raw values.'],
    doesNot: ['Work if the rows are not aligned. A row with a value in only one column is dropped.'],
    how: ['Put "before" in one column and "after" in the other, one subject per row.', 'Pick Paired t-test.', 'Plot it as Before / after lines to see each subject.'],
    reports: 'The mean difference with its 95% CI, t, df and P, and how many subjects.',
    insteadUse: 'Wilcoxon signed-rank when the differences are clearly not normal.',
  },

  mannwhitney: {
    answers: 'Do these two independent groups differ, without assuming a distribution?',
    needs: 'Exactly two columns.',
    assumes: ['Independence.', 'That comparing ranks is meaningful — the measurement is at least ordinal.'],
    doesNot: [
      'Compare means. It compares whole distributions, so a significant result means they differ somewhere, not necessarily in the middle.',
      'Fix small samples. With three per group almost nothing reaches significance whatever the test.',
    ],
    how: ['Pick Mann–Whitney U.', 'With no ties and a small sample the exact test is used, as R does; otherwise a normal approximation with continuity correction. The result says which.'],
    reports: 'The medians of both groups, U, and P, and say whether the exact or approximate version was used.',
  },

  wilcoxon: {
    answers: 'Did the same subjects change, without assuming normal differences?',
    needs: 'Two columns, one row per subject, in matching order.',
    assumes: ['Paired rows.', 'The differences are symmetric about their median.'],
    doesNot: ['Use pairs whose difference is exactly zero — those rows drop out, reducing n.'],
    how: ['Lay the data out as for a paired t-test.', 'Pick Wilcoxon signed-rank.'],
    reports: 'The median difference, V, and P.',
  },

  anova: {
    answers: 'Do three or more independent groups differ anywhere?',
    needs: 'Three or more columns of measurements.',
    assumes: ['Independent groups.', 'Roughly normal within each group.', 'Comparable spread across groups — check with Levene.'],
    doesNot: [
      'Tell you which groups differ. That is what the post-hoc test is for.',
      'Survive being run once per pair instead. Doing three t-tests instead of one ANOVA inflates your false-positive rate.',
    ],
    how: [
      'Put each group in its own column.',
      'Pick One-way ANOVA. Tukey HSD is selected by default and compares every pair.',
      'Point a figure at the analysis to get significance brackets.',
    ],
    reports: 'F with both degrees of freedom and the overall P, then the post-hoc comparisons with their adjusted P values, naming the correction.',
    insteadUse: 'Kruskal–Wallis if the groups are clearly not normal, or Friedman if the same subjects appear in every condition.',
  },

  kruskal: {
    answers: 'Do three or more independent groups differ, without assuming normality?',
    needs: 'Three or more columns.',
    assumes: ['Independent groups.', 'Ranks are meaningful.'],
    doesNot: ['Say which groups differ — use the Dunn post-hoc, which is offered by default.'],
    how: ['Pick Kruskal–Wallis.', "Leave the post-hoc on Dunn's test, which is the rank-based partner for it."],
    reports: "H, df and P, then Dunn's comparisons with adjusted P values.",
  },

  friedman: {
    answers: 'Did the same subjects differ across three or more conditions?',
    needs: 'Three or more columns, one row per subject, complete across every condition.',
    assumes: ['Every row is one subject measured under all conditions.'],
    doesNot: ['Use incomplete rows. A subject missing one condition is dropped entirely, and you are told how many.'],
    how: ['One subject per row, one condition per column.', 'Pick Friedman.'],
    reports: 'χ², df and P, the number of subjects, and the pairwise follow-ups with their correction.',
  },

  twoway: {
    answers: 'Do two factors each matter, and does one depend on the other?',
    needs: 'A Grouped table: row factor in the first column, second factor across the others.',
    assumes: ['The same number of observations in every combination.', 'Roughly normal residuals, comparable spread.'],
    doesNot: ['Handle repeated measures. Every observation must be a separate subject.'],
    how: [
      'Switch the table shape to Grouped.',
      'Name the row factor in the first column, repeating a label for each replicate.',
      'Pick Two-way ANOVA.',
    ],
    reports: 'F, both degrees of freedom and P for each main effect and for the interaction. If the interaction is significant, interpret the main effects with care — the effect of one factor depends on the other.',
  },

  correlation: {
    answers: 'Do these two variables move together linearly?',
    needs: 'An XY table.',
    assumes: ['Paired observations.', 'A roughly linear relationship.', 'No single point dominating.'],
    doesNot: ['Show causation.', 'Detect a curved relationship — r can be near zero for a strong U shape.'],
    how: ['Use an XY table.', 'Pick Pearson correlation.', 'Look at the scatter plot before quoting r.'],
    reports: 'r, n and P. Show the scatter plot alongside it.',
    insteadUse: 'Spearman if the relationship is monotone but not straight, or if outliers dominate.',
  },

  spearman: {
    answers: 'Do these two variables move together, in any consistent direction?',
    needs: 'An XY table.',
    assumes: ['Paired observations.', 'A monotone relationship, not necessarily a straight one.'],
    doesNot: ['Measure how steep the relationship is — only how consistently it goes one way.'],
    how: ['Use an XY table.', 'Pick Spearman rank correlation. For nine or fewer pairs without ties, the exact permutation P value is used.'],
    reports: 'rho, n and P.',
  },

  regression: {
    answers: 'How much does Y change per unit of X?',
    needs: 'An XY table.',
    assumes: ['Y depends on X, not the other way round.', 'Scatter about the line is roughly constant across the range.'],
    doesNot: ['Extrapolate. The fit says nothing outside the range of X you measured.'],
    how: ['Use an XY table.', 'Pick Simple linear regression. The fitted line is drawn over the scatter.'],
    reports: 'The slope with its 95% confidence interval, the intercept, R² and n. The slope and its interval are the result; R² alone is not.',
  },

  doseresponse: {
    answers: 'What concentration gives a half-maximal response?',
    needs: 'An XY table with concentration in X.',
    assumes: ['The response is sigmoid in log concentration.', 'Enough points on both plateaus and through the middle to pin all four parameters.'],
    doesNot: [
      'Report a confidence interval on the EC50 yet. Treat it as a point estimate.',
      'Compare two curves statistically.',
      'Use a zero-dose control — zero has no place on a log axis. Those rows are dropped and counted.',
    ],
    how: [
      'Put concentration in X and response in Y.',
      'Pick Dose–response curve. Tick "X is already on a log scale" if your column holds log₁₀ values.',
      'Turn on Log scale on X in the figure to get the familiar sigmoid.',
    ],
    reports: 'EC50 or IC50 in concentration units, the Hill slope, Top and Bottom, R² and n. Say how many points and whether any were excluded.',
  },

  chisq: {
    answers: 'Are these categorical counts distributed independently?',
    needs: 'A table of counts — whole numbers of things, not measurements.',
    assumes: ['Each observation falls in exactly one cell.', 'Observations are independent.', 'Expected counts of about 5 or more.'],
    doesNot: ['Work on percentages, means, or measurements. Only counts.'],
    how: ['Enter counts, one row per category of one variable and one column per category of the other.', 'Pick Chi-square. Yates\' correction is applied automatically to a 2 × 2 table.'],
    reports: 'χ², df, P, and the sample size. Say whether the correction was applied.',
    insteadUse: "Fisher's exact test when any expected count is below about 5 — you are warned when that happens.",
  },

  fisher: {
    answers: 'Are these counts in a 2 × 2 table independent, when the numbers are small?',
    needs: 'Exactly a 2 × 2 table of counts.',
    assumes: ['Independent observations.', 'Fixed margins, strictly — in practice it is used more widely and is conservative.'],
    doesNot: ['Extend beyond 2 × 2 here.'],
    how: ['Enter a 2 × 2 table of counts.', 'Pick Fisher\'s exact test.'],
    reports: 'The two-sided P and an odds ratio. Two odds ratios are shown: the cross-product, the textbook estimate, and the conditional maximum-likelihood estimate, which R reports. Say which you quote.',
  },

  survival: {
    answers: 'How long do subjects last, and does the treatment change that?',
    needs: 'A Survival table: time, a 0/1 event indicator, and a group.',
    assumes: [
      'Censoring is unrelated to outcome — a subject lost to follow-up was not lost because they were about to have the event.',
      'The event is defined the same way for everyone.',
    ],
    doesNot: ['Adjust for other variables. That needs Cox regression, which is not implemented.'],
    how: [
      'Switch the table shape to Survival.',
      'Enter one row per subject: time, 1 for the event or 0 for censored, and the arm.',
      'Pick Kaplan–Meier survival. With exactly two groups a log-rank test is run.',
    ],
    reports: 'Median survival per group with the number of events and the number censored, then the log-rank χ² and P. Show the curve with censoring ticks.',
  },

  normality: {
    answers: 'Is there evidence these values are not normal?',
    needs: 'Any Column table.',
    assumes: ['Independent observations.'],
    doesNot: [
      'Prove normality. A large P value means only that departure was not detected.',
      'Have much power below about 20 values — which is most lab experiments. You are warned when that applies.',
    ],
    how: ['Pick Normality (Shapiro–Wilk). Every column is tested separately.', 'Look at a Q–Q plot as well; it shows how the data depart, not just whether.'],
    reports: 'Usually nothing. It informs your choice of test rather than being a result itself.',
  },

  variance: {
    answers: 'Do these groups have comparable spread?',
    needs: 'Two or more columns.',
    assumes: ['Independent groups.'],
    doesNot: ['Say anything about the means.'],
    how: ['Pick Equal variances. Levene (centred on the median) and Bartlett are both reported.', 'Prefer Levene: it is far less sensitive to non-normality.'],
    reports: "Usually nothing directly, but it justifies choosing Welch over Student's.",
  },

  logistic: {
    answers: 'Which factors change the odds of a yes/no outcome?',
    needs: 'One row per subject: a column of 0 and 1 for the outcome, and one column per predictor.',
    assumes: [
      'Observations are independent — one row per subject, not repeated measures.',
      'The log odds change linearly with each continuous predictor.',
      'Roughly ten of the rarer outcome per predictor. Fewer and the estimates are unstable.',
    ],
    doesNot: [
      'Handle a group that is perfectly separated by a predictor: the coefficient runs to infinity and the fit fails with an explanation.',
      'Prove causation, however many covariates are added.',
    ],
    how: [
      'One row per subject, one column per variable.',
      'Pick Logistic regression and say which column is the outcome.',
      'Read the odds ratios rather than the raw coefficients.',
    ],
    reports: 'Each odds ratio with its 95% confidence interval and P, the number of subjects and events, and the area under the ROC curve.',
  },

  poisson: {
    answers: 'What changes the rate at which something happens?',
    needs: 'One row per observation: a column of whole counts, and one column per predictor.',
    assumes: ['Counts are independent.', 'The variance equals the mean — real counts are often more variable, and you are told when they are.'],
    doesNot: ['Fit proportions or measurements. The outcome must be a count of events.'],
    how: ['One row per observation.', 'Pick Poisson regression and say which column holds the counts.'],
    reports: 'Rate ratios with their confidence intervals, and the dispersion. If the counts are overdispersed, say so and consider a negative binomial model.',
  },

  ancova: {
    answers: 'Do the groups differ once a covariate is accounted for?',
    needs: 'One row per subject: the outcome, a continuous covariate, and a column naming the group.',
    assumes: [
      'The covariate relates to the outcome the same way in every group — the regression lines are parallel.',
      'The covariate was not affected by the treatment. Adjusting for something the treatment changed removes part of the effect you are trying to measure.',
    ],
    doesNot: ['Rescue a badly unbalanced experiment. Adjusting for a covariate is not the same as having randomised on it.'],
    how: [
      'One row per subject, with the group named in its own column.',
      'Pick ANCOVA and choose the outcome, the covariate and the group column.',
      'Read the adjusted means: the group means as if every subject had the same covariate value.',
    ],
    reports: 'The group F with both degrees of freedom and P, the adjusted means, and the covariate slope.',
  },

  cox: {
    answers: 'Which factors change the hazard of the event over time?',
    needs: 'A Survival table — time, event, group — plus one or more predictor columns.',
    assumes: [
      'Hazards stay proportional: the ratio between two subjects does not change over time.',
      'Censoring is unrelated to outcome.',
      'Roughly ten events per predictor.',
    ],
    doesNot: ['Check the proportional hazards assumption for you. Look at the survival curves: if they cross, the assumption has failed and a hazard ratio is not a meaningful summary.'],
    how: [
      'Set the table shape to Survival and add predictor columns.',
      'Pick Cox proportional hazards and choose the predictors.',
    ],
    reports: 'Hazard ratios with their confidence intervals and P, the number of subjects and events, and a note on whether proportional hazards was checked.',
  },

  mcnemar: {
    answers: 'Did the same subjects change between two conditions?',
    needs: 'A 2 × 2 table of paired counts: both positive, both negative, and the two ways of disagreeing.',
    assumes: ['Each count is a pair of observations on the same subject, not two independent subjects.'],
    doesNot: ['Use the agreeing pairs. Only the ones who changed carry information, which is why the two diagonal cells never enter the statistic.'],
    how: [
      'Lay out a 2 × 2 table of counts.',
      "Pick McNemar's test. Below about 25 discordant pairs the exact binomial is used instead of the chi-square approximation.",
    ],
    reports: 'The counts of each kind of discordant pair, the statistic and P, and the odds ratio.',
    insteadUse: "A chi-square test if the two samples are independent rather than paired — McNemar's is for the same subjects twice.",
  },

  kappa: {
    answers: 'Do two raters agree more than chance would give?',
    needs: 'A square table of counts: the same categories down and across, each cell one pair of verdicts.',
    assumes: ['Both raters used the same categories.', 'Subjects were rated independently of one another.'],
    doesNot: [
      'Say who is right. Two raters can agree perfectly and both be wrong.',
      'Handle ordered categories unless you choose a weighting: unweighted kappa treats being one category out the same as being three out.',
    ],
    how: ['Enter the cross-tabulation of the two raters.', "Pick Cohen's kappa."],
    reports: 'Kappa with its 95% confidence interval and the number of subjects. Raw percentage agreement alone is misleading when one category dominates.',
  },

  blandaltman: {
    answers: 'Can this new method replace the old one?',
    needs: 'Two columns measuring the same subjects by two methods, one subject per row.',
    assumes: ['The differences are roughly normal.', 'Rows are aligned: each row is one subject measured twice.'],
    doesNot: [
      'Tell you whether the agreement is good enough. That is a clinical judgement about how large a difference matters, made before you look.',
      'Work as a correlation. Two methods can correlate perfectly and disagree by a constant amount.',
    ],
    how: [
      'Put the two methods in two columns.',
      'Pick Bland–Altman, then plot it as a Bland–Altman figure to see the differences against the average.',
    ],
    reports: 'The bias with its confidence interval and the 95% limits of agreement, plus whether the disagreement changes across the range.',
  },

  tost: {
    answers: 'Are these two groups close enough to be called equivalent?',
    needs: 'Two columns, and a bound: the largest difference you would still call equivalent.',
    assumes: ['The bound was decided before seeing the data, on scientific grounds rather than statistical ones.'],
    doesNot: ['Follow from a non-significant t-test. Failing to find a difference is not evidence of equivalence, which is exactly the gap this fills.'],
    how: [
      'Decide the bound first and write down why.',
      'Pick Equivalence (TOST) and enter it under Options.',
    ],
    reports: 'The difference with its 90% confidence interval, the bound, and the larger of the two one-sided P values.',
  },

  cochranq: {
    answers: 'Do these studies agree enough to pool?',
    needs: 'One row per study: its effect in the first column, that effect\'s standard error in the second.',
    assumes: ['The effects are on the same scale, and each standard error belongs to its effect.'],
    doesNot: ['Fix heterogeneity. A high I² means the studies are measuring different things, and a pooled number may not mean much.'],
    how: ['One row per study, effect and standard error.', "Pick Meta-analysis. Both fixed-effect and random-effects summaries are given."],
    reports: 'Q with its degrees of freedom and P, I², and the pooled effect with its confidence interval. Say which model you quote and why.',
  },

  mantelhaenszel: {
    answers: 'What is the pooled odds ratio across strata?',
    needs: 'One row per stratum, four columns of counts: a, b, c, d.',
    assumes: ['The odds ratio is roughly the same in every stratum.'],
    doesNot: ['Detect that the strata disagree. If they do, a single pooled odds ratio is the wrong summary.'],
    how: ['One row per site, batch or experiment, four count columns.', 'Pick Mantel–Haenszel.'],
    reports: 'The pooled odds ratio with its confidence interval, and the test statistic. Pooling the raw counts instead would let Simpson\'s paradox through, which is the reason this test exists.',
  },

  resourceequation: {
    answers: 'Roughly how many animals per group?',
    needs: 'Nothing but the number of groups and the number per group you are considering.',
    assumes: ['You have no effect size to power against. If you do, a power calculation is better.'],
    doesNot: ['Replace a power calculation. It is a sanity check, not a design.'],
    how: ['Pick Resource equation and enter the groups and the number per group.', 'Aim for residual degrees of freedom between 10 and 20.'],
    reports: 'For an ethics application, the residual degrees of freedom and why no effect size was available.',
  },

  dagostino: {
    answers: 'Is there evidence these values are not normal, from their shape?',
    needs: 'Twenty or more values in a column.',
    assumes: ['Independent observations.'],
    doesNot: ['Work below twenty values, where Shapiro–Wilk is the better choice.'],
    how: ["Pick Normality (D'Agostino–Pearson). Skewness and kurtosis are combined into one omnibus test."],
    reports: 'Usually nothing directly; it informs the choice of test.',
    insteadUse: 'Shapiro–Wilk for smaller samples, which is most lab experiments.',
  },

  outlier: {
    answers: 'Is the most extreme value further out than sampling alone explains?',
    needs: 'Any Column table with three or more values per column.',
    assumes: ['The rest of the data are roughly normal.'],
    doesNot: [
      'Find more than one outlier per column.',
      'Justify deleting anything. Removing a point because a test flagged it changes the meaning of every P value you compute afterwards.',
    ],
    how: ['Pick Outlier screening. Every column is checked.', 'If something is flagged, look for a physical reason before deciding anything.'],
    reports: 'If you exclude a value, say so in the paper, say why, and report the analysis both with and without it.',
  },
};
