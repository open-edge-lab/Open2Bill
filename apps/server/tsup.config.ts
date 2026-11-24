import { defineConfig } from 'tsup';

// Bundle del server per Docker/produzione e per Electron.
// @open2bill/core viene incluso nel bundle (è TypeScript sorgente).
export default defineConfig({
  entry: { main: 'src/main.ts', index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@open2bill/core'],
});
