import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// lib/supabase-client.ts throws at import time without these; no test talks to a real project.
vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// jsdom doesn't implement layout APIs the pages call.
Element.prototype.scrollIntoView = vi.fn();
window.scrollTo = vi.fn() as never;
