import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [preact()],
  build: { outDir: fileURLToPath(new URL('../dist/web', import.meta.url)), emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000', '/healthz': 'http://localhost:3000' } },
});
