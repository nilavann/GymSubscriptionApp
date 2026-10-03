import '../test/page-mocks';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireAdmin } from './RequireAdmin';
import { RequireAuth } from './RequireAuth';
import { adminProfile, fakeAuth, setAuth, staffProfile } from '../test/mocks';

function guarded(el: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route path="/secret" element={el} />
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route path="/reset-password" element={<div>RESET</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RequireAdmin (REQ-ADMIN-001: admin-only screens)', () => {
  it('admin sees the screen', () => {
    setAuth(fakeAuth(adminProfile));
    guarded(<RequireAdmin><div>ADMIN SCREEN</div></RequireAdmin>);
    expect(screen.getByText('ADMIN SCREEN')).toBeInTheDocument();
  });
  it('staff is denied', () => {
    setAuth(fakeAuth(staffProfile));
    guarded(<RequireAdmin><div>ADMIN SCREEN</div></RequireAdmin>);
    expect(screen.queryByText('ADMIN SCREEN')).toBeNull();
    expect(screen.getByText(/Access denied/)).toBeInTheDocument();
  });
  it('a user holding both roles is an admin', () => {
    setAuth(fakeAuth({ ...staffProfile, roles: ['staff', 'admin'] }));
    guarded(<RequireAdmin><div>ADMIN SCREEN</div></RequireAdmin>);
    expect(screen.getByText('ADMIN SCREEN')).toBeInTheDocument();
  });
  it('a user with no roles is denied', () => {
    setAuth(fakeAuth({ ...staffProfile, roles: [] }));
    guarded(<RequireAdmin><div>ADMIN SCREEN</div></RequireAdmin>);
    expect(screen.queryByText('ADMIN SCREEN')).toBeNull();
  });
  it('no profile at all is denied', () => {
    setAuth(fakeAuth(null));
    guarded(<RequireAdmin><div>ADMIN SCREEN</div></RequireAdmin>);
    expect(screen.queryByText('ADMIN SCREEN')).toBeNull();
  });
});

describe('RequireAuth (Security NFR: only signed-in invited users)', () => {
  it('signed-out visitors go to /login', () => {
    setAuth(fakeAuth(null));
    guarded(<RequireAuth><div>PRIVATE</div></RequireAuth>);
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
  });
  it('while initialising nothing private is rendered', () => {
    setAuth(fakeAuth(null, { isInitialising: true }));
    guarded(<RequireAuth><div>PRIVATE</div></RequireAuth>);
    expect(screen.queryByText('PRIVATE')).toBeNull();
    expect(screen.queryByText('LOGIN')).toBeNull();
  });
  it('active staff are let in', () => {
    setAuth(fakeAuth(staffProfile));
    guarded(<RequireAuth><div>PRIVATE</div></RequireAuth>);
    expect(screen.getByText('PRIVATE')).toBeInTheDocument();
  });
  it('a password-recovery session is confined to /reset-password', () => {
    setAuth(fakeAuth(staffProfile, { needsPasswordReset: true }));
    guarded(<RequireAuth><div>PRIVATE</div></RequireAuth>);
    expect(screen.getByText('RESET')).toBeInTheDocument();
  });
});
