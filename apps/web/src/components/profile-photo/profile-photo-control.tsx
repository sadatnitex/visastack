'use client';

import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  type ProfilePhotoResult,
  removeProfilePhotoAction,
  saveProfilePhotoAction,
} from '../../app/app/profile-photo-actions';
import { FormMessage, type FormResult, NO_RESULT } from '../form-feedback';
import {
  type Crop,
  MAX_ZOOM,
  MIN_ZOOM,
  describeCrop,
  initialCrop,
  panCrop,
  zoomCrop,
} from './crop';
import { PersonAvatar } from './person-avatar';
import { type DecodedPhoto, decodePhoto, drawPreview, exportSquareJpeg } from './photo-canvas';

/** The largest original photo the browser will open for cropping; phone photos can be large. */
export const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;
/** The same 5 MB the server enforces, checked on the cropped photo before it is sent. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const VIEW = 240;
const STEP = 12;
const ZOOM_STEP = 0.1;

type Phase = 'idle' | 'cropping' | 'saving' | 'removing';

/** Visible move controls, so the photo can be placed without dragging or arrow keys. */
const MOVE_BUTTONS: readonly (readonly [string, number, number])[] = [
  ['Move Left', -STEP * 2, 0],
  ['Move Right', STEP * 2, 0],
  ['Move Up', 0, -STEP * 2],
  ['Move Down', 0, STEP * 2],
];

/**
 * Add, replace or remove a traveller's profile photo (WP-PH1). Choosing a
 * file opens a square crop step in the page: drag or use the arrow keys to
 * move the photo, the slider or plus and minus keys to zoom, then Save Photo.
 * The browser sends only the cropped 512 x 512 JPEG; the server checks it,
 * scans it and re-encodes it again before anything is stored.
 */
