import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { fakeServices } from '../test/fakes';
import { renderWithProviders, type RenderOptions } from '../test/render';
import { buildAdminProfile } from '../test/builders';
import { MOBILE_WIDTH } from '../test/viewport';

type Count = ReturnType<typeof vi.fn>;

function renderSettings(
  options: RenderOptions & { counts?: Partial<Record<'member' | 'plan' | 'branch' | 'profile' | 'role' | 'subscription' | 'audit', Count>> } = {}
) {
  const { counts = {}, ...rest } = options;
  const count = (key: keyof typeof counts, value: number) => counts[key] ?? vi.fn().mockResolvedValue(value);
  const fns = {
    member: count('member', 120),
    plan: count('plan', 6),
    branch: count('branch', 3),
    profile: count('profile', 9),
    role: count('role', 2),
    subscription: count('subscription', 455),
    audit: count('audit', 1800),
  };
  const utils = renderWithProviders(<SettingsPage />, {
    auth: { currentProfile: buildAdminProfile({ full_name: 'Priya Sharma' }) },
    ...rest,
    services: fakeServices({
      memberRepository: { getCount: fns.member },
      planRepository: { getCount: fns.plan },
      branchRepository: { getCount: fns.branch },
      profileRepository: { getCount: fns.profile },
      roleRepository: { getCount: fns.role },
      subscriptionRepository: { getCount: fns.subscription },
      auditLogRepository: { getCount: fns.audit },
    }),
  });
  return { ...utils, fns };
}

const ready = () => screen.findByRole('heading', { name: 'Settings' });
const card = (label: string) => screen.getByText(label, { selector: '.settings-card-label' }).closest('.settings-card') as HTMLElement;

describe('SettingsPage — account', () => {
  it('shows the signed-in admin with the same initials the mobile header uses, their email and role', async () => {
    renderSettings();
    await ready();
    const profile = document.querySelector('.settings-profile-card') as HTMLElement;
    expect(within(profile).getByText('PS')).toBeInTheDocument(); // not "PR" (slice(0,2)) — consistent with MobileHeader
    expect(within(profile).getByText('Priya Sharma')).toBeInTheDocument();
    expect(within(profile).getByText('priya@fitandfine.in')).toBeInTheDocument();
    expect(within(profile).getByText('admin')).toHaveClass('settings-role-admin');
  });

  it('Sign Out signs out', async () => {
    const { user, auth } = renderSettings();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('Change Password sends a reset email to the signed-in address and confirms', async () => {
    const { user, auth } = renderSettings();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('priya@fitandfine.in');
    expect(await screen.findByText('Password reset email sent — check your inbox.')).toBeInTheDocument();
  });

  it('Change Password says so when the email could not be sent', async () => {
    const { user, auth } = renderSettings();
    await ready();
    (auth.resetPasswordForEmail as Count).mockRejectedValue(new Error('smtp down'));
    await user.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(await screen.findByText('Something went wrong sending the reset email. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/smtp/)).not.toBeInTheDocument();
  });

  it('disables Change Password while the email is being sent', async () => {
    const { user, auth } = renderSettings();
    await ready();
    (auth.resetPasswordForEmail as Count).mockReturnValue(new Promise(() => undefined));
    await user.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeDisabled();
  });
});

describe('SettingsPage — appearance', () => {
  it('offers the four tints with Amber (the default) selected, and two radii', async () => {
    renderSettings();
    await ready();
    const tints = within(document.querySelectorAll('.settings-theme-swatch-row')[0] as HTMLElement).getAllByRole('button');
    expect(tints.map((b) => b.textContent)).toEqual(['Amber', 'Wild', 'Sky', 'Violet']);
    expect(screen.getByRole('button', { name: 'Amber' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Soft' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('choosing a tint or radius applies it to the page immediately', async () => {
    const { user } = renderSettings();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Violet' }));
    await user.click(screen.getByRole('button', { name: 'Sharp' }));

    expect(document.documentElement.getAttribute('data-tint')).toBe('violet');
    expect(document.documentElement.getAttribute('data-radius')).toBe('sharp');
    expect(screen.getByRole('button', { name: 'Violet' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Amber' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SettingsPage — data management', () => {
  it('shows a live count on each card, and links the ones that have a screen', async () => {
    renderSettings();
    await ready();
    await vi.waitFor(() => expect(within(card('Members')).getByText('120')).toBeInTheDocument());

    expect(within(card('Plans')).getByText('6')).toBeInTheDocument();
    expect(within(card('Subscriptions')).getByText('455')).toBeInTheDocument();
    expect(within(card('Audit Log')).getByText('1800')).toBeInTheDocument();

    expect(card('Members')).toHaveAttribute('href', '/');
    expect(card('Plans')).toHaveAttribute('href', '/plans');
    expect(card('Branches')).toHaveAttribute('href', '/branches');
    expect(card('Manage Users')).toHaveAttribute('href', '/users');
    expect(card('Roles')).toHaveAttribute('href', '/roles');
    expect(card('Audit Log')).toHaveAttribute('href', '/audit-log');
    expect(card('Member Numbering')).toHaveAttribute('href', '/member-numbering');
    expect(card('Subscriptions')).not.toHaveAttribute('href'); // a count only — no screen for it
  });

  it('a failing count shows its own Retry without breaking the other cards', async () => {
    const plan = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(6);
    const { user } = renderSettings({ counts: { plan } });
    await ready();

    const plans = card('Plans');
    const retry = await within(plans).findByRole('button', { name: 'Retry' });
    await vi.waitFor(() => expect(within(card('Members')).getByText('120')).toBeInTheDocument()); // others unaffected

    await user.click(retry);
    await vi.waitFor(() => expect(within(card('Plans')).getByText('6')).toBeInTheDocument());
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it('carries the admin section tabs', async () => {
    renderSettings();
    await ready();
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
  });
});

describe('SettingsPage — legal links replace the footer on a phone only', () => {
  it('shows them below 768px', async () => {
    renderSettings({ viewport: MOBILE_WIDTH });
    await ready();
    expect(screen.getByRole('region', { name: 'About and legal' })).toBeInTheDocument();
  });

  it('does not render them at desktop width (the footer owns that)', async () => {
    renderSettings({ viewport: 1280 });
    await ready();
    expect(screen.queryByRole('region', { name: 'About and legal' })).not.toBeInTheDocument();
  });
});
