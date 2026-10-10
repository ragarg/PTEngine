import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { wgsl } from './vite-plugin-wgsl.ts';

export default defineConfig({
  plugins: [wgsl()],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'pt-engine.js',
    },
    rollupOptions: {
      external: ['gl-matrix'],
    },
  },
});
