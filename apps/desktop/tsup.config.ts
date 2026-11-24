import { defineConfig } from 'tsup';

// Main process in ESM (include il server e il core, che sono sorgenti TypeScript),
// preload in CommonJS perché gira in sandbox.
const shared = {
  platform: 'node' as const,
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  external: ['electron', 'puppeteer-core'],
  noExternal: [/^@open2bill\//],
};

export default defineConfig([
  { ...shared, entry: { main: 'src/main.ts' }, format: ['esm'], outExtension: () => ({ js: '.mjs' }), clean: true },
  { ...shared, entry: { preload: 'src/preload.ts' }, format: ['cjs'], outExtension: () => ({ js: '.cjs' }) },
]);
