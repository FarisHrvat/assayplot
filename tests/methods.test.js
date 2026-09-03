import test from 'node:test';
import assert from 'node:assert/strict';
import { methodsSummary } from '../src/core/methods.js';

test('methods summary explains a Welch result', () => {
  const text = methodsSummary({method:'welch', groups:['Control','Treatment'], result:{nA:4,nB:5,difference:2.4,confidenceInterval95:[.5,4.3],t:2.8,df:6.2,pValue:.02}});
  assert.match(text, /Welch two-sample/);
  assert.match(text, /p 0\.020/);
});
