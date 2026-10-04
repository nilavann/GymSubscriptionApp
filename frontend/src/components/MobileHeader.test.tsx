import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { MobileHeader } from './MobileHeader';
import { renderRoutes } from '../test/render';
import { buildAdminProfile, buildProfile } from '../test/builders';

function renderHeader(options: Parameters<typeof renderRoutes>[1] = {}) {
  return renderRoutes(
    [
      { path: '/', element: <MobileHeader /> },
      { path: '/elsewhere', element: <MobileHeader /> },
    ],
    options
  );
}

const avatarButton = () => screen.getByRole('button', { name: 'Account menu' });

describe('MobileHeader', () => {
  it('shows the brand and the signed-in user’s initials', () => {
    renderHeader({ auth: { currentProfile: buildProfile({ full_name: 'Priya Sharma' }) } });
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByText('Fit & Fine Gym')).toBeInTheDocument();
    expect(avatarButton()).toHaveTextContent('PS');
  });

  it('starts with the account menu closed and nothing of it in the DOM', () => {
    renderHeader();
    expect(avatarButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Priya Sharma')).not.toBeInTheDocument();
  });

  it('opens on tap, showing name, roles and Sign out', async () => {
    const { user } = renderHeader({
      auth: { currentProfile: buildAdminProfile({ full_name: 'Anita Admin', roles: ['admin', 'trainer'] }) },
    });
    await user.click(avatarButton());

    expect(avatarButton()).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('group', { name: 'Account' });
    expect(menu).toHaveTextContent('Anita Admin');
    expect(menu).toHaveTextContent('admin · trainer');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(avatarButton()).toHaveAttribute('aria-controls', menu.id);
  });

  it('tapping the avatar again closes it', async () => {
    const { user } = renderHeader();
    await user.click(avatarButton());
    await user.click(avatarButton());
    expect(screen.queryByRole('group', { name: 'Account' })).not.toBeInTheDocument();
    expect(avatarButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Sign out signs the user out and closes the menu', async () => {
    const { user, auth } = renderHeader();
    await user.click(avatarButton());
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('Escape closes the menu and hands focus back to the avatar button', async () => {
    const { user } = renderHeader();
    await user.click(avatarButton());
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group', { name: 'Account' })).not.toBeInTheDocument();
    expect(avatarButton()).toHaveFocus();
  });

  it('a press outside closes it, but a press inside the menu does not', async () => {
    const { user } = renderHeader();
    await user.click(avatarButton());

    fireEvent.pointerDown(screen.getByRole('group', { name: 'Account' }));
    expect(screen.getByRole('group', { name: 'Account' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('closes when the route changes (including the browser back button)', async () => {
    const { user, router } = renderHeader();
    await user.click(avatarButton());
    expect(screen.getByRole('group', { name: 'Account' })).toBeInTheDocument();

    await act(() => router.navigate('/elsewhere'));
    expect(screen.queryByRole('group', { name: 'Account' })).not.toBeInTheDocument();
  });

  describe('document listeners exist only while the menu is open', () => {
    it('attaches none on mount, two when opened, and removes both when closed', async () => {
      const add = vi.spyOn(document, 'addEventListener');
      const remove = vi.spyOn(document, 'removeEventListener');
      const count = (spy: typeof add, type: string) => spy.mock.calls.filter(([t]) => t === type).length;

      const { user } = renderHeader();
      expect(count(add, 'keydown')).toBe(0);
      expect(count(add, 'pointerdown')).toBe(0);

      await user.click(avatarButton());
      expect(count(add, 'keydown')).toBe(1);
      expect(count(add, 'pointerdown')).toBe(1);

      await user.click(avatarButton());
      expect(count(remove, 'keydown')).toBe(1);
      expect(count(remove, 'pointerdown')).toBe(1);
    });

    it('removes them on unmount while open (no leak)', async () => {
      const remove = vi.spyOn(document, 'removeEventListener');
      const { user, unmount } = renderHeader();
      await user.click(avatarButton());
      unmount();
      expect(remove.mock.calls.filter(([t]) => t === 'keydown')).toHaveLength(1);
      expect(remove.mock.calls.filter(([t]) => t === 'pointerdown')).toHaveLength(1);
    });
  });
});
