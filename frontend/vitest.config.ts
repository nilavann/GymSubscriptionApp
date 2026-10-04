import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Deliberately separate from vite.config.ts: tests don't need Tailwind's CSS pipeline or the
// production chunking, and CSS is skipped entirely (`css: false`) — behavior is asserted by
// role/label/text, not computed styles. Layout/visual behavior is covered by Playwright (e2e/).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    // lib/supabase-client.ts throws at import time without these. They're dummies — unit tests
    // never reach the network (CLAUDE.md "Testing rules" #3).
    env: {
      VITE_SUPABASE_URL: 'https://unit.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'unit-anon-key',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/types/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      // Informational only — no threshold until the baseline suite exists (plan: Phase 6).
    },
  },
});