export function ProfilePhotoControl({
  applicantId,
  initials,
  photoUrl: initialUrl,
  avatarClassName,
}: {
  readonly applicantId: string;
  readonly initials: string;
  readonly photoUrl: string | null;
  readonly avatarClassName: string;
}) {
  const [photoUrl, setPhotoUrl] = useState(initialUrl);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<FormResult>(NO_RESULT);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [, startTransition] = useTransition();
  const photo = useRef<DecodedPhoto | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const headingId = useId();
  const helpId = useId();
  const zoomId = useId();
  const busy = phase === 'saving' || phase === 'removing';

  useEffect(() => setPhotoUrl(initialUrl), [initialUrl]);
  useEffect(() => () => photo.current?.close(), []);
  useEffect(() => {
    if (crop && photo.current && canvas.current) drawPreview(canvas.current, photo.current, crop);
  }, [crop]);

  // What the position region says. It changes after a key or button move, a zoom, or when a drag
  // ends, never on each step of a drag, so a screen reader is not flooded while dragging.
  const [spokenPosition, setSpokenPosition] = useState('');
  useEffect(() => {
    if (crop && !drag.current) setSpokenPosition(describeCrop(crop));
  }, [crop]);
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    if (crop) setSpokenPosition(describeCrop(crop));
  };

  // Focus goes back to the photo button once it is on the page again, so keyboard and screen
  // reader users stay where they were after the crop step closes or a removal finishes.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (phase !== 'idle' || !returnFocus.current) return;
    returnFocus.current = false;
    chooseButton.current?.focus();
  }, [phase]);

  const closeCrop = useCallback(() => {
    photo.current?.close();
    photo.current = null;
    setCrop(null);
    returnFocus.current = true;
    setPhase('idle');
  }, []);

  async function onFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    if (file.size > MAX_ORIGINAL_BYTES) {
      setResult({ ok: false, message: 'Choose a photo smaller than 40 MB.' });
      return;
    }
    if (file.type !== '' && !file.type.startsWith('image/')) {
      setResult({ ok: false, message: 'Choose a photo: a JPEG, PNG, WebP or iPhone photo.' });
      return;
    }
    try {
      const decoded = await decodePhoto(file);
      photo.current?.close();
      photo.current = decoded;
      setResult(NO_RESULT);
      setCrop(initialCrop(decoded.width, decoded.height, VIEW));
      setPhase('cropping');
      requestAnimationFrame(() => area.current?.focus());
    } catch {
      setResult({
        ok: false,
        message: 'This photo cannot be opened in this browser. Try a JPEG or PNG photo.',
      });
    }
  }

  function apply(next: ProfilePhotoResult) {
    setResult({ ok: next.ok, message: next.message });
    if (next.ok && next.photoUrl !== undefined) setPhotoUrl(next.photoUrl);
  }

  function save() {
    if (busy || !crop || !photo.current) return;
    const current = photo.current;
    setPhase('saving');
    startTransition(async () => {
      try {
        const blob = await exportSquareJpeg(current, crop);
        if (blob.size > MAX_PHOTO_BYTES) {
          setResult({
            ok: false,
            message: 'The cropped photo is larger than 5 MB. Try another photo.',
          });
          setPhase('cropping');
          return;
        }
        const form = new FormData();
        form.set('applicantId', applicantId);
        form.set('photo', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
        const saved = await saveProfilePhotoAction(form);
        apply(saved);
        if (saved.ok) {
          closeCrop();
          return;
        }
      } catch {
        setResult({ ok: false, message: 'The photo could not be saved. Please try again.' });
      }
      setPhase('cropping');
    });
  }

  function remove() {
    if (busy) return;
    setPhase('removing');
    startTransition(async () => {
      try {
        const form = new FormData();
        form.set('applicantId', applicantId);
        apply(await removeProfilePhotoAction(form));
      } catch {
        setResult({ ok: false, message: 'The photo could not be removed. Please try again.' });
      }
      returnFocus.current = true;
      setPhase('idle');
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!crop) return;
    const step = event.shiftKey ? STEP * 4 : STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setCrop((current) => current && panCrop(current, move[0], move[1]));
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setCrop((current) => current && zoomCrop(current, current.zoom + ZOOM_STEP));
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setCrop((current) => current && zoomCrop(current, current.zoom - ZOOM_STEP));
    }
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || !crop) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    setCrop((current) => current && panCrop(current, dx, dy));
  }

  const cropping = crop !== null && (phase === 'cropping' || phase === 'saving');
  return (
    <div className="profile-photo-control">
      <PersonAvatar className={avatarClassName} initials={initials} photoUrl={photoUrl} />
      {cropping ? (
        <section
          className="profile-photo-crop"
          aria-labelledby={headingId}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              event.stopPropagation();
              closeCrop();
            }
          }}
        >
          <h3 id={headingId}>Crop Your Photo</h3>
          <p id={helpId} className="muted">
            Drag the photo, use the arrow keys or the move buttons to move it. Use the slider or the
            plus and minus keys to zoom.
          </p>
          {/* A button so it takes focus and keys natively; it has no click action of its own. */}
          <button
            ref={area}
            type="button"
            className="profile-photo-crop-area"
            aria-label="Photo Position"
            aria-describedby={helpId}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <canvas ref={canvas} width={VIEW} height={VIEW} />
          </button>
          {/* Where the photo sits, read out after each move, zoom or finished drag. */}
          <output className="sr-only profile-photo-position">{spokenPosition}</output>
          <div className="profile-photo-moves">
            {MOVE_BUTTONS.map(([label, dx, dy]) => (
              <button
                key={label}
                type="button"
                className="btn btn-secondary btn-compact"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) setCrop((current) => current && panCrop(current, dx, dy));
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label htmlFor={zoomId}>Zoom</label>
          <input
            id={zoomId}
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(event) =>
              setCrop((current) => current && zoomCrop(current, Number(event.target.value)))
            }
          />
          <div className="profile-photo-actions">
            <button
              type="button"
              className="btn btn-primary"
              aria-disabled={busy || undefined}
              onClick={save}
            >
              {phase === 'saving' ? 'Saving Photo' : 'Save Photo'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) closeCrop();
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <div className="profile-photo-actions">
          <button
            ref={chooseButton}
            type="button"
            className="btn btn-secondary"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) fileInput.current?.click();
            }}
          >
            {photoUrl ? 'Replace Photo' : 'Add Photo'}
          </button>
          {photoUrl ? (
            <button
              type="button"
              className="btn btn-secondary"
              aria-disabled={busy || undefined}
              onClick={remove}
            >
              {phase === 'removing' ? 'Removing Photo' : 'Remove Photo'}
            </button>
          ) : null}
        </div>
      )}
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept={ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Photo File"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      <FormMessage
        result={result}
        pending={busy}
        pendingText={phase === 'removing' ? 'Removing your photo.' : 'Saving your photo.'}
      />
    </div>
  );
}
