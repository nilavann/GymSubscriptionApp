import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AdminTabs } from './AdminTabs';
import { renderWithProviders } from '../test/render';

describe('AdminTabs', () => {
  it('lists every admin section in order, each linking to its route', () => {
    renderWithProviders(<AdminTabs />);
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Hub', '/settings'],
      ['Plans', '/plans'],
      ['Branches', '/branches'],
      ['Users', '/users'],
      ['Roles', '/roles'],
      ['Audit Log', '/audit-log'],
      ['Numbering', '/member-numbering'],
    ]);
  });

  it('marks only the current section as active', () => {
    renderWithProviders(<AdminTabs />, { route: '/branches' });
    expect(screen.getByRole('link', { name: 'Branches' })).toHaveClass('admin-tab-active');
    expect(screen.getByRole('link', { name: 'Branches' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Plans' })).not.toHaveClass('admin-tab-active');
    expect(screen.getAllByRole('link').filter((l) => l.classList.contains('admin-tab-active'))).toHaveLength(1);
  });

  it('is a different landmark from the main navigation (so a screen reader can tell them apart)', () => {
    renderWithProviders(<AdminTabs />);
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });
});
