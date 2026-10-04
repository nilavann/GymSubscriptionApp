import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppFooter } from './AppFooter';
import { APP_VERSION, POLICY_LINKS } from '../lib/legal-links';

describe('AppFooter', () => {
  it('is the page’s contentinfo landmark', () => {
    render(<AppFooter />);
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('shows the brand, the version, and every policy label from the shared list', () => {
    render(<AppFooter />);
    expect(screen.getByText('Fit & Fine')).toBeInTheDocument();
    expect(screen.getByText(`Fit & Fine Gym member management · v${APP_VERSION}`)).toBeInTheDocument();
    for (const label of POLICY_LINKS) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders the policy labels as plain text, not dead links (no policy pages exist yet)', () => {
    render(<AppFooter />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('carries the copyright line', () => {
    render(<AppFooter />);
    expect(screen.getByText(/© 2026 Fit & Fine Gym/)).toBeInTheDocument();
  });
});
