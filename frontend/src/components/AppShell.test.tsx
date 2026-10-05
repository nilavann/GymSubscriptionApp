import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { RouteObject } from 'react-router-dom';
import { AppShell } from './AppShell';
import { fakeServices } from '../test/fakes';
import { renderRoutes, type RenderOptions } from '../test/render';
import { buildAdminProfile, buildMemberListRow } from '../test/builders';
import { MOBILE_WIDTH, setViewport } from '../test/viewport';
import type { RouteHandle } from '../lib/route-handle';

const drillIn: RouteHandle = { hideTabBar: true };

const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <p>Members page</p> },
      { path: '/action-center', element: <p>Action Center page</p> },
      { path: '/settings', element: <p>Settings page</p> },
      { path: '/plans', element: <p>Plans page</p> },
      { path: '/members/new', element: <p>Add member page</p>, handle: drillIn },
      { path: '/members/:id', element: <p>Member detail page</p>, handle: drillIn },
    ],
  },
];

function renderShell(options: RenderOptions & { queue?: number } = {}) {
  const { queue = 0, services, ...rest } = options;
  const getActionCenterQueue = vi.fn().mockResolvedValue(Array.from({ length: queue }, () => buildMemberListRow()));
  const utils = renderRoutes(routes, {
    ...rest,
    services: services ?? fakeServices({ memberListRepository: { getActionCenterQueue } }),
  });
  return { ...utils, getActionCenterQueue };
}

const mainNav = () => screen.queryAllByRole('navigation', { name: 'Main navigation' });
const header = () => screen.queryByRole('banner');
const footer = () => screen.queryByRole('contentinfo');

