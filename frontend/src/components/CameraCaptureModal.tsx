import { useEffect, useRef, useState } from 'react';
import { X, Camera, RefreshCw } from 'lucide-react';
import './CameraCaptureModal.css';

/**
 * A real camera capture flow via `getUserMedia` — a `<input type="file" capture>`
 * only opens the device's native camera app on some mobile browsers, and is silently
 * ignored on desktop (always falls back to the plain file/gallery picker there, which
 * is indistinguishable from "Upload"). This component gives "Take Photo" the same
 * guaranteed camera behavior on every platform: a live preview, in-page, with no
 * native file chooser involved at all.
 */
export function CameraCaptureModal({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't access the camera. Use Upload Photo instead.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setIsReady(true);
      })
      .catch(() => {
        if (active) setError("Couldn't access the camera — check permissions, or use Upload Photo instead.");
      });

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92
    );
  }

  return (
    <div className="camera-capture-backdrop" role="dialog" aria-modal="true" aria-label="Take a photo">
      <div className="camera-capture-dialog">
        <div className="camera-capture-header">
          <span>Take Photo</span>
          <button type="button" className="camera-capture-close" onClick={onClose} aria-label="Cancel">
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {error ? (
          <div className="camera-capture-error">
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div className="camera-capture-video-wrap">
              {!isReady && <RefreshCw size={24} strokeWidth={2} className="camera-capture-spin" />}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live camera preview, not prerecorded media */}
              <video ref={videoRef} className="camera-capture-video" autoPlay playsInline muted />
            </div>
            <button type="button" className="camera-capture-shutter" onClick={handleCapture} disabled={!isReady} aria-label="Capture photo">
              <Camera size={22} strokeWidth={2} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
