import { Outlet, ScrollRestoration, useMatches } from 'react-router-dom';
import { useServices } from '../context/services.context';
import { useActionCenterCount } from '../lib/action-center';
import { shouldHideTabBar } from '../lib/route-handle';
import { useIsTabletUp } from '../lib/use-media-query';
import { AppFooter } from './AppFooter';
import { MobileHeader } from './MobileHeader';
import { useVisibleNavItems } from './nav-items';
import { SidebarNav } from './SidebarNav';
import { TabBar } from './TabBar';
import './AppShell.css';

/**
 * Wraps every authenticated route (see spec/frontend/app-shell.md §3) — mounted only
 * inside <RequireAuth> in App.tsx, so the nav bar/sidebar structurally cannot render for
 * a signed-out visitor; /login has no access to this component at all.
 *
 * RENDER EXACTLY ONE navigation structure (rules.md rule 33, CLAUDE.md "Responsive rendering
 * rules"):
 *   >= 768px  sidebar + footer
 *   <  768px  header + bottom tab bar (the bar is left out on drill-in routes — `hideTabBar`)
 * The switch is `useIsTabletUp()` — the same px query the CSS uses — rather than mounting both and
 * hiding one with CSS, which would run both subtrees and leave two "Main navigation" landmarks.
 */
export function AppShell() {
  const { memberListRepository } = useServices();
  // Fetched ONCE, here, in the one component that is always mounted, and passed down as a prop. Had
  // the tab bar owned this, it would refetch every time it remounted (leaving a drill-in screen,
  // rotating across 768px) — CLAUDE.md "Responsive rendering rules" #3.
  const actionCenterCount = useActionCenterCount(memberListRepository);
  const items = useVisibleNavItems();
  const isTabletUp = useIsTabletUp();
  const hideTabBar = shouldHideTabBar(useMatches());
  const showTabBar = !isTabletUp && !hideTabBar;

  return (
    <div className="app-shell" data-tabbar={showTabBar ? 'on' : 'off'}>
      {/* On a phone the WINDOW scrolls and React Router doesn't reset it on navigation, so a page
          opened from mid-list inherits the old offset (clamped to the new page's height — 25px
          down on WebKit). Window scroll only: at >= 768px the scroll container is .app-shell-main,
          which this doesn't touch (same behaviour as before). See e2e/scroll.spec.ts. */}
      <ScrollRestoration />

      {isTabletUp ? <SidebarNav items={items} actionCenterCount={actionCenterCount} /> : <MobileHeader />}

      <div className="app-shell-main">
        <main className="app-shell-content">
          <Outlet />
        </main>
        {isTabletUp && <AppFooter />}
      </div>

      {showTabBar && <TabBar items={items} actionCenterCount={actionCenterCount} />}
    </div>
  );
}
