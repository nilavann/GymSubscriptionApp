import { vi } from 'vitest';
import type { Services } from '../context/services.context';
import type { AuthContextValue } from '../types/auth';
import type { Profile } from '../types/profile';

/**
 * Page tests swap the two React contexts for these holders via vi.mock (see test/page-mocks.ts) —
 * the pages themselves are exercised unmodified, only the network-facing services are fakes.
 */
export const staffProfile: Profile = { id: 'staff-1', full_name: 'Sam Staff', roles: ['staff'], is_active: true };
export const adminProfile: Profile = { id: 'admin-1', full_name: 'Ada Admin', roles: ['admin'], is_active: true };

export function fakeAuth(profile: Profile | null = staffProfile, overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    currentProfile: profile,
    session: null,
    isInitialising: false,
    blockedMessage: null,
    authLinkError: null,
    needsPasswordReset: false,
    signInWithPassword: vi.fn().mockResolvedValue(undefined),
    signInWithOAuth: vi.fn().mockResolvedValue(undefined),
    resetPasswordForEmail: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export const holder = {
  services: {} as Partial<Services>,
  auth: fakeAuth(),
};

export function setServices(services: Partial<Services>) {
  holder.services = services;
}
export function setAuth(auth: AuthContextValue) {
  holder.auth = auth;
}
