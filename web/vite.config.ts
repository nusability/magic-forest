import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works under GitHub Pages' /<repo>/ path.
  base: './',
  // three.js alone is ~600 kB minified. Splitting it buys a prototype nothing.
  build: { chunkSizeWarningLimit: 1000 },
});
