import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
        xfwd: true
      },
      '/uploads': {
        target: 'http://localhost:8787',
        changeOrigin: false,
        xfwd: true
      }
    }
  }
});
