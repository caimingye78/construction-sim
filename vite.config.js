import { defineConfig } from 'vite';
export default defineConfig({
  base: '/construction-sim/',
  build: { outDir: 'dist' },
  server: { port: 5173 }
});
