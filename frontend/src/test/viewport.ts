import { act } from '@testing-library/react';

/**
 * jsdom has no `matchMedia`, so `useMediaQuery` / `useIsTabletUp` would throw. This installs a
 * controllable one: `setViewport(390)` flips every live query and notifies subscribers, exactly
 * like resizing a real window across the 768px breakpoint.
 *
 * Only `(min-width: Npx)` and `(max-width: Npx)` are understood — anything else throws, so a
 * test can never silently pass against a query this shim didn't actually evaluate.
 */

export const DESKTOP_WIDTH = 1280;
export const MOBILE_WIDTH = 390;

let currentWidth = DESKTOP_WIDTH;

type Listener = (event: MediaQueryListEvent) => void;
const subscriptions = new Set<{ query: string; listener: Listener }>();

function evaluate(query: string, width: number): boolean {
  const match = /^\(\s*(min|max)-width:\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(query.trim());
  if (!match) throw new Error(`test matchMedia shim: unsupported media query "${query}"`);
  const limit = Number(match[2]);
  return match[1] === 'min' ? width >= limit : width <= limit;
}

function createMediaQueryList(query: string): MediaQueryList {
  // Validate eagerly so an unsupported query fails at the call site.
  evaluate(query, currentWidth);
  return {
    media: query,
    get matches() {
      return evaluate(query, currentWidth);
    },
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      subscriptions.add({ query, listener: listener as Listener });
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      for (const sub of subscriptions) {
        if (sub.query === query && sub.listener === listener) subscriptions.delete(sub);
      }
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  } as MediaQueryList;
}

export function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => createMediaQueryList(query),
  });
}

/** Resize the fake window. Wrapped in `act` so React state updates from subscribers flush. */
export function setViewport(width: number): void {
  const before = currentWidth;
  currentWidth = width;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  act(() => {
    for (const { query, listener } of [...subscriptions]) {
      if (evaluate(query, before) !== evaluate(query, width)) {
        listener({ matches: evaluate(query, width), media: query } as MediaQueryListEvent);
      }
    }
  });
}

export function resetViewport(): void {
  currentWidth = DESKTOP_WIDTH;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: DESKTOP_WIDTH });
  subscriptions.clear();
}
