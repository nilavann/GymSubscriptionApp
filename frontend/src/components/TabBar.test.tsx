import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { TabBar } from './TabBar';
import { getVisibleNavItems } from './nav-items';
import { renderWithProviders } from '../test/render';

const staff = getVisibleNavItems(['staff']);
const admin = getVisibleNavItems(['admin']);

describe('TabBar', () => {
  it('is a single "Main navigation" landmark', () => {
    renderWithProviders(<TabBar items={staff} actionCenterCount={null} />);
    expect(screen.getAllByRole('navigation', { name: 'Main navigation' })).toHaveLength(1);
  });

  it('shows three tabs to staff, linking to the right routes', () => {
    renderWithProviders(<TabBar items={staff} actionCenterCount={null} />);
    const bar = screen.getByRole('navigation', { name: 'Main navigation' });
    const links = within(bar).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Action Center', 'Members', 'Reports']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/action-center', '/', '/reports']);
  });

  it('shows admins a fourth tab, Settings', () => {
    renderWithProviders(<TabBar items={admin} actionCenterCount={null} />);
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('has NO Sign Out control — that lives in the header account menu on a phone', () => {
    renderWithProviders(<TabBar items={admin} actionCenterCount={null} />);
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
  });

  it('marks the current section with aria-current and the active class', () => {
    renderWithProviders(<TabBar items={staff} actionCenterCount={null} />, { route: '/reports' });
    const reports = screen.getByRole('link', { name: 'Reports' });
    expect(reports).toHaveAttribute('aria-current', 'page');
    expect(reports).toHaveClass('app-shell-tab-active');
    expect(screen.getByRole('link', { name: 'Members' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Members highlighted on a member sub-screen and Settings on an admin sub-screen', () => {
    renderWithProviders(<TabBar items={admin} actionCenterCount={null} />, { route: '/members/12/renew' });
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
  });

  it('highlights Settings on /plans', () => {
    renderWithProviders(<TabBar items={admin} actionCenterCount={null} />, { route: '/plans' });
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('puts the queue size badge on the Action Center tab only', () => {
    renderWithProviders(<TabBar items={staff} actionCenterCount={7} />);
    expect(within(screen.getByRole('link', { name: /Action Center/ })).getByText('7')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Members' })).queryByText('7')).not.toBeInTheDocument();
  });

  it('shows no badge for an empty queue', () => {
    renderWithProviders(<TabBar items={staff} actionCenterCount={0} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
