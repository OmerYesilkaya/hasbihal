import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      // Bundle everything (only Electron and Node's own modules stay outside): the installer
      // then carries just the built app, not node_modules (every package is a devDependency).
      externalizeDeps: false,
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
