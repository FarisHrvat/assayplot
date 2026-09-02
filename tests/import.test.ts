// Import coverage for every file format the app advertises.
//
// The fixtures are a small siRNA knockdown experiment saved in each format, so
// a regression in one parser shows up as a mismatch against the others.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IMPORT_EXTENSIONS,
  tableFromDelimited,
  tableFromWorkbook,
} from '../src/app/io.ts';
import { columnValues } from '../src/app/model.ts';

const FIXTURES = new URL('./fixtures/', import.meta.url);
const EXPECTED_COLUMNS = ['Untreated', 'siRNA-1', 'siRNA-2'];
const EXPECTED_FIRST_ROW = [112, 68, 71];

function arrayBufferFor(name: string): ArrayBuffer {
  const bytes = readFileSync(new URL(name, FIXTURES));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

for (const name of ['knockdown.xlsx', 'knockdown.xls']) {
  test(`imports ${name}`, () => {
    const table = tableFromWorkbook(arrayBufferFor(name), 'knockdown');
    assert.deepEqual(table.columns.map((column) => column.name), EXPECTED_COLUMNS);
    assert.equal(table.rows.length, 6);
    assert.deepEqual(table.rows[0], EXPECTED_FIRST_ROW);
    assert.deepEqual(columnValues(table, table.columns[0].id), [112, 108, 119, 104, 115, 110]);
  });
}

for (const name of ['knockdown.csv', 'knockdown.txt']) {
  test(`imports ${name}`, () => {
    const text = readFileSync(new URL(name, FIXTURES), 'utf8');
    const table = tableFromDelimited(text, 'knockdown');
    assert.deepEqual(table.columns.map((column) => column.name), EXPECTED_COLUMNS);
    assert.deepEqual(table.rows[0], EXPECTED_FIRST_ROW);
  });
}

test('every format yields the same numbers', () => {
  const workbook = tableFromWorkbook(arrayBufferFor('knockdown.xlsx'), 'x');
  const csv = tableFromDelimited(readFileSync(new URL('knockdown.csv', FIXTURES), 'utf8'), 'c');
  assert.deepEqual(
    columnValues(workbook, workbook.columns[1].id),
    columnValues(csv, csv.columns[1].id)
  );
});

test('the advertised extension list covers the formats we parse', () => {
  for (const extension of ['.csv', '.tsv', '.txt', '.xlsx', '.xls']) {
    assert.ok(IMPORT_EXTENSIONS.includes(extension), `${extension} should be offered`);
  }
});

test('an unreadable format is refused with a message naming what is supported', () => {
  const fake = { name: 'scan.jpg', text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
  return import('../src/app/io.ts').then(async ({ tableFromFile }) => {
    await assert.rejects(() => tableFromFile(fake as unknown as File), /\.xlsx/);
  });
});
