import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: { build: { externalizeDeps: false, rollupOptions: { output: { format: 'cjs' } } } },
  renderer: {},
});
