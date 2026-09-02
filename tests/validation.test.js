import test from 'node:test';
import assert from 'node:assert/strict';
import { dataQualityReport, analysisReadiness } from '../src/core/validation.js';

test('data quality report counts missing and unusable observations', () => {
  const report = dataQualityReport([
    { group: 'Control', value: 1 },
    { group: 'Control', value: 1 },
    { group: 'Treatment', value: 'bad' },
    { group: '', value: 4 },
    { group: 'Treatment', value: null }
  ]);
  assert.equal(report.rows, 5);
  assert.equal(report.missingGroup, 1);
  assert.equal(report.missingOutcome, 1);
  assert.equal(report.nonNumericOutcome, 1);
  assert.ok(report.warnings.some(message => message.includes('zero variance')));
  assert.equal(report.valid, true);
});

test('analysis readiness reflects usable group structure', () => {
  const ready = analysisReadiness([
    { condition: 'A', result: 1 }, { condition: 'A', result: 2 },
    { condition: 'B', result: 3 }, { condition: 'B', result: 4 }
  ], { groupKey: 'condition', valueKey: 'result' });
  assert.equal(ready.readyForTwoGroupTest, true);
  assert.equal(ready.readyForAnova, true);
  assert.equal(ready.readyForCorrelation, true);
  const sparse = analysisReadiness([{ group: 'A', value: 1 }, { group: 'B', value: 2 }]);
  assert.equal(sparse.readyForTwoGroupTest, false);
  assert.ok(sparse.warnings.some(message => message.includes('at least two')));
});
