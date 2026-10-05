import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { SidebarNav } from './SidebarNav';
import { getVisibleNavItems } from './nav-items';
import { renderWithProviders } from '../test/render';
import { buildAdminProfile } from '../test/builders';

const staff = getVisibleNavItems(['staff']);
const admin = getVisibleNavItems(['admin']);

describe('SidebarNav', () => {
  it('is a single "Main navigation" landmark carrying the brand mark', () => {
    renderWithProviders(<SidebarNav items={staff} actionCenterCount={null} />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByText('Fit & Fine')).toBeInTheDocument();
  });

  it('lists the nav items, with Settings for admins only', () => {
    renderWithProviders(<SidebarNav items={staff} actionCenterCount={null} />);
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Action Center', 'Members', 'Reports']);
  });

  it('shows Settings to an admin', () => {
    renderWithProviders(<SidebarNav items={admin} actionCenterCount={null} />);
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('marks the current section, including on sub-screens', () => {
    renderWithProviders(<SidebarNav items={admin} actionCenterCount={null} />, {
      route: '/users/invite',
      auth: { currentProfile: buildAdminProfile() },
    });
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveClass('app-shell-nav-item-active');
  });

  it('puts the queue size badge on Action Center', () => {
    renderWithProviders(<SidebarNav items={staff} actionCenterCount={12} />);
    expect(within(screen.getByRole('link', { name: /Action Center/ })).getByText('12')).toBeInTheDocument();
  });

  it('has a Sign Out button — the only way staff can sign out at this width — that signs out', async () => {
    const { auth, user } = renderWithProviders(<SidebarNav items={staff} actionCenterCount={null} />);
    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});