describe('AppShell renders exactly ONE navigation structure', () => {
  it('at desktop width: the sidebar + footer — no header, no tab bar', async () => {
    renderShell({ viewport: 1280 });
    await screen.findByText('Members page');

    const nav = mainNav();
    expect(nav).toHaveLength(1);
    expect(within(nav[0]).getByText('Fit & Fine')).toBeInTheDocument();
    expect(within(nav[0]).getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    expect(footer()).toBeInTheDocument();
    expect(header()).not.toBeInTheDocument();
    expect(screen.getByText('Members page').closest('.app-shell')).toHaveAttribute('data-tabbar', 'off');
  });

  it('at phone width: the header + tab bar — no sidebar, no footer, no Sign Out tab', async () => {
    renderShell({ viewport: MOBILE_WIDTH });
    await screen.findByText('Members page');

    const nav = mainNav();
    expect(nav).toHaveLength(1);
    expect(within(nav[0]).getAllByRole('link').map((l) => l.textContent)).toEqual(['Action Center', 'Members', 'Reports']);
    expect(within(nav[0]).queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
    expect(within(nav[0]).queryByText('Fit & Fine')).not.toBeInTheDocument(); // the sidebar's brand row
    expect(header()).toBeInTheDocument();
    expect(footer()).not.toBeInTheDocument();
    expect(screen.getByText('Members page').closest('.app-shell')).toHaveAttribute('data-tabbar', 'on');
  });

  it('flips live when the window crosses 768px, keeping the page content mounted', async () => {
    renderShell({ viewport: 1280 });
    const page = await screen.findByText('Members page');
    expect(header()).not.toBeInTheDocument();

    setViewport(767);
    expect(header()).toBeInTheDocument();
    expect(footer()).not.toBeInTheDocument();
    expect(mainNav()).toHaveLength(1);
    expect(within(mainNav()[0]).queryByText('Fit & Fine')).not.toBeInTheDocument();
    expect(screen.getByText('Members page')).toBe(page); // same DOM node — not remounted

    setViewport(768);
    expect(header()).not.toBeInTheDocument();
    expect(footer()).toBeInTheDocument();
    expect(within(mainNav()[0]).getByText('Fit & Fine')).toBeInTheDocument();
    expect(screen.getByText('Members page')).toBe(page);
  });
});

describe('tab-bar visibility comes from the route (`handle: { hideTabBar }`)', () => {
  it.each(['/members/new', '/members/42'])('is left out on the drill-in route %s, but the header stays', async (route) => {
    renderShell({ viewport: MOBILE_WIDTH, route });
    await screen.findByText(/Add member page|Member detail page/);

    expect(mainNav()).toHaveLength(0);
    expect(header()).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-tabbar', 'off');
  });

  it('appears again when navigating back to a root screen', async () => {
    const { router } = renderShell({ viewport: MOBILE_WIDTH, route: '/members/42' });
    await screen.findByText('Member detail page');
    expect(mainNav()).toHaveLength(0);

    await act(() => router.navigate('/'));
    expect(await screen.findByText('Members page')).toBeInTheDocument();
    expect(mainNav()).toHaveLength(1);
  });

  it('does not affect the desktop sidebar — the handle is mobile-only', async () => {
    renderShell({ viewport: 1280, route: '/members/42' });
    await screen.findByText('Member detail page');
    expect(mainNav()).toHaveLength(1);
    expect(within(mainNav()[0]).getByText('Fit & Fine')).toBeInTheDocument();
  });
});

describe('role-based items', () => {
  it('shows staff three tabs and admins four', async () => {
    const staff = renderShell({ viewport: MOBILE_WIDTH });
    await screen.findByText('Members page');
    expect(within(mainNav()[0]).getAllByRole('link')).toHaveLength(3);
    staff.unmount();

    renderShell({ viewport: MOBILE_WIDTH, auth: { currentProfile: buildAdminProfile() } });
    await screen.findByText('Members page');
    expect(within(mainNav()[0]).getAllByRole('link').map((l) => l.textContent)).toContain('Settings');
  });

  it('highlights Settings while an admin is on a sub-screen like /plans', async () => {
    renderShell({ viewport: MOBILE_WIDTH, route: '/plans', auth: { currentProfile: buildAdminProfile() } });
    await screen.findByText('Plans page');
    expect(within(mainNav()[0]).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('the Action Center count is fetched ONCE, by the always-mounted shell', () => {
  it('shows the queue size as a badge on the Action Center tab', async () => {
    renderShell({ viewport: MOBILE_WIDTH, queue: 5 });
    await screen.findByText('Members page');
    await waitFor(() => expect(within(mainNav()[0]).getByText('5')).toBeInTheDocument());
  });

  it('shows the same count in the sidebar at desktop width', async () => {
    renderShell({ viewport: 1280, queue: 9 });
    await screen.findByText('Members page');
    await waitFor(() => expect(within(mainNav()[0]).getByText('9')).toBeInTheDocument());
  });

  it('does not refetch when the tab bar unmounts/remounts or the window crosses the breakpoint', async () => {
    const { router, getActionCenterQueue } = renderShell({ viewport: MOBILE_WIDTH, queue: 3 });
    await screen.findByText('Members page');
    await waitFor(() => expect(getActionCenterQueue).toHaveBeenCalledTimes(1));

    await act(() => router.navigate('/members/new')); // tab bar unmounts
    await act(() => router.navigate('/')); // …and remounts
    setViewport(1280); // sidebar replaces the header + tab bar
    setViewport(MOBILE_WIDTH); // …and back

    expect(getActionCenterQueue).toHaveBeenCalledTimes(1);
  });

  it('keeps the badge when the queue request fails — navigation must never break', async () => {
    const getActionCenterQueue = vi.fn().mockRejectedValue(new Error('offline'));
    renderShell({
      viewport: MOBILE_WIDTH,
      services: fakeServices({ memberListRepository: { getActionCenterQueue } }),
    });
    await screen.findByText('Members page');
    await waitFor(() => expect(getActionCenterQueue).toHaveBeenCalled());
    expect(within(mainNav()[0]).getAllByRole('link')).toHaveLength(3);
  });
});
