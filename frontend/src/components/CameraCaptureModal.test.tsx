import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraCaptureModal } from './CameraCaptureModal';

function stubMedia(impl: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value: impl, configurable: true });
}

describe('Camera capture (REQ-MEM-002)', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => stubMedia(undefined));

  it('a denied camera shows a message pointing to Upload Photo (never a dead end)', async () => {
    stubMedia({ getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) });
    render(<CameraCaptureModal onCapture={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/Couldn't access the camera.*Upload Photo/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Capture photo' })).toBeNull();
  });

  it('a browser without getUserMedia says so and points to Upload Photo', async () => {
    stubMedia(undefined);
    render(<CameraCaptureModal onCapture={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/can't access the camera.*Upload Photo/)).toBeInTheDocument();
  });

  it('Cancel closes the dialog', async () => {
    stubMedia({ getUserMedia: vi.fn().mockRejectedValue(new Error('x')) });
    const onClose = vi.fn();
    render(<CameraCaptureModal onCapture={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('with a working camera, the shutter is enabled once the stream is ready and the stream is released on close', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    stubMedia({ getUserMedia: vi.fn().mockResolvedValue(stream) });
    const { unmount } = render(<CameraCaptureModal onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture photo' })).toBeEnabled());
    unmount();
    expect(stop).toHaveBeenCalled(); // camera light goes off
  });

  it('a captured frame is returned as a JPEG File, the same shape an uploaded photo has (same pipeline)', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    stubMedia({ getUserMedia: vi.fn().mockResolvedValue(stream) });
    const onCapture = vi.fn();
    render(<CameraCaptureModal onCapture={onCapture} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture photo' })).toBeEnabled());
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() }) as never;
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(['x'], { type: 'image/jpeg' }))) as never;
    await userEvent.click(screen.getByRole('button', { name: 'Capture photo' }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    const file = onCapture.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toMatch(/^photo-\d+\.jpg$/);
  });
});
