// Deterministic initials-avatar color, keyed off member id — see spec/frontend/screens.md
// WSCR-02 (hash id -> color from a fixed palette). Previously reused Brand/Status tokens
// directly, which meant a member's avatar could render in --color-status-danger purely by
// hash coincidence, with zero relation to that member's actual subscription status sitting
// right next to it. Uses the dedicated categorical palette (tokens.css --color-data-*)
// instead — colors with no semantic meaning to borrow.
const AVATAR_PALETTE = [
  'var(--color-data-1)',
  'var(--color-data-2)',
  'var(--color-data-3)',
  'var(--color-data-4)',
  'var(--color-data-5)',
  'var(--color-data-6)',
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
