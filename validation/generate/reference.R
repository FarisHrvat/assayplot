# Generates golden fixtures from R for the AssayPlot statistics core.
#
#   Rscript validation/generate/reference.R
#
# Writes validation/fixtures/reference.json with inputs and R's expected
# outputs at full double precision. The fixtures are committed so that CI can
# validate the TypeScript engine without R being installed.

suppressPackageStartupMessages(library(jsonlite))
set.seed(20260902)

cases <- list()
add <- function(id, procedure, input, expected, note = NULL) {
  cases[[length(cases) + 1]] <<- list(
    id = id, procedure = procedure, input = input,
    expected = expected, note = note
  )
}

# ---- datasets ---------------------------------------------------------
sep_a <- c(92, 88, 95, 90, 87, 93, 91, 89)   # well separated, no ties
sep_b <- c(70, 74, 69, 76, 72, 68, 79, 71)
tie_a <- c(10, 12, 14, 16, 18)               # ties in the paired differences
tie_b <- c(8, 10, 11, 12, 13)
overlap_a <- c(5.1, 6.3, 4.8, 5.9, 6.0, 5.2) # overlapping, small effect
overlap_b <- c(5.5, 6.1, 5.7, 6.4, 5.8, 6.2)
xx <- 1:8
yy <- c(2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1)
g3 <- list(c(5, 7, 6, 8, 9), c(10, 12, 11, 13, 14), c(20, 22, 19, 21, 25))
g3v <- unlist(g3); g3f <- factor(rep(1:3, each = 5))

# ---- t tests ----------------------------------------------------------
for (nm in list(list("sep", sep_a, sep_b), list("overlap", overlap_a, overlap_b))) {
  a <- nm[[2]]; b <- nm[[3]]
  w <- t.test(a, b); s <- t.test(a, b, var.equal = TRUE); p <- t.test(a, b, paired = TRUE)
  add(paste0("welch_", nm[[1]]), "welchTTest", list(a = a, b = b),
      list(statistic = unname(w$statistic), df = unname(w$parameter),
           pValue = w$p.value, confidenceInterval95 = as.numeric(w$conf.int)))
  add(paste0("student_", nm[[1]]), "studentTTest", list(a = a, b = b),
      list(statistic = unname(s$statistic), df = unname(s$parameter), pValue = s$p.value))
  add(paste0("paired_", nm[[1]]), "pairedTTest", list(a = a, b = b),
      list(statistic = unname(p$statistic), df = unname(p$parameter), pValue = p$p.value))
}

# ---- rank tests -------------------------------------------------------
# no ties -> R uses the exact distribution
mw <- wilcox.test(sep_a, sep_b)
add("mannwhitney_exact", "mannWhitney", list(a = sep_a, b = sep_b),
    list(statistic = unname(mw$statistic), pValue = mw$p.value, exact = TRUE),
    "no ties: exact permutation distribution")

# ties present -> R falls back to the corrected normal approximation
mwt <- suppressWarnings(wilcox.test(c(1, 2, 2, 3, 5), c(2, 3, 4, 4, 6)))
add("mannwhitney_ties", "mannWhitney", list(a = c(1, 2, 2, 3, 5), b = c(2, 3, 4, 4, 6)),
    list(statistic = unname(mwt$statistic), pValue = mwt$p.value, exact = FALSE),
    "ties: normal approximation with continuity correction")

ws <- suppressWarnings(wilcox.test(tie_a, tie_b, paired = TRUE))
add("wilcoxon_ties", "wilcoxonSignedRank", list(a = tie_a, b = tie_b),
    list(statistic = unname(ws$statistic), pValue = ws$p.value, exact = FALSE),
    "ties in |differences|: normal approximation")

