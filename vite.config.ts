import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'lib/index.ts'),
      name: '@btg-pencil-ai/browser-asset-caching',
      formats: ['es', 'cjs'],
      fileName: (format) => 
        format === 'es' ? 'index.esm.js' : 'index.js'
    },
    sourcemap: true,
  },
});