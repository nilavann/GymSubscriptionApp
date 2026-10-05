import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { BackLink } from './BackLink';
import { renderRoutes } from '../test/render';

describe('BackLink', () => {
  it('is a link to the given route, labelled with its text', () => {
    renderRoutes([{ path: '/', element: <BackLink to="/members/12">Member</BackLink> }]);
    const link = screen.getByRole('link', { name: 'Member' });
    expect(link).toHaveAttribute('href', '/members/12');
  });

  it('hides its arrow icon from assistive tech so the accessible name is just the label', () => {
    renderRoutes([{ path: '/', element: <BackLink to="/">Members</BackLink> }]);
    expect(screen.getByRole('link')).toHaveAccessibleName('Members');
    expect(screen.getByRole('link').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('navigates to the route on click', async () => {
    const { user, router } = renderRoutes([
      { path: '/', element: <BackLink to="/members">Members</BackLink> },
      { path: '/members', element: <p>Members page</p> },
    ]);
    await user.click(screen.getByRole('link', { name: 'Members' }));
    expect(router.state.location.pathname).toBe('/members');
    expect(screen.getByText('Members page')).toBeInTheDocument();
  });
});
