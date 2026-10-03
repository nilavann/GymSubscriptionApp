import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraCaptureModal } from './CameraCaptureModal';

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream, stop };
}

function installCamera(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
}

beforeEach(() => {
  // jsdom has no video decoding or canvas; give the capture path just enough to run.
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
  );
});

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('CameraCaptureModal', () => {
  it('is a modal dialog with a Cancel button', async () => {
    installCamera(() => new Promise(() => undefined));
    const onClose = vi.fn();
    render(<CameraCaptureModal onCapture={vi.fn()} onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'Take a photo' })).toHaveAttribute('aria-modal', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks for the rear camera, video only', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream().stream);
    installCamera(getUserMedia);
    render(<CameraCaptureModal onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' }, audio: false }));
  });

  it('keeps the shutter disabled until the camera is ready, then enables it', async () => {
    installCamera(() => Promise.resolve(fakeStream().stream));
    render(<CameraCaptureModal onCapture={vi.fn()} onClose={vi.fn()} />);
    const shutter = screen.getByRole('button', { name: 'Capture photo' });
    await waitFor(() => expect(shutter).toBeEnabled());
  });

  it('captures a JPEG File and hands it to onCapture', async () => {
    installCamera(() => Promise.resolve(fakeStream().stream));
    const onCapture = vi.fn();
    render(<CameraCaptureModal onCapture={onCapture} onClose={vi.fn()} />);

    const shutter = screen.getByRole('button', { name: 'Capture photo' });
    await waitFor(() => expect(shutter).toBeEnabled());
    await userEvent.click(shutter);

    expect(onCapture).toHaveBeenCalledTimes(1);
    const file = onCapture.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toMatch(/^photo-\d+\.jpg$/);
  });

  it('releases the camera (stops every track) when it closes', async () => {
    const { stream, stop } = fakeStream();
    installCamera(() => Promise.resolve(stream));
    const { unmount } = render(<CameraCaptureModal onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture photo' })).toBeEnabled());

    unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('stops the stream if the modal closed BEFORE the camera finished starting (no leaked camera light)', async () => {
    const { stream, stop } = fakeStream();
    let resolve!: (s: MediaStream) => void;
    installCamera(() => new Promise<MediaStream>((r) => (resolve = r)));
    const { unmount } = render(<CameraCaptureModal onCapture={vi.fn()} onClose={vi.fn()} />);

    unmount();
    resolve(stream);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
  });

  it('explains a permission/hardware failure and points to Upload Photo, without a shutter', async () => {
    installCamera(() => Promise.reject(new Error('NotAllowedError')));
    render(<CameraCaptureModal onCapture={vi.fn()} onClose={vi.fn()} />);

    expect(
      await screen.findByText("Couldn't access the camera — check permissions, or use Upload Photo instead.")
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Capture photo' })).not.toBeInTheDocument();
  });

  it('explains when the browser has no camera API at all', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    render(<CameraCaptureModal onCapture={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("This browser can't access the camera. Use Upload Photo instead.")).toBeInTheDocument();
  });
});
