import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  dts: false,
  clean: true,
  minify: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  outExtension() {
    return {
      js: '.js',
    };
  },
});
