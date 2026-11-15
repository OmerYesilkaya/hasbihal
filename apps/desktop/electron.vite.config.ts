import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      // Bundle workspace packages (they ship TypeScript source); keep real npm deps external.
      externalizeDeps: { exclude: ['@hasbihal/core', '@hasbihal/protocol'] },
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
