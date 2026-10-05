import { vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import type { AuthContextValue } from '../types/auth';
import { buildProfile } from './builders';

/** A signed-in staff user by default; override `currentProfile` (e.g. `buildAdminProfile()`) for admin screens. */
export function buildAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const currentProfile = overrides.currentProfile === undefined ? buildProfile() : overrides.currentProfile;
  return {
    currentProfile,
    session: currentProfile ? ({ user: { id: currentProfile.id, email: 'priya@fitandfine.in' } } as Session) : null,
    isInitialising: false,
    blockedMessage: null,
    sessionExpired: false,
    clearSessionExpired: vi.fn(),
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
