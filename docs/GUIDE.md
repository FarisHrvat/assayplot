# Using AssayPlot

A working guide for someone who has data and needs a figure and a p-value.
Nothing here assumes you have used a statistics package before.

- [The five-minute version](#the-five-minute-version)
- [Getting data in](#getting-data-in)
- [Choosing a table shape](#choosing-a-table-shape)
- [Running an analysis](#running-an-analysis)
- [Multiple comparisons](#multiple-comparisons)
- [Checking assumptions](#checking-assumptions)
- [Making a figure](#making-a-figure)
- [Multi-panel figures](#multi-panel-figures)
- [Exporting](#exporting)
- [Saving and recovering work](#saving-and-recovering-work)
- [What the app will not do](#what-the-app-will-not-do)
- [Keyboard shortcuts](#keyboard-shortcuts)

## The five-minute version

1. **Import data** from the toolbar, or type into the table that is already there.
2. Press **Analyse**. Pick a method from the list — anything unavailable tells
   you why.
3. Press **Graph**. Pick a plot type. Click the title on the figure to rename it.
4. Point the figure's **Significance from** at your analysis to get brackets.
5. **Export SVG** for the journal, or **PNG 300 dpi** for a slide.
6. **Save project** to keep everything together in one file.

Open one of the files in [`examples/`](../examples) to see a finished project.

## Getting data in

**Import data** accepts `.csv`, `.tsv`, `.txt`, `.xlsx`, `.xls`, and `.ods`, and
several files at once — each becomes its own table. The first row is treated as
column names when it is not numeric. Only the first worksheet of a workbook is
read.

You can also **paste a block straight from Excel** into any cell: click the cell
that should become the top-left corner and paste. The table grows to fit.

Blank cells are blank, not zero. A cell containing text in an otherwise numeric
column is ignored by the statistics rather than treated as zero.

## Choosing a table shape

The shape tells AssayPlot how your experiment is laid out. It decides which
analyses and plots are offered.

| Shape | Layout | Use for |
|---|---|---|
| **Column** | One column per group, one row per replicate | Comparing two or more groups |
| **Grouped** | First column names the row factor, other columns are the second factor | Two-way ANOVA |
| **XY** | First column is X, the rest are Y | Correlation, regression, dose–response |
| **Survival** | Time, event (1/0), group — one row per subject | Kaplan–Meier and log-rank |

For a **Grouped** table, repeat a row label to give replicates:

```
Sex      Control  Low dose  High dose
Male     12       18        25
Male     14       20        27
Female   10       15        19
Female   11       17        21
```

For a **Survival** table, the event column is `1` if the event happened and `0`
if the subject was censored (still event-free at last follow-up). Words such as
`died`, `event`, `censored`, and `alive` are also understood.

## Running an analysis

Press **Analyse** on a table. The method list is grouped by the question you are
asking. Methods that cannot run on this table are greyed out **with the reason**
— usually the wrong shape or the wrong number of columns.

AssayPlot will not pick a test for you. It shows what each one assumes and lets
you choose, because the right test depends on how the experiment was done, which
the software cannot see.

Every result shows an effect size and a confidence interval next to the p-value,
because a p-value alone does not tell you whether the difference matters.

**Available methods**

| Family | Methods |
|---|---|
| Describe | Descriptive statistics |
| One sample | One-sample t-test against a value you choose |
| Two groups | Welch t-test, Student's t-test, paired t-test, Mann–Whitney, Wilcoxon signed-rank |
| Three or more | One-way ANOVA, Kruskal–Wallis, Friedman (repeated measures) |
| Two factors | Two-way ANOVA with replication |
| X versus Y | Pearson, Spearman, linear regression, dose–response (EC50/IC50) |
| Survival | Kaplan–Meier with log-rank |
| Counts | Chi-square (with Yates), Fisher's exact, McNemar for paired counts |
| Modelling | Logistic and Poisson regression, ANCOVA, mixed-effects models, GEE, Cox proportional hazards |
| Multivariate | Principal components, hierarchical clustering with bootstrap support, ANOSIM, PLS-DA |
| Agreement | Cohen's kappa, Bland–Altman, TOST for equivalence |
| Meta-analysis | Cochran's Q with I², Mantel–Haenszel |
| Genetics | Transmission disequilibrium, Mendelian randomisation |
| Study design | Simon's two-stage design, the resource equation |
| Assumptions | Shapiro–Wilk, D'Agostino–Pearson, Levene, Bartlett, Grubbs, ROUT |

Each analysis writes a **methods sentence** you can paste into a manuscript. It
names the test, the tails, the correction, and the software version.

### Which two-group test?

- Groups measured on **different** subjects → Welch t-test. Use it by default;
  it does not assume the two groups have the same spread, and costs almost
  nothing when they do.
- The **same** subjects measured twice → paired t-test. Each row must be one
  subject.
- Small samples you do not want to assume are normal → Mann–Whitney (unpaired)
  or Wilcoxon signed-rank (paired). With no ties and a small sample AssayPlot
  uses the exact test, as R does.

### Dose–response

Use an **XY** table with concentration in X. Choose *Dose–response curve*. The
fit reports EC50/IC50, Hill slope, and the Top and Bottom asymptotes, where
Bottom is the response at low dose.

If your X column already holds log₁₀(concentration), tick **X is already on a
log scale**. Either way the EC50 comes back as a concentration in the units of
your data. Concentrations of zero cannot sit on a log axis; they are dropped
from the fit and you are told how many.

Turn on **Log scale on X** in the figure to get the familiar sigmoid.

Every parameter comes with a **95% confidence interval**. Quote the EC50 with
its interval, never on its own: six points with scatter can put it anywhere
across a log unit, and a number to four figures hides that completely. If the
interval spans more than two orders of magnitude AssayPlot says so — those
concentrations did not locate the EC50.

Beneath the parameters is a comparison against the **three-parameter** curve,
which is the same model with the Hill slope pinned at 1. If the slope is not
distinguishable from 1, the simpler curve fits as well with one parameter fewer
and gives the more stable potency estimate. The test is the extra
sum-of-squares *F*, with AICc beside it.

## Multiple comparisons

Comparing three groups means three tests, and three chances at a false positive.
AssayPlot offers, for ANOVA and Kruskal–Wallis:

- **Tukey HSD** — every pair, with the family-wise error rate controlled exactly.
  The default after ANOVA, and what most journals expect.
- **Dunn's test** — the rank-based equivalent, the correct partner for
  Kruskal–Wallis.
- **Each group vs a control** — with Šídák's correction. This is deliberately
  *not* labelled Dunnett's test: Dunnett uses the joint distribution of the
  comparisons and is slightly less conservative. If a reviewer asks for
  Dunnett's test specifically, say what you actually ran.
- **Holm** or **Benjamini–Hochberg** on plain pairwise tests.
- **No correction**, which warns you that it is inflating your false-positive
  rate.

## Checking assumptions

Under *Assumptions and screening*:

- **Shapiro–Wilk** per column. Read it the right way round: a large p-value is
  not evidence of normality, only an absence of evidence against it. Below about
  20 values the test has very little power, and AssayPlot says so. Look at a Q–Q
  plot as well.
- **Levene and Bartlett** for equal variances. If they differ, prefer Welch.
- **Grubbs'** for a single outlier, and **ROUT** when there may be several.
  Grubbs finds one at a time, and a second outlier inflates the spread used to
  judge the first, so a pair can hide each other. ROUT fits robustly first and
  then controls the false discovery rate, so it can flag several at once.
- Removing a point because a test flagged it changes the meaning of every
  p-value you compute afterwards. A flagged point is a question about the
  experiment, not permission to delete a number. If you exclude one, say so in
  the paper and give the reason; better still, report the analysis with and
  without it.

## Making a figure

Press **Graph** on a table, or ＋ next to Figures. 37 plot types are grouped by
intent: comparing groups, distributions, X versus Y, matrices, parts of a whole,
survival, agreement, fitted models, and multivariate. Hovering the ? beside the
picker shows the selected plot drawn on data of the right shape.

**Edit the figure by clicking it.**

- Click the **title** or an **axis label** to type a new one in place.
- Click a **bar, point, curve, or wedge** to select that series, then set its
  colour from the panel — a palette swatch or any colour you like.
- Click the background to deselect.
- Click any **data point** to trace it back to the row it came from.

The right-hand panel covers gridlines (none, horizontal, vertical, both), log
axes, manual Y limits, the plot frame, error-bar definition, point size, bar
width, histogram bins, legend, and the exact pixel size of the figure.

**Error bars** default to standard deviation. Choose SD, SEM, 95% CI, or
min-to-max — and state which one in your caption. The panel reminds you.

**Significance brackets** appear when you point the figure's *Significance from*
at an analysis. They stack without colliding and use the adjusted p-values.

## Multi-panel figures

Layouts assemble existing figures into one publication panel. ＋ next to Layouts
starts one with the figures you already have.

Set panels per row, labelling (A/a/1/none), and the gap. Reorder with the arrows.
Panels reference figures rather than copying them, so editing a figure updates
every layout it appears in.

## Exporting

Every export asks where to put it, so a figure can go straight into the folder
the manuscript lives in.

| Format | Use |
|---|---|
| **SVG** | Journals and Illustrator. Text stays editable; nothing is rasterised. |
| **PNG** | Slides, posters, most journal raster requirements. Choose the DPI. |
| **PDF** | A figure on a page, at a page size you pick or trimmed to the figure. |
| **CSV** | The table itself, from the data view. |

Set the figure's width and height in the panel before exporting; PNG and PDF
scale from those at the DPI you choose. The starting DPI comes from Preferences.

Unset axis labels show a grey placeholder in the editor as a hint. It is not part
of the figure and never appears in an export.

### The report

**Report** writes up every analysis: the result, the methods sentence, and a
SHA-256 of each data table beside the analyses that used it, so a reviewer can
confirm the numbers analysed were the numbers supplied. Three formats:

- **PDF** for a supplement or an email. The text is laid out rather than
  rasterised, so it stays selectable and searchable.
- **Web page**, one self-contained file that opens in any browser.
- **Markdown**, to paste into Notion, a wiki or a doc.

**Notion** sends the same report to a page in your own workspace, using an
integration you create and a token stored on this machine.

## Saving and recovering work

**Save project** writes one `.asp` file with your data, analyses, figures,
and layouts. It is an ordinary ZIP of readable JSON — you can unzip it and read
your numbers without AssayPlot installed.

Work is also autosaved inside the application. If it crashes or the window
closes, the next start offers to restore it, and a closing window always writes
first whatever the interval is set to. Saving to a file clears the recovery
copy. Autosave is a safety net, not a substitute for saving: it is the copy you
cannot move, back up or send to anyone.

Closing a table asks first, and says what closes with it — an analysis or a
figure built on that table cannot outlive it. Undo brings the whole lot back.

**New** opens a second window. Two projects side by side is the usual reason to
want one, and closing the first to make room is not what New means anywhere
else.

## Preferences

Three tabs, under the gear:

- **Figures** — the palette, width and height new figures start with, the
  colour-blind safe mode, and the DPI the export dialog opens at.
- **Results** — decimal places, whether p-values below 0.0001 are shown exactly
  or as a threshold, and how hard an exact test may work the machine.
- **Application** — interface density (compact on a 13-inch laptop, roomy on a
  33-inch monitor), how often to autosave, whether to ask before closing, and
  whether to check for a new version at startup.

## Updates

At startup AssayPlot asks GitHub which release is newest. If there is one, it
says so and shows what changed; nothing is downloaded and nothing is installed
unless you say yes. No information about you or your data is sent, and the
check can be turned off in Preferences.

What happens after the download depends on the platform, and the dialog says
which before it starts:

- **macOS** — the disk image opens. Drag AssayPlot onto Applications and choose
  Replace.
- **Windows** — the installer runs and replaces this version in place.
  AssayPlot closes first.
- **Linux** — the AppImage is saved to Downloads and marked executable. Replace
  the copy you are running with it.

## What the app will not do

Being explicit, so nothing surprises you at review time:

- It does **not** pick a statistical test for you.
- It has no three-way ANOVA, and no crossed random effects. Repeated measures
  go through the mixed-effects model, which keeps a subject who missed one
  measurement instead of dropping them.
- It has no subcolumn replicates: use one row per replicate.
- It is **not validated for clinical or regulatory use**. For anything
  consequential, confirm the result with a statistician.

## Keyboard shortcuts

| Key | Does |
|---|---|
| Arrow keys | Move between cells |
| Enter | Move down; adds a row at the bottom |
| Tab / Shift-Tab | Next / previous cell, wrapping between rows |
| ⌘Z / Ctrl-Z | Undo |
| ⇧⌘Z / Ctrl-Y | Redo |
| ⌘V / Ctrl-V | Paste a block from Excel |

Left and right arrows move the caret once you are editing inside a cell, and
move between cells when the whole value is selected — the state you are in right
after arrowing onto it.
