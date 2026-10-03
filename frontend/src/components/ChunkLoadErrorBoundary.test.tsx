import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { ChunkLoadErrorBoundary } from './ChunkLoadErrorBoundary';
import { allowConsoleError } from '../test/console';

function Boom(): never {
  throw new Error('Failed to fetch dynamically imported module');
}

describe('ChunkLoadErrorBoundary', () => {
  it('renders its children when nothing fails', () => {
    render(
      <ChunkLoadErrorBoundary>
        <p>All good</p>
      </ChunkLoadErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('replaces a crashed subtree with a recoverable message instead of a blank app', () => {
    allowConsoleError(/Failed to fetch dynamically imported module/, /The above error occurred/);
    render(
      <ChunkLoadErrorBoundary>
        <Boom />
      </ChunkLoadErrorBoundary>
    );
    expect(screen.getByText(/Something went wrong — reload to get the latest version/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('reloads the page when Reload is pressed', async () => {
    allowConsoleError(/Failed to fetch dynamically imported module/, /The above error occurred/);
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);

    render(
      <ChunkLoadErrorBoundary>
        <Boom />
      </ChunkLoadErrorBoundary>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
