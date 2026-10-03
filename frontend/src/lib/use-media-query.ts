import { useCallback, useSyncExternalStore } from 'react';

/**
 * The app's single layout breakpoint, as a px media query — the SAME value the page CSS uses
 * (`@media (min-width: 768px)`), so a JS decision and a CSS rule can never disagree. Do not derive
 * this from tokens.css's `--breakpoint-tablet: 48rem`: that is rem-based and only equals 768px at
 * the browser's default font size (CLAUDE.md "Responsive rendering rules" #2).
 */
export const TABLET_UP_QUERY = '(min-width: 768px)';

/**
 * Live `matchMedia` match, for deciding WHICH markup React renders (render exactly one of the
 * mobile/desktop versions — never mount both and hide one with CSS). Built on
 * `useSyncExternalStore`, so the first render already has the right answer (no flash of the wrong
 * layout) and a resize/rotation across the breakpoint re-renders immediately. This is a client-only
 * SPA: there is no server snapshot to reconcile.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query]
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** True at >= 768px (tablet/desktop), false below (mobile). */
export function useIsTabletUp(): boolean {
  return useMediaQuery(TABLET_UP_QUERY);
}
