// Teaches `node --test` to import .tsx files.
//
// Node strips TypeScript types natively but does not compile JSX, so the
// figure engine (plot.tsx) cannot be imported without help. esbuild is already
// present as a Vite dependency, so this transforms JSX on the way in rather
// than adding a test runner.
//
// Used as:  node --import ./tests/register-tsx.mjs --test ...

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { code } = transformSync(source, {
      loader: 'tsx',
      format: 'esm',
      target: 'node22',
      jsx: 'automatic',
      sourcefile: url,
    });
    return { format: 'module', shortCircuit: true, source: code };
  },
});
