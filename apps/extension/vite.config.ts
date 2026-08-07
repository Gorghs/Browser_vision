import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import manifest from './manifest.config.js';

/**
 * Builds the popup and the background service worker.
 *
 * Both run as ES modules, so they may share chunks. The content script cannot —
 * declarative content scripts are classic scripts — so it is built separately by
 * `vite.content.config.ts`, which appends to this output.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'emit-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: `${JSON.stringify(manifest, null, 2)}\n`,
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Source maps ship with the build. An extension that watches browsing
    // deserves to be auditable, and maps make the shipped bundle readable
    // without paying for unminified code in every popup open.
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: 'popup.html',
        background: 'src/background/index.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
