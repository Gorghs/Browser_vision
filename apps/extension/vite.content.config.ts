import { defineConfig } from 'vite';

/**
 * Builds the content script as a single self-contained IIFE.
 *
 * A declaratively injected content script is a classic script: it cannot use
 * `import`. Bundling it separately guarantees Rollup emits one file with no
 * shared chunks, whatever the popup and background happen to import.
 *
 * `emptyOutDir` is off because this build runs after the main one and must not
 * delete its output.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: 'src/content/index.ts',
      output: {
        entryFileNames: 'content.js',
        format: 'iife',
      },
    },
  },
});
