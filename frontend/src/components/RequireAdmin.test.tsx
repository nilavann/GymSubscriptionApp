import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { RequireAdmin } from './RequireAdmin';
import { buildAdminProfile, buildProfile } from '../test/builders';
import { renderWithProviders } from '../test/render';

const ui = (
  <RequireAdmin>
    <div>Admin content</div>
  </RequireAdmin>
);

describe('RequireAdmin', () => {
  it('renders the content for an admin', () => {
    renderWithProviders(ui, { auth: { currentProfile: buildAdminProfile() } });
    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });

  it('shows an inline access-denied message for staff — no redirect (navigation.md)', () => {
    renderWithProviders(ui, { auth: { currentProfile: buildProfile({ roles: ['staff'] }) } });
    expect(screen.getByText(/Access denied/)).toBeInTheDocument();
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
  });

  it('treats a user holding several roles as admin if any of them is admin', () => {
    renderWithProviders(ui, { auth: { currentProfile: buildProfile({ roles: ['trainer', 'admin'] }) } });
    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });

  it('denies when there is no profile at all', () => {
    renderWithProviders(ui, { auth: { currentProfile: null } });
    expect(screen.getByText(/Access denied/)).toBeInTheDocument();
  });
});
