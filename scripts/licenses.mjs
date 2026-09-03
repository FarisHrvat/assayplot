// Prints the licence of every runtime dependency, so THIRD-PARTY-NOTICES.md can
// be checked against what is actually installed.
//
//   npm run licenses

import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD']);

// "Apache-2.0 OR MIT" means the user picks either, so the package is fine if
// any branch is allowed. Parentheses and AND are not worth parsing: a package
// licensed "A AND B" needs a human to look at it anyway.
function acceptable(expression) {
  if (ALLOWED.has(expression)) return true;
  if (!/\bOR\b/.test(expression) || /\bAND\b/.test(expression)) return false;
  return expression
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .map((part) => part.trim())
    .some((part) => ALLOWED.has(part));
}

let failures = 0;
for (const section of ['dependencies', 'devDependencies']) {
  console.log(`\n${section}`);
  for (const name of Object.keys(manifest[section] ?? {})) {
    let licence = 'UNKNOWN';
    try {
      licence = JSON.parse(
        readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')
      ).license ?? 'UNKNOWN';
    } catch {
      licence = 'NOT INSTALLED';
    }
    const runtime = section === 'dependencies';
    const ok = !runtime || acceptable(licence);
    if (!ok) failures += 1;
    console.log(`  ${ok ? ' ' : '!'} ${name.padEnd(26)} ${licence}`);
  }
}

if (failures) {
  console.error(`\n${failures} runtime dependency licence(s) are not on the allow-list.`);
  process.exit(1);
}
console.log('\nAll runtime dependency licences are compatible with AGPL-3.0 distribution.');
