/**
 * Per-route metadata, attached in App.tsx as `handle: { … }` and read in AppShell with
 * `useMatches()`. Route data rather than path-matching inside components (CLAUDE.md "Responsive
 * rendering rules" #4): the route table is the single place that says which screens are
 * "drill-in" screens.
 */
export interface RouteHandle {
  /**
   * Hide the mobile bottom tab bar on this route. Drill-in screens (member detail / renew / add /
   * edit) show a back link instead of the tab bar, and forms must not have a fixed bar sitting
   * over the keyboard. No effect at >= 768px, where navigation is the sidebar.
   */
  hideTabBar?: boolean;
}

/** True when any matched route (the leaf or a parent layout) asks to hide the tab bar. */
export function shouldHideTabBar(matches: ReadonlyArray<{ handle?: unknown }>): boolean {
  return matches.some((match) => (match.handle as RouteHandle | undefined)?.hideTabBar === true);
}
