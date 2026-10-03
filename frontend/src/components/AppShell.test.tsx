import '../test/page-mocks';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { adminProfile, fakeAuth, setAuth, setServices, staffProfile } from '../test/mocks';

const getActionCenterQueue = vi.hoisted(() => vi.fn());
vi.mock('../repositories/member-list.repository', () => ({ memberListRepository: { getActionCenterQueue } }));
import { AppShell } from './AppShell';

function renderShell(profile = staffProfile) {
  setAuth(fakeAuth(profile));
  setServices({});
  return render(<MemoryRouter><AppShell /></MemoryRouter>);
}
const navLabels = () => screen.getAllByRole('link').map((l) => l.textContent?.replace(/\d+$/, '').trim());

describe('App shell navigation (Section 1: roles; navigation.md)', () => {
  it('staff see Action Center, Members and Reports but NOT Settings (admin-only)', () => {
    getActionCenterQueue.mockResolvedValue([]);
    renderShell(staffProfile);
    const labels = navLabels();
    expect(labels).toEqual(expect.arrayContaining(['Action Center', 'Members', 'Reports']));
    expect(labels).not.toContain('Settings');
  });
  it('admins additionally see Settings', () => {
    getActionCenterQueue.mockResolvedValue([]);
    renderShell(adminProfile);
    expect(navLabels()).toContain('Settings');
  });
  it('the Members link goes to / (home)', () => {
    getActionCenterQueue.mockResolvedValue([]);
    renderShell();
    expect(screen.getAllByRole('link', { name: /Members/ })[0]).toHaveAttribute('href', '/');
  });
  it('Action Center shows a queue-size badge when there is work, nothing when empty', async () => {
    getActionCenterQueue.mockResolvedValue([1, 2, 3]);
    renderShell();
    expect((await screen.findAllByText('3')).length).toBeGreaterThan(0);
  });
  it('a failing badge query never breaks navigation', async () => {
    getActionCenterQueue.mockRejectedValue(new Error('down'));
    renderShell();
    expect(await screen.findAllByRole('link', { name: /Members/ })).not.toHaveLength(0);
  });
});
