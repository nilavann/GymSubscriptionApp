import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router-dom';
import { routes } from './App';
import { AppShell } from './components/AppShell';
import { RequireAdmin } from './components/RequireAdmin';
import { RequireAuth } from './components/RequireAuth';
import { shouldHideTabBar } from './lib/route-handle';

// The route table is where several app-wide rules live (spec/frontend/navigation.md): who may see what, and
// which screens are drill-ins. These pin it, so changing it is a conscious act rather than an accident.

interface FlatRoute {
  path: string;
  route: RouteObject;
  insideShell: boolean;
}

function flatten(list: RouteObject[], insideShell = false): FlatRoute[] {
  return list.flatMap((route) => {
    const isShell = (route.element as ReactElement | undefined)?.type === RequireAuth;
    const here = route.path ? [{ path: route.path, route, insideShell }] : [];
    return [...here, ...flatten(route.children ?? [], insideShell || isShell)];
  });
}

const flat = flatten(routes);
const byPath = (path: string) => {
  const found = flat.find((r) => r.path === path);
  if (!found) throw new Error(`no route for ${path}`);
  return found;
};
const elementType = (path: string) => (byPath(path).route.element as ReactElement).type;

describe('route map (navigation.md)', () => {
  it('has exactly the documented routes', () => {
    expect(flat.map((r) => r.path).sort()).toEqual(
      [
        '*',
        '/',
        '/action-center',
        '/audit-log',
        '/branches',
        '/login',
        '/member-numbering',
        '/members/:id',
        '/members/:id/edit',
        '/members/:id/renew',
        '/members/new',
        '/plans',
        '/reports',
        '/reset-password',
        '/roles',
        '/settings',
        '/users',
        '/users/invite',
      ].sort()
    );
  });
});

describe('the auth shell', () => {
  it('wraps every app screen in RequireAuth → AppShell', () => {
    const layout = routes.find((r) => (r.element as ReactElement | undefined)?.type === RequireAuth);
    expect(layout).toBeDefined();
    const requireAuth = layout!.element as ReactElement<{ children: ReactElement }>;
    expect(requireAuth.props.children.type).toBe(AppShell);
  });

  it('keeps /login and /reset-password OUTSIDE the shell — a signed-out visitor must never reach app chrome', () => {
    expect(byPath('/login').insideShell).toBe(false);
    expect(byPath('/reset-password').insideShell).toBe(false);
  });

  it.each(['/', '/action-center', '/reports', '/settings', '/members/new', '/members/:id', '/plans', '/audit-log'])(
    '%s is inside the shell',
    (path) => {
      expect(byPath(path).insideShell).toBe(true);
    }
  );

  it('sends an unknown URL to the Action Center (the default tab)', () => {
    const element = byPath('*').route.element as ReactElement<{ to: string; replace: boolean }>;
    expect(element.props.to).toBe('/action-center');
    expect(element.props.replace).toBe(true);
  });
});

describe('admin-only routes are guarded by RequireAdmin (UX only — RLS is the real boundary)', () => {
  it.each(['/settings', '/plans', '/branches', '/users', '/users/invite', '/roles', '/audit-log', '/member-numbering'])(
    '%s',
    (path) => {
      expect(elementType(path)).toBe(RequireAdmin);
    }
  );

  it.each(['/', '/action-center', '/reports', '/members/new', '/members/:id', '/members/:id/renew', '/members/:id/edit'])(
    '%s is open to every signed-in user',
    (path) => {
      expect(elementType(path)).not.toBe(RequireAdmin);
    }
  );
});

describe('tab-bar visibility is route data (CLAUDE.md "Responsive rendering rules" #4)', () => {
  const drillIns = ['/members/new', '/members/:id', '/members/:id/renew', '/members/:id/edit'];

  it.each(drillIns)('%s hides the mobile tab bar', (path) => {
    expect(shouldHideTabBar([{ handle: byPath(path).route.handle }])).toBe(true);
  });

  it('and NOTHING else does — every root tab and admin sub-screen keeps it', () => {
    const others = flat.filter((r) => !drillIns.includes(r.path) && r.insideShell);
    expect(others.length).toBeGreaterThan(0);
    for (const { path, route } of others) {
      expect(shouldHideTabBar([{ handle: route.handle }]), path).toBe(false);
    }
  });
});
