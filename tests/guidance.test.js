import test from 'node:test';import assert from 'node:assert/strict';import{recommendAnalyses}from'../src/core/guidance.js';
test('guidance distinguishes two independent groups',()=>{const r=recommendAnalyses({groups:['Control','Treatment']});assert.equal(r[0].id,'welch');assert.match(r[0].reason,/independent/)});
test('guidance recommends ANOVA for three groups',()=>{const r=recommendAnalyses({groups:['A','B','C']});assert.equal(r[0].id,'anova');assert.equal(r[0].status,'available')});
test('guidance detects an XY workflow',()=>{const r=recommendAnalyses({groups:['Dose'],hasX:true});assert.equal(r[0].id,'regression')});
