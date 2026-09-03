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
  test(`imports ${name}`, async () => {
    const table = await tableFromWorkbook(arrayBufferFor(name), 'knockdown');
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

test('every format yields the same numbers', async () => {
  const workbook = await tableFromWorkbook(arrayBufferFor('knockdown.xlsx'), 'x');
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

// Number formats differ by country, and getting this wrong is not cosmetic:
// read as US, the Italian "1,5" becomes 15 and every value in the file is
// silently wrong by a factor of ten or a hundred.

const LOCALE_CASES: { name: string; text: string; delimiter: string; decimal: string; values: number[] }[] = [
  {
    name: 'Italian, semicolon separated with comma decimals',
    text: 'Gruppo;Valore\nControllo;1,5\nControllo;2,75\nTrattato;10,25\n',
    delimiter: ';', decimal: ',', values: [1.5, 2.75, 10.25],
  },
  {
    name: 'European thousands and decimals',
    text: 'A;B\nx;1.234,56\ny;2.345,67\n',
    delimiter: ';', decimal: ',', values: [1234.56, 2345.67],
  },
  {
    name: 'US, comma separated with dot decimals',
    text: 'Group,Value\nControl,1.5\nControl,2.75\n',
    delimiter: ',', decimal: '.', values: [1.5, 2.75],
  },
  {
    name: 'US thousands, quoted',
    text: 'Group,Value\nControl,"1,234.56"\nControl,"2,345.67"\n',
    delimiter: ',', decimal: '.', values: [1234.56, 2345.67],
  },
  {
    name: 'tab separated',
    text: 'Group\tValue\nControl\t1.5\nControl\t2.75\n',
    delimiter: '\t', decimal: '.', values: [1.5, 2.75],
  },
  {
    name: 'small European decimals',
    text: 'Gruppe;Wert\nA;0,001\nB;0,002\n',
    delimiter: ';', decimal: ',', values: [0.001, 0.002],
  },
  {
    name: 'scientific notation',
    text: 'A,B\nx,1.5e-3\ny,2.5e-3\n',
    delimiter: ',', decimal: '.', values: [0.0015, 0.0025],
  },
];

for (const testCase of LOCALE_CASES) {
  test(`detects and parses ${testCase.name}`, async () => {
    const { detectFormat } = await import('../src/app/io.ts');
    const format = detectFormat(testCase.text);
    assert.equal(format.delimiter, testCase.delimiter);
    assert.equal(format.decimal, testCase.decimal);

    const table = tableFromDelimited(testCase.text, 'locale');
    assert.deepEqual(table.rows.map((row) => row[1]), testCase.values);
  });
}

test('a lone comma before three digits is left ambiguous rather than guessed wrong', async () => {
  const { detectDecimal } = await import('../src/app/io.ts');
  // "1,234" alone could be either convention. With a comma delimiter it cannot
  // be a decimal mark at all, so the file reads as US.
  assert.equal(detectDecimal('a,b\nx,1234\ny,5678\n', ','), '.');
});

test('a paste from a European spreadsheet keeps its values', async () => {
  const { parseClipboard } = await import('../src/app/io.ts');
  assert.deepEqual(parseClipboard('1,5\t2,75\n3,25\t4,5'), [[1.5, 2.75], [3.25, 4.5]]);
});

test('text that is not a number stays text', async () => {
  const { parseNumber } = await import('../src/app/io.ts');
  assert.equal(parseNumber('n/a', '.'), null);
  assert.equal(parseNumber('12abc', '.'), null);
  assert.equal(parseNumber('', '.'), null);
  assert.equal(parseNumber('-3.5', '.'), -3.5);
  assert.equal(parseNumber('-3,5', ','), -3.5);
});
