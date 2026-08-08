import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  // pdf.js ships a worker as a separate ES module; Vite handles it through
  // `new Worker(new URL(...), { type: 'module' })` in src/formats/pdf.js
  optimizeDeps: { include: ['jszip', 'pdfjs-dist'] },
});
