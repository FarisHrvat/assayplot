import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built bundle also works from file:// inside Tauri.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
