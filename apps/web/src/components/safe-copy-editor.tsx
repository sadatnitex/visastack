'use client';

import {
  REDACTION_LIMITS,
  type RedactionBox,
  clampRedactionBox,
  describeRedactionBox,
  moveRedactionBox,
  resizeRedactionBox,
} from '@visastack/core/redaction-boxes';
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from 'react';
import { SafeCopyDownload, readMessage } from './safe-copy-download';

/**
 * Safe Copy (ADR 0022, S23): the owner's section on the documents page for hiding parts of a
 * document before it is shared. It opens like Visa Photo Sizes, as a disclosure inside the
 * selected document, and nothing is read until the owner chooses Prepare Safe Copy.
 *
 * - One page at a time, drawn fresh by the server. Black boxes sit over the page; each box is a
 *   focusable control and is also listed as text with its page and position.
 * - Keyboard: Tab reaches each box; arrow keys move it; Shift with an arrow key changes its size;
 *   Delete or Backspace removes it; Add Box puts a new box in the middle of the page and focuses
 *   it. The same moves are buttons for touch and switch users. Draw Boxes lets a mouse, pen or
 *   finger drag out a new box (off by default, so a finger still scrolls the page).
 * - Suggestions (passport lines, the owner's own numbers, account numbers) arrive marked as
 *   suggestions; each must be accepted or removed before review.
 * - Review shows every page with its black boxes before anything is saved: "Check every page.
 *   Only the black boxes are hidden." Nothing to Hide on This Document is its own explicit choice.
 * - Every change is announced in a polite status line; errors use an alert.
 */

export type SafeCopyStateName =
  | 'NOT_PREPARED'
  | 'MASKED'
  | 'NOTHING_TO_HIDE'
  | 'UNSUPPORTED'
  | 'TOO_LARGE';

export const SAFE_COPY_STATE_LABELS: Readonly<Record<SafeCopyStateName, string>> = {
  NOT_PREPARED: 'Safe Copy: Not Prepared Yet',
  MASKED: 'Safe Copy: Ready',
  NOTHING_TO_HIDE: 'Safe Copy: Ready, Nothing Hidden',
  UNSUPPORTED: 'Safe Copy: Not Available',
  TOO_LARGE: 'Safe Copy: Too Large',
};

export type SuggestionReason = 'mrz' | 'identifier' | 'account_number';

const SUGGESTION_WORDS: Readonly<Record<SuggestionReason, string>> = {
  mrz: 'passport lines',
  identifier: 'one of your identity numbers',
  account_number: 'an account number',
};

export interface EditorBox {
  readonly id: string;
  readonly box: RedactionBox;
  /** Set for a box that came from a suggestion; `accepted` once the owner accepts it. */
  readonly suggestion?: { readonly reason: SuggestionReason; readonly accepted: boolean };
}

/** A step of one per cent of the page for moves and size changes. */
export const STEP = 0.01;
const NEW_BOX: RedactionBox = { x: 0.35, y: 0.47, w: 0.3, h: 0.06 };
/** Units of the overlay drawing: a page is 1000 by 1000, stretched to the page image. */
const UNITS = 1000;

export type BoxKeyAction =
  | { readonly kind: 'move'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'resize'; readonly dw: number; readonly dh: number }
  | { readonly kind: 'remove' }
  | { readonly kind: 'none' };

/** What a key does to the focused box: arrows move, Shift with an arrow resizes, Delete removes. */
export function boxKeyAction(key: string, shiftKey: boolean): BoxKeyAction {
  const arrows: Record<string, readonly [number, number]> = {
    ArrowLeft: [-STEP, 0],
    ArrowRight: [STEP, 0],
    ArrowUp: [0, -STEP],
    ArrowDown: [0, STEP],
  };
  const arrow = arrows[key];
  if (arrow) {
    const [x, y] = arrow;
    return shiftKey ? { kind: 'resize', dw: x, dh: y } : { kind: 'move', dx: x, dy: y };
  }
  if (key === 'Delete' || key === 'Backspace') return { kind: 'remove' };
  return { kind: 'none' };
}

