// Deterministic initials-avatar color, keyed off member id — see spec/frontend/screens.md
// WSCR-02 (hash id -> color from a fixed palette). A small, fixed set of existing tokens
// rather than inventing new colors — see spec/frontend/colors.md rule "no separate palette."
const AVATAR_PALETTE = [
  'var(--color-brand-primary)',
  'var(--color-status-success)',
  'var(--color-status-warning)',
  'var(--color-brand-800)',
  'var(--color-neutral-600)',
  'var(--color-status-danger)',
] as const;

export function getAvatarColor(id: number): string {
  return AVATAR_PALETTE[id % AVATAR_PALETTE.length];
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
