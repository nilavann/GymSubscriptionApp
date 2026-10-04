import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlaceholderPage } from './PlaceholderPage';

describe('PlaceholderPage', () => {
  it('shows the screen title as a heading and says it is not built yet', () => {
    render(<PlaceholderPage title="Coming Soon" />);
    expect(screen.getByRole('heading', { name: 'Coming Soon' })).toBeInTheDocument();
    expect(screen.getByText("This screen hasn't been built yet.")).toBeInTheDocument();
  });
});
