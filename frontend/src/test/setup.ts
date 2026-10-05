import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { installConsoleErrorGuard } from './console';
import { installMatchMedia, resetViewport } from './viewport';

installMatchMedia();
installConsoleErrorGuard();

// jsdom ships its own AbortController/AbortSignal, but `Request` is Node's (undici), which rejects a
// foreign signal ("RequestInit: Expected signal to be an instance of AbortSignal"). React Router's data
// router builds a `Request` with a signal on EVERY navigation (even with no loaders), so any test that
// navigates would crash. Dropping the signal is safe here: nothing under test aborts a loader.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init?.signal ? { ...init, signal: undefined } : init);
  }
} as typeof Request;

// React Router 6.30 logs "v7 future flag" notices via console.warn on every router creation —
// noise unrelated to what a test asserts. Every other warning still passes through.
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('React Router Future Flag Warning')) return;
  originalWarn(...args);
};

beforeEach(() => {
  resetViewport();
  window.localStorage.clear();
  window.sessionStorage.clear();
  // jsdom doesn't implement these; pages call them (scroll restoration, carousel buttons).
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollBy = vi.fn() as unknown as typeof Element.prototype.scrollBy;
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
  // jsdom has no object URLs; photo previews call these.
  URL.createObjectURL = vi.fn(() => 'blob:test-preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
});
