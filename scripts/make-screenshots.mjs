// Regenerates the screenshots used in the README and on the site.
//
//   npm run dev            # in another terminal
//   npm run screenshots
//
// Driven rather than hand-captured, so they never drift from the interface
// they claim to show: rerun this after a change and the pictures update with
// it. Uses the Chrome already on the machine rather than downloading one.

import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL = process.env.URL ?? 'http://localhost:5173';
const OUT = 'docs/assets';
const WIDTH = 1440;
const HEIGHT = 900;

const CHROME = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(Boolean);

mkdirSync(OUT, { recursive: true });

process.env.LANG = 'en_US.UTF-8';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // Pinned to en-US: Chrome renders a number input's decimal separator from
  // the browser locale, so on a comma-decimal machine a screenshot shows 0,55
  // and reads as a bug. The value the DOM reports is dot-formatted either way.
  args: [
    `--window-size=${WIDTH},${HEIGHT}`,
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--lang=en-US',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

/** Waits for the splash to go, so no shot catches it mid-fade. */
async function ready() {
  await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 20000 });
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function useTheme(theme) {
  // Stored as a bare string, not JSON: see theme.ts.
  await page.evaluate((value) => {
    localStorage.setItem('assayplot.theme', value);
  }, theme);
  await page.reload({ waitUntil: 'networkidle0' });
  await ready();
}

/** Selects a node in the store rather than hunting for it on screen. */
async function select(kind, index) {
  await page.evaluate(({ kind, index }) => {
    const store = window.__assayplot.useStore;
    const project = store.getState().project;
    const list = { table: 'tables', analysis: 'analyses', figure: 'figures', layout: 'layouts' }[kind];
    store.getState().select({ kind, id: project[list][index].id });
  }, { kind, index });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

await page.goto(URL, { waitUntil: 'networkidle0' });
await ready();
await useTheme('light');

await select('table', 0);
await shot('screen-data');

await select('analysis', 0);
await shot('screen-analysis');

await select('figure', 0);
await shot('screen-figure');

await useTheme('dark');
await select('figure', 0);
await shot('screen-figure-dark');

await browser.close();
console.log(`wrote four screenshots to ${OUT}/`);
