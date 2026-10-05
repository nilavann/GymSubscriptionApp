import { describe, expect, it } from 'vitest';
import { APP_VERSION, POLICY_LINKS } from './legal-links';

// The desktop footer and the phone's Settings list both read these, so what they show is defined once.

describe('legal links', () => {
  it('lists the four policy labels in the handoff order', () => {
    expect(POLICY_LINKS).toEqual(['Privacy Policy', 'Terms of Use', 'Refund Policy', 'Support']);
  });

  it('has no duplicate labels (they are used as React keys)', () => {
    expect(new Set(POLICY_LINKS).size).toBe(POLICY_LINKS.length);
  });

  it('exposes a semver-shaped app version', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
