'use client';

import {
  CENTRED_CROP,
  CROP_ZOOM_MAX,
  CROP_ZOOM_MIN,
  type CropInput,
  PHOTO_SPECS,
  type PhotoFinding,
  type PhotoSpec,
  computeCropBox,
  minimumPixels,
  specAspect,
} from '@visastack/core/photo-specs';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * Visa Photo Sizes: a section that opens on a Photograph document, for the owner on the documents
 * page and, on a shared record, for a person or agency whose access includes safe copies (decided on
 * the server). When opened, it asks the server for advisory checks and a small preview, lets the person move and zoom the crop with ordinary buttons (keyboard and screen
 * reader friendly, with a spoken summary of the position), and downloads the photo at the chosen
 * published size. Nothing about the face or background is changed, and nothing claims the photo
 * will be accepted.
 */

export interface VisaPhotoSizesProps {
  readonly documentId: string;
  /** The page to come back to after confirming identity for a restricted document. */
  readonly returnTo: string;
  /** For a shared record: which relationship the viewer acts through ("individual" or an organization id). */
  readonly actingFor?: string;
}

interface CheckResult {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly findings: readonly PhotoFinding[];
  readonly preview: {
    readonly width: number;
    readonly height: number;
    readonly jpegBase64: string;
  };
}

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly result: CheckResult }
  | { readonly kind: 'reauth'; readonly url: string; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

type DownloadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'done'; readonly note: string }
  | { readonly kind: 'reauth'; readonly url: string; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

const MOVE_STEP = 0.1;
const ZOOM_STEP = 0.1;
const PREVIEW_WIDTH = 160;
const DEFAULT_SPEC_ID = 'schengen-35x45';
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "2026-10-25" as "25 Oct 2026", the same on server and browser (no time zone involved). */
export function formatCheckedOn(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : iso;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** A plain spoken summary of where the crop sits. */
export function describeCrop(crop: CropInput): string {
  const parts = [`Zoom ${round1(crop.zoom).toFixed(1)} times.`];
  const x = Math.round(Math.abs(crop.offsetX) * 100);
  const y = Math.round(Math.abs(crop.offsetY) * 100);
  if (x === 0 && y === 0) parts.push('Centred.');
  if (x !== 0) parts.push(`Moved ${x}% ${crop.offsetX < 0 ? 'left' : 'right'}.`);
  if (y !== 0) parts.push(`Moved ${y}% ${crop.offsetY < 0 ? 'up' : 'down'}.`);
  return parts.join(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, round1(value)));
}

function headLine(spec: PhotoSpec): string | null {
  if (!spec.headHeightMm) return spec.headRule;
  const height = `Head ${spec.headHeightMm.min} to ${spec.headHeightMm.max} mm from chin to top of head.`;
  return spec.headRule ? `${height} ${spec.headRule}` : height;
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

async function readMessage(response: Response): Promise<{ message: string; reauthUrl?: string }> {
  try {
    const body = (await response.json()) as { message?: unknown; reauthUrl?: unknown };
    return {
      message: typeof body.message === 'string' ? body.message : 'Something went wrong. Try again.',
      ...(typeof body.reauthUrl === 'string' ? { reauthUrl: body.reauthUrl } : {}),
    };
  } catch {
    return { message: 'Something went wrong. Try again.' };
  }
}

export function VisaPhotoSizes({ documentId, returnTo, actingFor }: VisaPhotoSizesProps) {
  const id = useId();
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' });
  const [specId, setSpecId] = useState(DEFAULT_SPEC_ID);
  const [crop, setCrop] = useState<CropInput>(CENTRED_CROP);
  const [download, setDownload] = useState<DownloadState>({ kind: 'idle' });
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spec = PHOTO_SPECS.find((s) => s.id === specId) ?? PHOTO_SPECS[0];

  const requestBody = (extra: Record<string, unknown>) =>
    JSON.stringify({ documentId, returnTo, ...(actingFor ? { actingFor } : {}), ...extra });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * The photo is only checked (and its preview made) when the person opens the section, never
   * when the page loads, so browsing documents reads no photo and uses no allowance.
   */
  const runCheck = async () => {
    setLoad({ kind: 'loading' });
    try {
      const response = await fetch('/api/documents/photo-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody({}),
      });
      if (!mounted.current) return;
      if (!response.ok) {
        const { message, reauthUrl } = await readMessage(response);
        setLoad(
          reauthUrl ? { kind: 'reauth', url: reauthUrl, message } : { kind: 'error', message },
        );
        return;
      }
      const result = (await response.json()) as CheckResult;
      if (!mounted.current) return;
      setLoad({ kind: 'ready', result });
      if (typeof createImageBitmap === 'function') {
        const decoded = await createImageBitmap(base64ToBlob(result.preview.jpegBase64));
        if (mounted.current) setBitmap(decoded);
      }
    } catch {
      if (mounted.current) {
        setLoad({ kind: 'error', message: 'We could not check this photo. Try again soon.' });
      }
    }
  };

  const aspect = spec ? specAspect(spec) : 1;
  const previewHeight = Math.round(PREVIEW_WIDTH / aspect);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap || load.kind !== 'ready') return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const box = computeCropBox(bitmap.width, bitmap.height, aspect, crop);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      bitmap,
      box.left,
      box.top,
      box.width,
      box.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }, [bitmap, aspect, crop, load.kind]);

  if (!spec) return null;

  const move = (dx: number, dy: number) =>
    setCrop((c) => ({
      ...c,
      offsetX: clamp(c.offsetX + dx, -1, 1),
      offsetY: clamp(c.offsetY + dy, -1, 1),
    }));
  const zoom = (dz: number) =>
    setCrop((c) => ({ ...c, zoom: clamp(c.zoom + dz, CROP_ZOOM_MIN, CROP_ZOOM_MAX) }));

  const startDownload = async () => {
    setDownload({ kind: 'working' });
    try {
      const response = await fetch('/api/documents/photo-size', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody({ specId: spec.id, ...crop }),
      });
      if (!response.ok || response.headers.get('content-type') !== 'image/jpeg') {
        const { message, reauthUrl } = await readMessage(response);
        setDownload(
          reauthUrl ? { kind: 'reauth', url: reauthUrl, message } : { kind: 'error', message },
        );
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `visa-photo-${spec.id}.jpg`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      const withinLimits = response.headers.get('X-Photo-Size-Within-Limits') !== 'no';
      setDownload({
        kind: 'done',
        note: withinLimits
          ? `Downloaded ${spec.name}.`
          : `Downloaded ${spec.name}, but the file could not be kept inside the published file size limits.`,
      });
    } catch {
      setDownload({ kind: 'error', message: 'The download did not finish. Try again.' });
    }
  };

  const ready = load.kind === 'ready' ? load.result : null;
  const sizeWarning = (() => {
    if (!ready) return null;
    const box = computeCropBox(ready.sourceWidth, ready.sourceHeight, aspect, crop);
    const need = minimumPixels(spec);
    if (box.width >= need.width && box.height >= need.height) return null;
    return spec.pixels
      ? `At this zoom the photo is too small for ${spec.sizeLabel}.`
      : `At this zoom the photo is too small to print at ${spec.sizeLabel}.`;
  })();
  const head = headLine(spec);

  return (
    <details
      className="visa-photo"
      onToggle={(event) => {
        if (event.currentTarget.open && load.kind === 'idle') void runCheck();
      }}
    >
      <summary className="visa-photo-title">Visa Photo Sizes</summary>
      <p className="visa-photo-note">
        Choose the size your application asks for, then move and zoom until your head and shoulders
        sit in the middle. The photo itself is never edited.
      </p>

      {load.kind === 'loading' ? (
        <output className="visa-photo-note" aria-live="polite">
          Checking your photo...
        </output>
      ) : null}
      {load.kind === 'error' ? (
        <p className="notice notice-warn" role="alert">
          {load.message}
        </p>
      ) : null}
      {load.kind === 'reauth' ? (
        <p className="notice notice-warn" role="alert">
          {load.message}{' '}
          <a className="visa-photo-link" href={load.url}>
            Confirm It Is You
          </a>
        </p>
      ) : null}

      {ready ? (
        <>
          <h4 className="visa-photo-subtitle">Photo Checks</h4>
          {ready.findings.length === 0 ? (
            <p className="visa-photo-note">No problems found by these basic checks.</p>
          ) : (
            <ul className="visa-photo-findings">
              {ready.findings.map((finding) => (
                <li key={`${finding.id}-${finding.title}`}>
                  <strong>{finding.title}</strong>
                  <span>{finding.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="visa-photo-note">
            These checks are a guide only. They cannot tell you whether the photo will be accepted.
          </p>

          <div className="visa-photo-body">
            <div className="visa-photo-frame">
              <canvas
                ref={canvasRef}
                width={PREVIEW_WIDTH}
                height={previewHeight}
                className="visa-photo-canvas"
                role="img"
                aria-label={`Preview of the photo cropped to ${spec.sizeLabel}`}
              />
            </div>
            <div className="visa-photo-controls">
              <label className="visa-photo-label" htmlFor={`${id}-spec`}>
                Photo Size
              </label>
              <select
                id={`${id}-spec`}
                className="input visa-photo-select"
                value={spec.id}
                onChange={(event) => {
                  setSpecId(event.target.value);
                  setDownload({ kind: 'idle' });
                }}
              >
                {PHOTO_SPECS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              {spec.backgroundRule ? (
                <p className="visa-photo-note">Background: {spec.backgroundRule}</p>
              ) : null}
              {head ? <p className="visa-photo-note">{head}</p> : null}

              <fieldset className="visa-photo-adjust">
                <legend className="visa-photo-label">Move and Zoom</legend>
                <div className="visa-photo-buttons">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => move(0, -MOVE_STEP)}
                  >
                    Move Up
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => move(0, MOVE_STEP)}
                  >
                    Move Down
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => move(-MOVE_STEP, 0)}
                  >
                    Move Left
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => move(MOVE_STEP, 0)}
                  >
                    Move Right
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => zoom(ZOOM_STEP)}
                    disabled={crop.zoom >= CROP_ZOOM_MAX}
                  >
                    Zoom In
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => zoom(-ZOOM_STEP)}
                    disabled={crop.zoom <= CROP_ZOOM_MIN}
                  >
                    Zoom Out
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setCrop(CENTRED_CROP)}
                  >
                    Reset Crop
                  </button>
                </div>
                <output className="visa-photo-note" aria-live="polite">
                  {describeCrop(crop)}
                </output>
              </fieldset>
              {sizeWarning ? (
                <output className="notice notice-warn" aria-live="polite">
                  {sizeWarning}
                </output>
              ) : null}

              <button
                type="button"
                className="btn btn-primary visa-photo-download"
                onClick={startDownload}
                disabled={download.kind === 'working'}
              >
                Download This Size
              </button>
              {download.kind === 'working' ? (
                <output className="visa-photo-note" aria-live="polite">
                  Making your photo...
                </output>
              ) : null}
              {download.kind === 'done' ? (
                <output className="visa-photo-note" aria-live="polite">
                  {download.note}
                </output>
              ) : null}
              {download.kind === 'error' ? (
                <p className="notice notice-warn" role="alert">
                  {download.message}
                </p>
              ) : null}
              {download.kind === 'reauth' ? (
                <p className="notice notice-warn" role="alert">
                  {download.message}{' '}
                  <a className="visa-photo-link" href={download.url}>
                    Confirm It Is You
                  </a>
                </p>
              ) : null}
              <p className="visa-photo-source">
                Sized to the published rule (checked {formatCheckedOn(spec.checkedOn)},{' '}
                {spec.sourceTitle}). Check the current rule before submitting.{' '}
                <a
                  className="visa-photo-link"
                  href={spec.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open the Published Rule
                </a>
              </p>
            </div>
          </div>
        </>
      ) : null}
    </details>
  );
}
