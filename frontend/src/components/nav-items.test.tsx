import { describe, expect, it } from 'vitest';
import { getNavBadge, getVisibleNavItems, isNavItemActive, NAV_ITEMS } from './nav-items';

const item = (path: string) => {
  const found = NAV_ITEMS.find((i) => i.path === path);
  if (!found) throw new Error(`no nav item for ${path}`);
  return found;
};

describe('NAV_ITEMS', () => {
  it('lists Action Center first, then Members, Reports, Settings (spec/frontend/navigation.md)', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['Action Center', 'Members', 'Reports', 'Settings']);
  });
});

describe('getVisibleNavItems', () => {
  it('shows staff three items and no Settings', () => {
    expect(getVisibleNavItems(['staff']).map((i) => i.label)).toEqual(['Action Center', 'Members', 'Reports']);
  });

  it('shows admins all four', () => {
    expect(getVisibleNavItems(['admin']).map((i) => i.label)).toEqual(['Action Center', 'Members', 'Reports', 'Settings']);
  });

  it('shows Settings to anyone holding admin among several roles', () => {
    expect(getVisibleNavItems(['trainer', 'admin'])).toContainEqual(expect.objectContaining({ label: 'Settings' }));
  });

  it('shows the non-admin items when there is no profile yet', () => {
    expect(getVisibleNavItems(undefined).map((i) => i.label)).toEqual(['Action Center', 'Members', 'Reports']);
  });
});

describe('isNavItemActive', () => {
  it.each([
    // [item path, current pathname, expected]
    ['/action-center', '/action-center', true],
    ['/action-center', '/', false],
    ['/reports', '/reports', true],
    ['/reports', '/reports/anything', true],
    ['/reports', '/reportsX', false], // whole path segments only
    // Members owns "/" exactly plus everything under /members
    ['/', '/', true],
    ['/', '/members/new', true],
    ['/', '/members/12', true],
    ['/', '/members/12/renew', true],
    ['/', '/members/12/edit', true],
    ['/', '/settings', false], // "/" is a prefix of every path; it must not match them all
    ['/', '/action-center', false],
    ['/', '/membership', false],
    // Settings owns its own path plus every admin sub-screen
    ['/settings', '/settings', true],
    ['/settings', '/plans', true],
    ['/settings', '/branches', true],
    ['/settings', '/users', true],
    ['/settings', '/users/invite', true],
    ['/settings', '/roles', true],
    ['/settings', '/audit-log', true],
    ['/settings', '/member-numbering', true],
    ['/settings', '/reports', false],
    ['/settings', '/planning', false],
  ])('%s is active on %s -> %s', (path, pathname, expected) => {
    expect(isNavItemActive(item(path), pathname)).toBe(expected);
  });

  it('highlights exactly one item on any route', () => {
    for (const pathname of ['/', '/action-center', '/reports', '/settings', '/plans', '/members/3', '/users/invite']) {
      const active = NAV_ITEMS.filter((i) => isNavItemActive(i, pathname));
      expect(active, pathname).toHaveLength(1);
    }
  });
});

describe('getNavBadge', () => {
  it('shows the queue size on Action Center only', () => {
    expect(getNavBadge(item('/action-center'), 7)).toBe(7);
    expect(getNavBadge(item('/'), 7)).toBeNull();
    expect(getNavBadge(item('/reports'), 7)).toBeNull();
  });

  it('shows no badge for an empty or unknown queue', () => {
    expect(getNavBadge(item('/action-center'), 0)).toBeNull();
    expect(getNavBadge(item('/action-center'), null)).toBeNull();
  });
});
