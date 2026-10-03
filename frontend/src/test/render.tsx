import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { AuthContext } from '../context/auth.context';
import { ServicesProvider, type Services } from '../context/services.context';
import { ThemeProvider } from '../context/theme.context';
import type { AuthContextValue } from '../types/auth';
import { buildAuth } from './auth';
import { setViewport } from './viewport';

export interface RenderOptions {
  /** Initial URL. Default "/". */
  route?: string;
  /** `location.state` of the initial entry — e.g. the `{ toast }` InviteUserPage hands to Manage Users. */
  routeState?: unknown;
  /** Fakes merged over the real services — use `fakeServices({...})` so an un-faked call fails loudly. */
  services?: Partial<Services>;
  /** Overrides for the (signed-in staff by default) auth value, e.g. `{ currentProfile: buildAdminProfile() }`. */
  auth?: Partial<AuthContextValue>;
  /** Viewport width in px before rendering (default desktop 1280; mobile = 390). */
  viewport?: number;
}

/**
 * Renders a full route tree inside the same providers the app uses (Theme → Services → Auth →
 * Router), on a memory router so `useMatches`, route `handle`s, `Outlet` and navigation all
 * behave as in production. Use this for layouts (AppShell) and anything navigating between routes.
 */
export function renderRoutes(routes: RouteObject[], options: RenderOptions = {}) {
  if (options.viewport !== undefined) setViewport(options.viewport);
  const router = createMemoryRouter(routes, {
    initialEntries: [{ pathname: options.route ?? '/', state: options.routeState }],
  });
  const auth = buildAuth(options.auth);
  const utils = render(
    <ThemeProvider>
      <ServicesProvider services={options.services}>
        <AuthContext.Provider value={auth}>
          <RouterProvider router={router} />
        </AuthContext.Provider>
      </ServicesProvider>
    </ThemeProvider>
  );
  return { ...utils, router, auth, user: userEvent.setup() };
}

/** Renders one screen/component at `path` (default: matches any URL). `handle` mirrors a route's `handle`. */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions & { path?: string; handle?: unknown } = {}
) {
  const { path = '*', handle, ...rest } = options;
  return renderRoutes([{ path, element: ui, handle }], rest);
}