export function describeEditorBox(item: EditorBox, index: number, page: number): string {
  const where = `Box ${index + 1} on page ${page}: ${describeRedactionBox(item.box)}.`;
  if (!item.suggestion) return where;
  const why = SUGGESTION_WORDS[item.suggestion.reason];
  return item.suggestion.accepted
    ? `${where} Suggested for ${why}, accepted.`
    : `${where} Suggested for ${why}, not accepted yet.`;
}

interface PageImage {
  readonly url: string;
}

type ImageState = PageImage | 'loading' | 'error';

interface EditorInfo {
  readonly versionId: string;
  readonly pageCount: number;
  readonly canSave: boolean;
}

type Step = 'closed' | 'loading' | 'edit' | 'review' | 'saved';

let nextBoxId = 0;
function boxId(): string {
  nextBoxId += 1;
  return `box-${nextBoxId}`;
}

function fromSaved(saved: unknown): EditorBox[][] | undefined {
  if (!Array.isArray(saved)) return undefined;
  return saved.map((page) =>
    Array.isArray(page)
      ? (page as RedactionBox[]).map((box) => ({ id: boxId(), box: clampRedactionBox(box) }))
      : [],
  );
}

export interface SafeCopyEditorProps {
  readonly documentId: string;
  readonly returnTo: string;
  readonly initialState: SafeCopyStateName;
}