wse <- wilcox.test(c(1.2, 3.4, 5.6, 7.8, 9.1, 2.3), c(0.5, 1.1, 2.2, 3.3, 4.4, 0.9), paired = TRUE)
add("wilcoxon_exact", "wilcoxonSignedRank",
    list(a = c(1.2, 3.4, 5.6, 7.8, 9.1, 2.3), b = c(0.5, 1.1, 2.2, 3.3, 4.4, 0.9)),
    list(statistic = unname(wse$statistic), pValue = wse$p.value, exact = TRUE),
    "no ties: exact signed-rank distribution")

kw <- kruskal.test(g3v, g3f)
add("kruskal", "kruskalWallis", list(groups = g3),
    list(statistic = unname(kw$statistic), df = unname(kw$parameter), pValue = kw$p.value))

# ---- ANOVA ------------------------------------------------------------
av <- summary(aov(g3v ~ g3f))[[1]]
add("anova_oneway", "oneWayAnova", list(groups = g3),
    list(statistic = av[["F value"]][1], dfBetween = av[["Df"]][1],
         dfWithin = av[["Df"]][2], pValue = av[["Pr(>F)"]][1]))

# ---- correlation and regression ---------------------------------------
ct <- cor.test(xx, yy)
add("pearson", "pearsonCorrelation", list(x = xx, y = yy),
    list(estimate = unname(ct$estimate), statistic = unname(ct$statistic),
         df = unname(ct$parameter), pValue = ct$p.value))
st <- suppressWarnings(cor.test(xx, yy, method = "spearman"))
add("spearman", "spearmanCorrelation", list(x = xx, y = yy),
    list(estimate = unname(st$estimate), pValue = st$p.value))
fit <- lm(yy ~ xx); cf <- summary(fit)$coefficients
add("regression", "linearRegression", list(x = xx, y = yy),
    list(slope = unname(cf[2, 1]), intercept = unname(cf[1, 1]),
         seSlope = unname(cf[2, 2]), r2 = summary(fit)$r.squared,
         slopeConfidenceInterval95 = as.numeric(confint(fit)[2, ])))

# ---- contingency ------------------------------------------------------
tbl <- matrix(c(10, 20, 30, 15), 2, 2, byrow = TRUE)
cs0 <- chisq.test(tbl, correct = FALSE); cs1 <- chisq.test(tbl)
add("chisq_2x2", "chiSquareTest", list(table = list(c(10, 20), c(30, 15))),
    list(statisticUncorrected = unname(cs0$statistic), pValueUncorrected = cs0$p.value,
         statisticYates = unname(cs1$statistic), pValueYates = cs1$p.value,
         df = unname(cs0$parameter)))
big <- matrix(c(12, 5, 9, 7, 14, 6, 3, 8, 20), 3, 3, byrow = TRUE)
cs3 <- chisq.test(big)
add("chisq_3x3", "chiSquareTest",
    list(table = list(c(12, 5, 9), c(7, 14, 6), c(3, 8, 20))),
    list(statisticUncorrected = unname(cs3$statistic), pValueUncorrected = cs3$p.value,
         df = unname(cs3$parameter)))
ft <- fisher.test(matrix(c(3, 1, 1, 4), 2, 2, byrow = TRUE))
add("fisher", "fisherExactTest", list(table = list(c(3, 1), c(1, 4))),
    list(pValue = ft$p.value, oddsRatioConditional = unname(ft$estimate),
         oddsRatioSample = (3 * 4) / (1 * 1)))

# ---- multiplicity -----------------------------------------------------
praw <- c(0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205)
add("holm", "holmAdjust", list(p = praw), list(adjusted = p.adjust(praw, "holm")))
add("bh", "benjaminiHochberg", list(p = praw), list(adjusted = p.adjust(praw, "BH")))

# ---- edge cases -------------------------------------------------------
add("welch_n2", "welchTTest", list(a = c(1, 2), b = c(8, 9)),
    list(statistic = unname(t.test(c(1, 2), c(8, 9))$statistic),
         df = unname(t.test(c(1, 2), c(8, 9))$parameter),
         pValue = t.test(c(1, 2), c(8, 9))$p.value),
    "smallest usable sample")
