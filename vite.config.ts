/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    // Under `netlify dev`, connect the live-reload socket straight to Vite (the CLI's websocket proxy is unreliable).
    hmr: process.env.NETLIFY_DEV ? { clientPort: 5173 } : undefined,
    // `netlify dev` proxies the Vite server and serves functions on :8888.
    // When running plain `vite`, forward API calls to a running `netlify dev`/functions server.
    proxy: {
      '/api': { target: 'http://localhost:8888', changeOrigin: true },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['motion'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
