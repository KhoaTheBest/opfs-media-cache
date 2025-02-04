/// <reference types="vitest" />

import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  root: 'examples/workers',
  server: {
    port: 3000,
    open: '/demo.html'
  },
  build: {
    target: 'ESNext',
    rollupOptions: {
      input: {
        benchmark: resolve(__dirname, 'examples/workers/demo.html'),
      },
    },
    outDir: 'demo-dist/',
  },
});