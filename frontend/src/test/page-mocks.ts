// Import this file (for its side effect) at the top of a page test, before the page itself.
import { vi } from 'vitest';
import { holder } from './mocks';

vi.mock('../context/services.context', () => ({
  useServices: () => holder.services,
  ServicesProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../context/auth.context', () => ({
  useAuth: () => holder.auth,
  AuthProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../lib/supabase-client', () => ({ supabase: {}, SESSION_EXPIRED_EVENT: 'supabase:session-expired' }));
