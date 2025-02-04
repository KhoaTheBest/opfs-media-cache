/// <reference types="vitest" />

import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  root: 'examples',
  server: {
    port: 3000,
    open: '/demo.html'
  },
  build: {
    target: 'ESNext',
    rollupOptions: {
      input: {
        benchmark: resolve(__dirname, 'examples/demo.html'),
      },
    },
    outDir: 'demo-dist/',
  },
});