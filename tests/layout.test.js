import test from 'node:test';import assert from 'node:assert/strict';import{panelRects,layoutForPanelCount}from'../src/core/layout.js';
test('layout creates non-overlapping two-panel rectangles',()=>{const r=panelRects(layoutForPanelCount(2));assert.equal(r.length,2);assert.ok(r[0].x<r[1].x);assert.ok(r[0].x+r[0].width<r[1].x)});
test('layout supports four panels and rejects unsupported counts',()=>{assert.equal(panelRects(layoutForPanelCount(4)).length,4);assert.throws(()=>layoutForPanelCount(3),/Supported/)})
