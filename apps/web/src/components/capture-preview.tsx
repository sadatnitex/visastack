'use client';

import { useEffect, useId, useRef, useState } from 'react';

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
 * It never says the photo is good or will be accepted: the same checks run after it is sent.
 */
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
  const [url, setUrl] = useState<string | null>(null);
  const [shape, setShape] = useState<'card' | 'page'>('card');
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setUnreadable(true);
      return;
    }
    const made = URL.createObjectURL(file);
    setUrl(made);
    setUnreadable(false);
    return () => URL.revokeObjectURL(made);
  }, [file]);

  return (
    <section className="capture-preview" aria-labelledby={headingId} aria-describedby={hintId}>
      <h3 className="capture-title" id={headingId} ref={heading} tabIndex={-1}>
        Check Your Photo
      </h3>
      <p className="capture-hint" id={hintId}>
        Is the whole card or page inside the outline, and is the writing easy to read? If not,
        retake it.
      </p>
      <div className="capture-frame" data-shape={shape}>
        {url && !unreadable ? (
          <img
            className="capture-image"
            src={url}
            alt="Preview of what you just captured, shown so you can check it before it is sent"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) {
                setShape(naturalHeight > naturalWidth ? 'page' : 'card');
              }
            }}
            onError={() => setUnreadable(true)}
          />
        ) : (
          <p className="capture-unreadable">
            This device cannot show a preview of the photo. You can still use it.
          </p>
        )}
        {unreadable ? null : <span className="capture-outline" aria-hidden="true" />}
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
