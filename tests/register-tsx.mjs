// Lets `node --test` import .tsx. Node strips types but not JSX, so this runs
// esbuild (already here for Vite) over it on the way in.
//
//   node --import ./tests/register-tsx.mjs --test ...

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
