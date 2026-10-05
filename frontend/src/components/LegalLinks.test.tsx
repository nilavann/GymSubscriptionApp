import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LegalLinks } from './LegalLinks';
import { APP_VERSION, POLICY_LINKS } from '../lib/legal-links';

describe('LegalLinks (the phone’s replacement for the footer)', () => {
  it('lists each policy label as a row, in order', () => {
    render(<LegalLinks />);
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(POLICY_LINKS);
  });

  it('shows the version and copyright line', () => {
    render(<LegalLinks />);
    expect(screen.getByText(`Fit & Fine Gym v${APP_VERSION} · © 2026`)).toBeInTheDocument();
  });

  it('has no links or buttons — the rows are inert until real policy pages exist', () => {
    render(<LegalLinks />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is a labelled region and hides its decorative logo from assistive tech', () => {
    render(<LegalLinks />);
    expect(screen.getByRole('region', { name: 'About and legal' })).toBeInTheDocument();
    expect(document.querySelector('.legal-links-logo')).toHaveAttribute('aria-hidden', 'true');
  });
});
