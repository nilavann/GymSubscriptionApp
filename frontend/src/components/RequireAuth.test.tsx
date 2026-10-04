import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { RequireAuth } from './RequireAuth';
import { buildProfile } from '../test/builders';
import { renderRoutes } from '../test/render';

const routes = [
  { path: '/login', element: <div>Login screen</div> },
  { path: '/reset-password', element: <div>Reset password screen</div> },
  {
    path: '/private',
    element: (
      <RequireAuth>
        <div>Private content</div>
      </RequireAuth>
    ),
  },
];

describe('RequireAuth', () => {
  it('shows the loading view — never the content, never a redirect — while the session resolves', () => {
    renderRoutes(routes, { route: '/private', auth: { isInitialising: true, currentProfile: null } });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Private content')).not.toBeInTheDocument();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
  });

  it('redirects a signed-out visitor to /login', () => {
    renderRoutes(routes, { route: '/private', auth: { currentProfile: null } });
    expect(screen.getByText('Login screen')).toBeInTheDocument();
    expect(screen.queryByText('Private content')).not.toBeInTheDocument();
  });

  it('renders the content for a signed-in user', () => {
    renderRoutes(routes, { route: '/private', auth: { currentProfile: buildProfile() } });
    expect(screen.getByText('Private content')).toBeInTheDocument();
  });

  it('sends a password-recovery session to /reset-password instead of letting it into the app', () => {
    renderRoutes(routes, { route: '/private', auth: { currentProfile: buildProfile(), needsPasswordReset: true } });
    expect(screen.getByText('Reset password screen')).toBeInTheDocument();
    expect(screen.queryByText('Private content')).not.toBeInTheDocument();
  });
});
