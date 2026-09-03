import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderPanels, updatePanel } from '../src/core/panels.js';

test('panel operations preserve independent editable specifications',()=>{const panels=[{type:'dot',title:'Raw'},{type:'box',title:'Summary'},{type:'line',title:'Trend'}];const moved=reorderPanels(panels,2,0);assert.deepEqual(moved.map(panel=>panel.title),['Trend','Raw','Summary']);assert.equal(panels[0].title,'Raw');const updated=updatePanel(moved,1,{title:'Points'});assert.equal(updated[1].title,'Points');assert.equal(moved[1].title,'Raw')})