huge_a <- c(1e8, 1.0000001e8, 1.0000002e8); huge_b <- c(2e8, 2.0000001e8, 2.0000002e8)
add("welch_large_magnitude", "welchTTest", list(a = huge_a, b = huge_b),
    list(statistic = unname(t.test(huge_a, huge_b)$statistic),
         df = unname(t.test(huge_a, huge_b)$parameter),
         pValue = t.test(huge_a, huge_b)$p.value),
    "values near 1e8, checks catastrophic cancellation")

# ---- post-hoc and diagnostics -----------------------------------------
tk_groups <- list(c(92,88,95,90,87,93), c(78,74,81,76,72,79), c(61,58,66,59,63,57))
tk_v <- unlist(tk_groups); tk_f <- factor(rep(1:3, each = 6))
tk <- TukeyHSD(aov(tk_v ~ tk_f))$tk_f
# R orders pairs as 2-1, 3-1, 3-2 and reports B - A; Statista reports A - B.
add("tukey", "tukeyHSD", list(groups = tk_groups),
    list(differences = c(-tk[1, "diff"], -tk[2, "diff"], -tk[3, "diff"]),
         pValues = c(tk[1, "p adj"], tk[2, "p adj"], tk[3, "p adj"]),
         lower = c(-tk[1, "upr"], -tk[2, "upr"], -tk[3, "upr"]),
         upper = c(-tk[1, "lwr"], -tk[2, "lwr"], -tk[3, "lwr"])),
    "all pairs, exact family-wise error rate")

for (nm in list(list("sw_normalish", c(2.1,3.4,1.9,4.5,3.3,2.8,5.1,3.9,2.2,4.1,3.0,3.7)),
                list("sw_skewed", c(1,2,3,4,5,6,7,8,9,50)),
                list("sw_tiny", c(2,4,4,5,9)))) {
  s <- shapiro.test(nm[[2]])
  add(nm[[1]], "shapiroWilk", list(x = nm[[2]]),
      list(statistic = unname(s$statistic), pValue = s$p.value))
}

var_groups <- list(c(1,2,3,4), c(2,4,6,8), c(1,5,9,13))
var_v <- unlist(var_groups); var_f <- factor(rep(1:3, each = 4))
bt <- bartlett.test(var_v, var_f)
add("bartlett", "bartlettTest", list(groups = var_groups),
    list(statistic = unname(bt$statistic), df = unname(bt$parameter), pValue = bt$p.value))

os <- t.test(c(2.1,3.4,1.9,4.5,3.3,2.8,5.1,3.9,2.2,4.1,3.0,3.7), mu = 3)
add("onesample", "oneSampleTTest",
    list(x = c(2.1,3.4,1.9,4.5,3.3,2.8,5.1,3.9,2.2,4.1,3.0,3.7), mu = 3),
    list(statistic = unname(os$statistic), df = unname(os$parameter),
         pValue = os$p.value, confidenceInterval95 = as.numeric(os$conf.int)))

fr_matrix <- matrix(c(10,12,15, 11,14,17, 9,11,14, 12,13,18, 10,15,16), ncol = 3, byrow = TRUE)
fr <- friedman.test(fr_matrix)
add("friedman", "friedmanTest", list(matrix = lapply(seq_len(nrow(fr_matrix)), function(i) fr_matrix[i, ])),
    list(statistic = unname(fr$statistic), df = unname(fr$parameter), pValue = fr$p.value))

out <- list(
  generatedBy = paste("R", getRversion()),
  generatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
  note = "Golden values produced by R. Regenerate with validation/generate/reference.R.",
  cases = cases
)
dir.create("validation/fixtures", showWarnings = FALSE, recursive = TRUE)
write_json(out, "validation/fixtures/reference.json",
           auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null")
cat("wrote", length(cases), "cases\n")
