const finite = value => Number.isFinite(Number(value));

export function dataQualityReport(rows = [], { groupKey = 'group', valueKey = 'value' } = {}) {
  if (!Array.isArray(rows)) throw new Error('Data must be a row-oriented array.');
  const groups = new Map();
  let missingGroup = 0;
  let missingOutcome = 0;
  let nonNumericOutcome = 0;
  rows.forEach(row => {
    const group = row?.[groupKey];
    if (group == null || String(group).trim() === '') missingGroup++;
    else if (!groups.has(String(group))) groups.set(String(group), []);
    if (row?.[valueKey] == null || String(row[valueKey]).trim() === '') {
      missingOutcome++;
    } else if (!finite(row[valueKey])) {
      nonNumericOutcome++;
    } else if (group != null && String(group).trim() !== '') {
      groups.get(String(group)).push(Number(row[valueKey]));
    }
  });
  const warnings = [];
  const errors = [];
  if (!rows.length) errors.push('Add at least one data row.');
  if (missingGroup) warnings.push(`${missingGroup} row${missingGroup === 1 ? '' : 's'} have no group label and will be excluded from group comparisons.`);
  if (missingOutcome) warnings.push(`${missingOutcome} row${missingOutcome === 1 ? '' : 's'} have a missing outcome and will be excluded from numeric analyses.`);
  if (nonNumericOutcome) warnings.push(`${nonNumericOutcome} outcome value${nonNumericOutcome === 1 ? '' : 's'} are not numeric and will be excluded.`);
  if (groups.size < 2) warnings.push('At least two labeled groups are needed for a two-group comparison.');
  for (const [name, values] of groups) {
    if (values.length < 2) warnings.push(`${name} has only ${values.length} usable observation${values.length === 1 ? '' : 's'}; inferential tests need at least two.`);
    if (values.length > 1 && new Set(values).size === 1) warnings.push(`${name} has zero variance; standard error-based tests cannot be computed.`);
  }
  const numericValues = [...groups.values()].flat();
  if (numericValues.some(value => Math.abs(value) > Number.MAX_SAFE_INTEGER)) warnings.push('Some values exceed safe integer precision; review the source units.');
  return {
    rows: rows.length,
    groups: [...groups].map(([name, values]) => ({ name, n: values.length, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN })),
    usableOutcomeRows: numericValues.length,
    missingGroup,
    missingOutcome,
    nonNumericOutcome,
    warnings,
    errors,
    valid: errors.length === 0
  };
}

export function analysisReadiness(rows = [], options = {}) {
  const report = dataQualityReport(rows, options);
  const readyGroups = report.groups.filter(group => group.n >= 2);
  return {
    ...report,
    readyForTwoGroupTest: readyGroups.length === 2,
    readyForAnova: readyGroups.length >= 2,
    readyForCorrelation: report.usableOutcomeRows >= 3,
    readyForDescriptive: report.usableOutcomeRows > 0
  };
}
