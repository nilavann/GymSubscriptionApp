import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor chunks change far less often than this app's own code between deploys —
        // isolating them lets returning visitors hit browser cache across app updates
        // instead of re-downloading React/Supabase on every deploy. See spec/frontend/
        // performance.md §3 (a caching optimization, distinct from route-based splitting).
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
});
