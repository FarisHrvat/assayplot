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
    reports: 'The two-sided P and an odds ratio. Two odds ratios are shown: the cross-product, which Prism reports, and the conditional maximum-likelihood estimate, which R reports. Say which you quote.',
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
