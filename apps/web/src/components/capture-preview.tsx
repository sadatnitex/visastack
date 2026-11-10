'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { decodePhoto } from './profile-photo/photo-canvas';

/**
 * The look-before-you-send step after a photo is taken (owner direction, 10 Nov 2026, batch F2),
 * the way a bank's identity check or a scanning app shows it: the photo, an outline frame for a
 * card or a page to judge the fit by, and Use This or Retake. Nothing is sent until Use This.
 *
 * The phone's own camera takes the picture (`capture` on a file input), because the site sends
 * `Permissions-Policy: camera=()`, which blocks a live view inside the page. The outline is drawn
 * over the finished photo, so it can never get in the way of taking it, and it ignores taps, so it
 * can never block the photo or the buttons.
 *
 * The page's security policy allows no `blob:` or `data:` images, so the photo is decoded into a
 * bitmap and drawn on a canvas, never shown through an image address (the same way as the profile
 * photo). A photo this browser cannot decode (some HEIC files) cannot be shown; the step says so
 * and still offers Use This, because the checks after sending do not depend on the preview.
 *
 * It never says the photo is good or will be accepted: the same checks run after it is sent.
 */

/** The longest side of the drawn preview, so a large photo costs the screen little memory. */
const PREVIEW_SIDE = 1280;
export function CapturePreview({
  file,
  onUse,
  onRetake,
}: {
  readonly file: File;
  readonly onUse: (file: File) => void;
  readonly onRetake: () => void;
}) {
  const headingId = useId();
  const hintId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState<'loading' | 'ready' | 'unreadable'>('loading');
  const [shape, setShape] = useState<'card' | 'page'>('card');

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    let current = true;
    let release: (() => void) | null = null;
    setShown('loading');
    decodePhoto(file).then(
      (photo) => {
        const { width, height } = photo;
        release = photo.close;
        const target = canvas.current;
        const context = target?.getContext('2d') ?? null;
        if (!current || !target || !context || width < 1 || height < 1) {
          photo.close();
          if (current) setShown('unreadable');
          return;
        }
        const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
        target.width = Math.max(1, Math.round(width * scale));
        target.height = Math.max(1, Math.round(height * scale));
        context.drawImage(photo.source, 0, 0, target.width, target.height);
        photo.close();
        release = null;
        setShape(height > width ? 'page' : 'card');
        setShown('ready');
      },
      () => {
        if (current) setShown('unreadable');
      },
    );
    return () => {
      current = false;
      release?.();
    };
  }, [file]);

  const unreadable = shown === 'unreadable';

  return (
    <section className="capture-preview" aria-labelledby={headingId} aria-describedby={hintId}>
      <h3 className="capture-title" id={headingId} ref={heading} tabIndex={-1}>
        Check Your Photo
      </h3>
      <p className="capture-hint" id={hintId}>
        {unreadable
          ? 'This device cannot show the photo here, so check it on your phone first. If it looks right, press Use This. If not, retake it.'
          : 'Is the whole card or page inside the outline, and is the writing easy to read? If not, retake it.'}
      </p>
      <div className="capture-frame" data-shape={shape} hidden={unreadable}>
        <canvas
          ref={canvas}
          className="capture-image"
          role="img"
          aria-label="Preview of what you just captured, shown so you can check it before it is sent"
        />
        {shown === 'ready' ? <span className="capture-outline" aria-hidden="true" /> : null}
      </div>
      <p className="capture-note">
        We check the file again after you send it, so a photo that looks fine here can still be
        turned away.
      </p>
      <div className="capture-actions">
        <button type="button" className="btn btn-primary" onClick={() => onUse(file)}>
          Use This
        </button>
        <button type="button" className="btn btn-secondary" onClick={onRetake}>
          Retake
        </button>
      </div>
    </section>
  );
}