export function SafeCopyEditor({ documentId, returnTo, initialState }: SafeCopyEditorProps) {
  const id = useId();
  const sectionId = `safe-copy-${documentId}`;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const [state, setState] = useState<SafeCopyStateName>(initialState);
  const [step, setStep] = useState<Step>('closed');
  const [info, setInfo] = useState<EditorInfo | null>(null);
  const [pages, setPages] = useState<EditorBox[][]>([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [images, setImages] = useState<Record<number, ImageState>>({});
  const [nothingToHide, setNothingToHide] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<RedactionBox | null>(null);
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState<{ message: string; reauthUrl?: string } | null>(null);
  const [busy, setBusy] = useState<'suggest' | 'save' | 'clear' | null>(null);
  const urls = useRef<string[]>([]);
  const drag = useRef<
    | { kind: 'move'; boxId: string; startX: number; startY: number; origin: RedactionBox }
    | { kind: 'draw'; startX: number; startY: number }
    | null
  >(null);
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const url of urls.current) URL.revokeObjectURL(url);
    };
  }, []);

  // A link to this section (#safe-copy-<document>) opens it, on load and when the address changes.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === `#${sectionId}` && detailsRef.current) {
        detailsRef.current.open = true;
      }
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [sectionId]);

  // After a box is added or removed, focus lands on the box asked for (or Add Box).
  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    if (target === 'add') {
      addRef.current?.focus();
      return;
    }
    const element = overlayRef.current?.querySelector<SVGRectElement>(`[data-box="${target}"]`);
    element?.focus();
  });

  const request = (path: string, extra: Record<string, unknown>) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, returnTo, ...extra }),
    });

  const fail = async (response: Response) => {
    const read = await readMessage(response);
    if (mounted.current) setProblem(read);
  };

  const loadPage = async (index: number, versionId: string) => {
    if (images[index] && images[index] !== 'error') return;
    setImages((all) => ({ ...all, [index]: 'loading' }));
    try {
      const response = await request('/api/documents/redaction-page', {
        versionId,
        page: index + 1,
      });
      if (!response.ok || response.headers.get('content-type') !== 'image/jpeg') {
        await fail(response);
        if (mounted.current) setImages((all) => ({ ...all, [index]: 'error' }));
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      urls.current.push(url);
      if (mounted.current) setImages((all) => ({ ...all, [index]: { url } }));
    } catch {
      if (mounted.current) {
        setImages((all) => ({ ...all, [index]: 'error' }));
        setProblem({ message: 'This page could not be shown. Try again.' });
      }
    }
  };

  const start = async () => {
    if (step === 'loading') return;
    setProblem(null);
    setStep('loading');
    try {
      const response = await request('/api/documents/redaction-editor', {});
      if (!response.ok) {
        await fail(response);
        if (mounted.current) setStep('closed');
        return;
      }
      const body = (await response.json()) as {
        versionId: string;
        pageCount: number;
        canSave: boolean;
        savedPages: unknown;
        state: SafeCopyStateName;
      };
      if (!mounted.current) return;
      const saved = fromSaved(body.savedPages);
      setInfo({ versionId: body.versionId, pageCount: body.pageCount, canSave: body.canSave });
      setPages(
        saved && saved.length === body.pageCount
          ? saved
          : Array.from({ length: body.pageCount }, () => []),
      );
      setNothingToHide(body.state === 'NOTHING_TO_HIDE');
      setCurrent(0);
      setSelected(null);
      setStep('edit');
      setStatus(
        `Page 1 of ${body.pageCount}. ${body.canSave ? '' : 'Safe copies are not ready yet, so nothing can be saved.'}`.trim(),
      );
      void loadPage(0, body.versionId);
    } catch {
      if (mounted.current) {
        setProblem({ message: 'The editor could not be opened. Try again.' });
        setStep('closed');
      }
    }
  };

  const goTo = (index: number) => {
    if (!info || index < 0 || index >= info.pageCount) return;
    setCurrent(index);
    setSelected(null);
    setStatus(`Page ${index + 1} of ${info.pageCount}.`);
    void loadPage(index, info.versionId);
  };

  const pageBoxes = pages[current] ?? [];
  const selectedIndex = pageBoxes.findIndex((item) => item.id === selected);
  const selectedBox = selectedIndex >= 0 ? pageBoxes[selectedIndex] : undefined;

  const updatePage = (index: number, change: (boxes: EditorBox[]) => EditorBox[]) =>
    setPages((all) => all.map((boxes, i) => (i === index ? change(boxes) : boxes)));

  const announce = (item: EditorBox, index: number, what: string) =>
    setStatus(`Box ${index + 1} ${what}: ${describeRedactionBox(item.box)}.`);

  const changeBox = (
    boxIdValue: string,
    change: (box: RedactionBox) => RedactionBox,
    what: string,
  ) => {
    const index = pageBoxes.findIndex((item) => item.id === boxIdValue);
    const item = pageBoxes[index];
    if (!item) return;
    const next = { ...item, box: change(item.box) };
    updatePage(current, (boxes) => boxes.map((b) => (b.id === boxIdValue ? next : b)));
    setNothingToHide(false);
    announce(next, index, what);
  };

  const addBox = (box: RedactionBox = NEW_BOX) => {
    if (pageBoxes.length >= REDACTION_LIMITS.maxBoxesPerPage) {
      setStatus('This page already has the most boxes allowed.');
      return;
    }
    const item: EditorBox = { id: boxId(), box: clampRedactionBox(box) };
    updatePage(current, (boxes) => [...boxes, item]);
    setSelected(item.id);
    setNothingToHide(false);
    focusAfter.current = item.id;
    announce(item, pageBoxes.length, 'added');
  };

  const removeBox = (boxIdValue: string) => {
    const index = pageBoxes.findIndex((item) => item.id === boxIdValue);
    if (index < 0) return;
    const rest = pageBoxes.filter((item) => item.id !== boxIdValue);
    updatePage(current, () => rest);
    const nextFocus = rest[index] ?? rest[index - 1];
    setSelected(nextFocus?.id ?? null);
    focusAfter.current = nextFocus?.id ?? 'add';
    setStatus(`Box ${index + 1} removed. ${rest.length} left on this page.`);
  };

  const acceptBox = (boxIdValue: string) => {
    const index = pageBoxes.findIndex((item) => item.id === boxIdValue);
    const item = pageBoxes[index];
    if (!item?.suggestion) return;
    const suggestion = item.suggestion;
    updatePage(current, (boxes) =>
      boxes.map((b) =>
        b.id === boxIdValue ? { ...b, suggestion: { ...suggestion, accepted: true } } : b,
      ),
    );
    setStatus(`Box ${index + 1} accepted.`);
  };

  const onBoxKey = (event: KeyboardEvent<SVGRectElement>, item: EditorBox) => {
    const action = boxKeyAction(event.key, event.shiftKey);
    if (action.kind === 'none') {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setSelected(item.id);
      }
      return;
    }
    event.preventDefault();
    setSelected(item.id);
    if (action.kind === 'remove') removeBox(item.id);
    else if (action.kind === 'move') {
      changeBox(item.id, (box) => moveRedactionBox(box, action.dx, action.dy), 'moved');
    } else {
      changeBox(item.id, (box) => resizeRedactionBox(box, action.dw, action.dh), 'resized');
    }
  };

  /** Where a pointer is on the page, as fractions of the page. */
  const pointAt = (event: PointerEvent<Element>): { x: number; y: number } | undefined => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const onBoxPointerDown = (event: PointerEvent<SVGRectElement>, item: EditorBox) => {
    const point = pointAt(event);
    if (!point) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSelected(item.id);
    drag.current = {
      kind: 'move',
      boxId: item.id,
      startX: point.x,
      startY: point.y,
      origin: item.box,
    };
  };

  const onOverlayPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    const point = pointAt(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { kind: 'draw', startX: point.x, startY: point.y };
    setDraft({ x: point.x, y: point.y, w: 0, h: 0 });
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    const point = active ? pointAt(event) : undefined;
    if (!active || !point) return;
    if (active.kind === 'move') {
      const { origin } = active;
      const moved = moveRedactionBox(origin, point.x - active.startX, point.y - active.startY);
      updatePage(current, (boxes) =>
        boxes.map((b) => (b.id === active.boxId ? { ...b, box: moved } : b)),
      );
    } else {
      setDraft({
        x: Math.min(active.startX, point.x),
        y: Math.min(active.startY, point.y),
        w: Math.abs(point.x - active.startX),
        h: Math.abs(point.y - active.startY),
      });
    }
  };

  const onPointerUp = () => {
    const active = drag.current;
    drag.current = null;
    if (!active) return;
    if (active.kind === 'move') {
      const index = pageBoxes.findIndex((b) => b.id === active.boxId);
      const item = pageBoxes[index];
      if (item) {
        setNothingToHide(false);
        announce(item, index, 'moved');
      }
      return;
    }
    const made = draft;
    setDraft(null);
    if (made && made.w >= 0.01 && made.h >= 0.005) addBox(made);
  };

  const suggest = async () => {
    if (!info || busy) return;
    setBusy('suggest');
    setProblem(null);
    try {
      const response = await request('/api/documents/redaction-suggestions', {
        versionId: info.versionId,
      });
      if (!response.ok) {
        await fail(response);
        return;
      }
      const body = (await response.json()) as {
        suggestions: { page: number; box: RedactionBox; reason: SuggestionReason }[];
      };
      if (!mounted.current) return;
      const added = body.suggestions.filter((s) => s.page >= 1 && s.page <= info.pageCount);
      setPages((all) =>
        all.map((boxes, index) => {
          const forPage = added
            .filter((s) => s.page === index + 1)
            .map((s) => ({
              id: boxId(),
              box: clampRedactionBox(s.box),
              suggestion: { reason: s.reason, accepted: false },
            }));
          return [...boxes, ...forPage].slice(0, REDACTION_LIMITS.maxBoxesPerPage);
        }),
      );
      if (added.length > 0) setNothingToHide(false);
      const pagesWith = new Set(added.map((s) => s.page)).size;
      setStatus(
        added.length === 0
          ? 'No suggestions for this document. Add boxes yourself where needed.'
          : `${added.length} suggested ${added.length === 1 ? 'box' : 'boxes'} added on ${pagesWith} ${pagesWith === 1 ? 'page' : 'pages'}. Accept or remove each one.`,
      );
    } catch {
      if (mounted.current) setProblem({ message: 'Suggestions could not be made. Try again.' });
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const totalBoxes = pages.reduce((sum, boxes) => sum + boxes.length, 0);
  const waiting = pages.reduce(
    (sum, boxes) => sum + boxes.filter((b) => b.suggestion && !b.suggestion.accepted).length,
    0,
  );

  const review = (choseNothing: boolean) => {
    if (!info) return;
    setProblem(null);
    if (choseNothing && totalBoxes > 0) {
      setProblem({ message: 'Remove every box first, or review the boxes instead.' });
      return;
    }
    if (!choseNothing && waiting > 0) {
      setProblem({ message: 'Accept or remove every suggested box first.' });
      return;
    }
    if (!choseNothing && totalBoxes === 0) {
      setProblem({
        message: 'Add a box, or choose Nothing to Hide on This Document.',
      });
      return;
    }
    setNothingToHide(choseNothing);
    setStep('review');
    setStatus(`Review: ${info.pageCount} ${info.pageCount === 1 ? 'page' : 'pages'} to check.`);
    for (let index = 0; index < info.pageCount; index++) void loadPage(index, info.versionId);
  };

  const save = async () => {
    if (!info || busy) return;
    if (!info.canSave) {
      setStatus('Safe copies are not ready yet, so nothing can be saved.');
      return;
    }
    setBusy('save');
    setProblem(null);
    try {
      const response = await request('/api/documents/redaction-masks', {
        versionId: info.versionId,
        nothingToHide,
        pages: pages.map((boxes) => ({
          boxes: boxes.map((b) => b.box),
          acceptedSuggestions: boxes.filter((b) => b.suggestion?.accepted).length,
        })),
      });
      if (!response.ok) {
        await fail(response);
        return;
      }
      const body = (await response.json()) as { state: SafeCopyStateName };
      if (!mounted.current) return;
      setState(body.state);
      setStep('saved');
      setStatus('Safe copy saved. People you share safe copies with can now download it.');
    } catch {
      if (mounted.current) setProblem({ message: 'The safe copy was not saved. Try again.' });
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy('clear');
    setProblem(null);
    try {
      // The editor reads the latest version first, so a clear always names the version shown.
      const opened = await request('/api/documents/redaction-editor', {});
      if (!opened.ok) {
        await fail(opened);
        return;
      }
      const { versionId } = (await opened.json()) as { versionId: string };
      const response = await request('/api/documents/redaction-masks', { versionId, clear: true });
      if (!response.ok) {
        await fail(response);
        return;
      }
      if (!mounted.current) return;
      setState('NOT_PREPARED');
      setStep('closed');
      setInfo(null);
      setStatus('Safe copy removed. Nothing is shared as a safe copy until you prepare it again.');
    } catch {
      if (mounted.current) setProblem({ message: 'The safe copy was not removed. Try again.' });
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const ready = state === 'MASKED' || state === 'NOTHING_TO_HIDE';
  const unavailable = state === 'UNSUPPORTED' || state === 'TOO_LARGE';
  const pageCount = info?.pageCount ?? 0;
  const image = images[current];

  const pageView = (index: number, interactive: boolean) => {
    const shown = images[index];
    const boxes = pages[index] ?? [];
    return (
      <div className="safe-copy-page">
        {shown && shown !== 'loading' && shown !== 'error' ? (
          <img
            className="safe-copy-page-image"
            src={shown.url}
            alt={`Page ${index + 1} of ${pageCount}`}
            draggable={false}
          />
        ) : (
          <div className="safe-copy-page-placeholder">
            {shown === 'error' ? 'This page could not be shown.' : 'Loading the page...'}
          </div>
        )}
        <svg
          ref={interactive ? overlayRef : undefined}
          className={`safe-copy-overlay${interactive && drawing ? ' safe-copy-overlay-drawing' : ''}`}
          viewBox={`0 0 ${UNITS} ${UNITS}`}
          preserveAspectRatio="none"
          aria-hidden={interactive ? undefined : true}
          onPointerDown={interactive ? onOverlayPointerDown : undefined}
          onPointerMove={interactive ? onPointerMove : undefined}
          onPointerUp={interactive ? onPointerUp : undefined}
          onPointerCancel={interactive ? onPointerUp : undefined}
        >
          <title>{`Boxes on page ${index + 1}`}</title>
          {boxes.map((item, boxIndex) => {
            const isSelected = interactive && item.id === selected;
            const pending = item.suggestion && !item.suggestion.accepted;
            return (
              <g key={item.id}>
                {isSelected ? (
                  <rect
                    className="safe-copy-ring"
                    x={item.box.x * UNITS - 6}
                    y={item.box.y * UNITS - 6}
                    width={item.box.w * UNITS + 12}
                    height={item.box.h * UNITS + 12}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                <rect
                  data-box={item.id}
                  className={`safe-copy-box${pending ? ' safe-copy-box-suggested' : ''}`}
                  x={item.box.x * UNITS}
                  y={item.box.y * UNITS}
                  width={item.box.w * UNITS}
                  height={item.box.h * UNITS}
                  vectorEffect="non-scaling-stroke"
                  {...(interactive
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': `${describeEditorBox(item, boxIndex, index + 1)} Arrow keys move it, Shift with an arrow key changes its size, Delete removes it.`,
                        'aria-pressed': isSelected,
                        onKeyDown: (event: KeyboardEvent<SVGRectElement>) => onBoxKey(event, item),
                        onPointerDown: (event: PointerEvent<SVGRectElement>) =>
                          onBoxPointerDown(event, item),
                        onFocus: () => setSelected(item.id),
                      }
                    : {})}
                />
              </g>
            );
          })}
          {interactive && draft ? (
            <rect
              className="safe-copy-draft"
              x={draft.x * UNITS}
              y={draft.y * UNITS}
              width={draft.w * UNITS}
              height={draft.h * UNITS}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      </div>
    );
  };

  return (
    <details className="safe-copy" id={sectionId} ref={detailsRef}>
      <summary className="safe-copy-title">Safe Copy</summary>
      <p className="safe-copy-state">{SAFE_COPY_STATE_LABELS[state]}</p>
      <p className="safe-copy-note">
        A safe copy is a new picture of each page with the parts you choose covered in black. It is
        what people you share safe copies with can download, never the original.
      </p>
      {unavailable ? (
        <p className="safe-copy-note">
          {state === 'TOO_LARGE'
            ? 'This document is too large for a safe copy. Safe copies take up to 20 pages and 25 MB.'
            : 'Safe copies can be made from PDF files and photos only.'}
        </p>
      ) : null}

      {problem ? (
        <p className="notice notice-warn" role="alert">
          {problem.message}{' '}
          {problem.reauthUrl ? (
            <a className="safe-copy-link" href={problem.reauthUrl}>
              Confirm It Is You
            </a>
          ) : null}
        </p>
      ) : null}
      <output className="safe-copy-status" aria-live="polite">
        {status}
      </output>

      {!unavailable && (step === 'closed' || step === 'loading' || step === 'saved') ? (
        <div className="safe-copy-actions">
          <button
            type="button"
            className={ready ? 'btn btn-secondary' : 'btn btn-primary'}
            onClick={start}
            aria-disabled={step === 'loading' ? true : undefined}
          >
            {ready ? 'Change Safe Copy' : 'Prepare Safe Copy'}
          </button>
          {ready ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={clear}
              aria-disabled={busy === 'clear' ? true : undefined}
            >
              Remove Safe Copy
            </button>
          ) : null}
        </div>
      ) : null}
      {step === 'loading' ? (
        <output className="safe-copy-note" aria-live="polite">
          Opening the document...
        </output>
      ) : null}
      {ready && step !== 'edit' && step !== 'review' ? (
        <SafeCopyDownload documentId={documentId} returnTo={returnTo} />
      ) : null}

      {step === 'edit' && info ? (
        <div className="safe-copy-editor">
          <h3 className="safe-copy-subtitle">Mark What to Hide</h3>
          <p className="safe-copy-note">
            Check every page. Only the black boxes are hidden. Suggestions can miss things.
          </p>
          <div className="safe-copy-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={suggest}
              aria-disabled={busy === 'suggest' ? true : undefined}
            >
              Suggest Boxes
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              ref={addRef}
              onClick={() => addBox()}
            >
              Add Box
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-pressed={drawing}
              onClick={() => {
                setDrawing((on) => !on);
                setStatus(
                  drawing
                    ? 'Drawing is off. The page scrolls as usual.'
                    : 'Drawing is on. Drag across the page to add a box.',
                );
              }}
            >
              Draw Boxes
            </button>
          </div>

          <nav className="safe-copy-pager" aria-label="Pages">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => goTo(current - 1)}
              aria-disabled={current === 0 ? true : undefined}
            >
              Previous Page
            </button>
            <span className="safe-copy-note">
              Page {current + 1} of {pageCount}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => goTo(current + 1)}
              aria-disabled={current >= pageCount - 1 ? true : undefined}
            >
              Next Page
            </button>
          </nav>

          {pageView(current, true)}
          {image === 'error' && info ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setImages((all) => ({ ...all, [current]: 'error' }));
                void loadPage(current, info.versionId);
              }}
            >
              Show the Page Again
            </button>
          ) : null}

          {selectedBox ? (
            <fieldset className="safe-copy-adjust">
              <legend className="safe-copy-label">Selected Box</legend>
              <p className="safe-copy-note">
                {describeEditorBox(selectedBox, selectedIndex, current + 1)}
              </p>
              <div className="safe-copy-buttons">
                {(
                  [
                    ['Move Left', () => moveRedactionBox(selectedBox.box, -STEP, 0), 'moved'],
                    ['Move Right', () => moveRedactionBox(selectedBox.box, STEP, 0), 'moved'],
                    ['Move Up', () => moveRedactionBox(selectedBox.box, 0, -STEP), 'moved'],
                    ['Move Down', () => moveRedactionBox(selectedBox.box, 0, STEP), 'moved'],
                    ['Make Wider', () => resizeRedactionBox(selectedBox.box, STEP, 0), 'resized'],
                    [
                      'Make Narrower',
                      () => resizeRedactionBox(selectedBox.box, -STEP, 0),
                      'resized',
                    ],
                    ['Make Taller', () => resizeRedactionBox(selectedBox.box, 0, STEP), 'resized'],
                    [
                      'Make Shorter',
                      () => resizeRedactionBox(selectedBox.box, 0, -STEP),
                      'resized',
                    ],
                  ] as const
                ).map(([label, change, what]) => (
                  <button
                    key={label}
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => changeBox(selectedBox.id, change, what)}
                  >
                    {label}
                  </button>
                ))}
                {selectedBox.suggestion && !selectedBox.suggestion.accepted ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => acceptBox(selectedBox.id)}
                  >
                    Accept Box
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => removeBox(selectedBox.id)}
                >
                  Remove Box
                </button>
              </div>
            </fieldset>
          ) : null}

          <h3 className="safe-copy-subtitle" id={`${id}-list`}>
            Boxes on This Page
          </h3>
          {pageBoxes.length === 0 ? (
            <p className="safe-copy-note">No boxes on this page yet.</p>
          ) : (
            <ol className="safe-copy-list" aria-labelledby={`${id}-list`}>
              {pageBoxes.map((item, index) => (
                <li key={item.id}>
                  <span>{describeEditorBox(item, index, current + 1)}</span>
                  <span className="safe-copy-buttons">
                    {item.suggestion && !item.suggestion.accepted ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => acceptBox(item.id)}
                        aria-label={`Accept box ${index + 1}`}
                      >
                        Accept
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => removeBox(item.id)}
                      aria-label={`Remove box ${index + 1}`}
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="safe-copy-note">
            {totalBoxes} {totalBoxes === 1 ? 'box' : 'boxes'} on {pageCount}{' '}
            {pageCount === 1 ? 'page' : 'pages'}
            {waiting > 0 ? `, ${waiting} suggested not accepted yet` : ''}.
          </p>

          <div className="safe-copy-actions">
            <button type="button" className="btn btn-primary" onClick={() => review(false)}>
              Review Pages
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => review(true)}>
              Nothing to Hide on This Document
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' && info ? (
        <div className="safe-copy-editor">
          <h3 className="safe-copy-subtitle">Check Every Page</h3>
          <p className="safe-copy-note">Check every page. Only the black boxes are hidden.</p>
          {nothingToHide ? (
            <p className="safe-copy-note">
              You chose Nothing to Hide on This Document. Each page is shared as a picture, with no
              hidden text or file details.
            </p>
          ) : null}
          <ol className="safe-copy-review">
            {pages.map((boxes, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: pages are fixed for this version
              <li key={index}>
                <figure className="safe-copy-figure">
                  {pageView(index, false)}
                  <figcaption className="safe-copy-note">
                    Page {index + 1} of {pageCount}:{' '}
                    {boxes.length === 0
                      ? 'nothing hidden'
                      : `${boxes.length} ${boxes.length === 1 ? 'box' : 'boxes'} hidden`}
                    .
                  </figcaption>
                </figure>
              </li>
            ))}
          </ol>
          <div className="safe-copy-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              aria-disabled={busy === 'save' || !info.canSave ? true : undefined}
            >
              Save Safe Copy
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setStep('edit');
                setStatus(`Back to editing, page ${current + 1} of ${pageCount}.`);
              }}
            >
              Back to Editing
            </button>
          </div>
          {!info.canSave ? (
            <p className="safe-copy-note">
              Safe copies are not ready yet, so nothing can be saved.
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
