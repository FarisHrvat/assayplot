import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One source of truth for the version. It used to be typed into model.ts as
// well, and the two drifted: the app reported 0.3.1 for a 0.4.0 build.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Relative base so the built bundle also works from file:// inside Tauri.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
