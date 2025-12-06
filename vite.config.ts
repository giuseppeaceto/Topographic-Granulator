import { defineConfig } from 'vite';
import { resolve } from 'path';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait()
  ],
  base: './', // Use relative paths for Electron
  publicDir: 'public', // Serve files from public directory
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
    // Copy public files to dist
    copyPublicDir: true,
  },
  server: {
    port: 5173,
    // Ensure worklets are served correctly
    fs: {
      strict: false,
    },
    // Ensure public files are served at root
    middlewareMode: false,
  },
});

