import { defineConfig, devices } from '@playwright/test';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './e2e/fixtures/constants';

const PORT = 4173;

// E2E runs against the PRODUCTION bundle (`vite build` + `vite preview`), not the dev server:
// React.StrictMode double-invokes effects in dev, which would corrupt the render-once and
// request-count assertions. Supabase is never contacted — every request to SUPABASE_URL is
// intercepted by e2e/fixtures/supabase-mock.ts (CLAUDE.md "Testing rules" #4).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Never reuse: a stale preview from an earlier build would silently test old code.
    reuseExistingServer: false,
    timeout: 300_000, // `tsc` + `vite build` run first; ~50s normally, but a busy machine has taken >3min
    env: { VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY },
  },
});
