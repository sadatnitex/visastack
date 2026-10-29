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
 *   Delete or Backspace removes it; Escape stops a box being drawn and lets go of the selected
 *   box; Add Box puts a new box in the middle of the page and focuses it. The same moves are
 *   buttons for touch and switch users, and every box in the list has its own Select button, so a
 *   small box never has to be tapped. Draw Boxes lets a mouse, pen or finger drag out a new box
 *   (off by default, so a finger still scrolls the page).
 * - Focus follows each step: its heading on opening, review, going back and preparing; the main
 *   action again when the editor closes.
 * - Pages are held decoded only while they are needed: at most a few at once, released when the
 *   editor closes, after saving, and when another version is opened. Review draws each page as it
 *   scrolls into view.
 * - Suggestions (passport lines, the owner's own numbers, account numbers) arrive marked as
 *   suggestions; each must be accepted or removed before review.
 * - Review shows every page with its black boxes before anything is saved: "Check every page.
 *   Only the black boxes are hidden." Nothing to Hide on This Document is its own explicit choice.
 * - Every change is announced in a polite status line; errors use an alert.
 */

export type SafeCopyStateName =
  | 'NOT_PREPARED'
  | 'PREPARING'
  | 'MASKED'
  | 'NOTHING_TO_HIDE'
  | 'UNSUPPORTED'
  | 'TOO_LARGE';

export const SAFE_COPY_STATE_LABELS: Readonly<Record<SafeCopyStateName, string>> = {
  NOT_PREPARED: 'Safe Copy: Not Prepared Yet',
  PREPARING: 'Safe Copy: Preparing',
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

/** Roughly where a box sits, in words: "top left", "centre", "bottom right". */
export function roughPlace(box: RedactionBox): string {
  const middleX = box.x + box.w / 2;
  const middleY = box.y + box.h / 2;
  const across = middleX < 1 / 3 ? 'left' : middleX < 2 / 3 ? 'centre' : 'right';
  const down = middleY < 1 / 3 ? 'top' : middleY < 2 / 3 ? 'middle' : 'bottom';
  if (down === 'middle' && across === 'centre') return 'centre';
  return `${down} ${across}`;
}

/** The short name of a box control; the keyboard hint is a separate, visible paragraph. */
export function boxLabel(item: EditorBox, index: number, page: number): string {
  const name = `Box ${index + 1} on page ${page}, ${roughPlace(item.box)}`;
  if (!item.suggestion) return name;
  return item.suggestion.accepted
    ? `${name}, suggested, accepted`
    : `${name}, suggested, not accepted yet`;
}

export function describeEditorBox(item: EditorBox, index: number, page: number): string {
  const where = `Box ${index + 1} on page ${page}: ${describeRedactionBox(item.box)}.`;
  if (!item.suggestion) return where;
  const why = SUGGESTION_WORDS[item.suggestion.reason];
  return item.suggestion.accepted
    ? `${where} Suggested for ${why}, accepted.`
    : `${where} Suggested for ${why}, not accepted yet.`;
}

/**
 * A page as the browser holds it: decoded straight from the fetched bytes into an image bitmap and
 * painted on a canvas, so no image address is ever made (the page's content rules allow images
 * from this site only, and a canvas needs no image address at all).
 */
interface PageImage {
  readonly bitmap: ImageBitmap;
}

type ImageState = PageImage | 'loading' | 'error';

/** Decoded pages held at once. A decoded A4 page is several megabytes; older ones are let go. */
export const MAX_DECODED_PAGES = 3;

interface EditorInfo {
  readonly versionId: string;
  readonly pageCount: number;
  readonly canSave: boolean;
}

type Step = 'closed' | 'loading' | 'edit' | 'review' | 'preparing' | 'saved';

/** The draft kept for this browser tab while a fresh identity check is done: positions only. */
interface Draft {
  readonly pageCount: number;
  readonly pages: readonly (readonly {
    readonly box: RedactionBox;
    readonly suggestion?: { readonly reason: SuggestionReason; readonly accepted: boolean };
  }[])[];
}

function draftKey(documentId: string, versionId: string): string {
  return `safe-copy-draft:${documentId}:${versionId}`;
}

/** Reads a draft for this version, or nothing; storage that cannot be used reads as nothing. */
export function readDraft(
  documentId: string,
  versionId: string,
  pageCount: number,
): EditorBox[][] | undefined {
  try {
    const text = window.sessionStorage.getItem(draftKey(documentId, versionId));
    if (!text) return undefined;
    const draft = JSON.parse(text) as Draft;
    if (draft.pageCount !== pageCount || !Array.isArray(draft.pages)) return undefined;
    if (draft.pages.length !== pageCount) return undefined;
    return draft.pages.map((page) =>
      (Array.isArray(page) ? page : []).slice(0, REDACTION_LIMITS.maxBoxesPerPage).map((item) => ({
        id: boxId(),
        box: clampRedactionBox(item.box),
        ...(item.suggestion &&
        (item.suggestion.reason === 'mrz' ||
          item.suggestion.reason === 'identifier' ||
          item.suggestion.reason === 'account_number')
          ? {
              suggestion: {
                reason: item.suggestion.reason,
                accepted: item.suggestion.accepted === true,
              },
            }
          : {}),
      })),
    );
  } catch {
    return undefined;
  }
}

function writeDraft(documentId: string, versionId: string, pages: readonly EditorBox[][]): void {
  try {
    const draft: Draft = {
      pageCount: pages.length,
      pages: pages.map((boxes) =>
        boxes.map((item) => ({
          box: item.box,
          ...(item.suggestion ? { suggestion: item.suggestion } : {}),
        })),
      ),
    };
    window.sessionStorage.setItem(draftKey(documentId, versionId), JSON.stringify(draft));
  } catch {
    // A draft is a convenience: without storage, the boxes simply are not kept.
  }
}

function removeDraft(documentId: string, versionId: string): void {
  try {
    window.sessionStorage.removeItem(draftKey(documentId, versionId));
  } catch {
    // Nothing to remove when storage cannot be used.
  }
}

/** Paints one page bitmap on a canvas, named for people who cannot see it. */
function PageCanvas({ bitmap, label }: { readonly bitmap: ImageBitmap; readonly label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return (
    <canvas
      ref={ref}
      className="safe-copy-page-image"
      width={bitmap.width}
      height={bitmap.height}
      role="img"
      aria-label={label}
    />
  );
}

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
  /** The document's latest version, for removing a safe copy without opening the editor. */
  readonly versionId: string | null;
  readonly returnTo: string;
  readonly initialState: SafeCopyStateName;
  /** False while safe copies are off on this deployment: the section says so and offers nothing. */
  readonly available: boolean;
}

export function SafeCopyEditor({
  documentId,
  versionId: latestVersionId,
  returnTo,
  initialState,
  available,
}: SafeCopyEditorProps) {
  const id = useId();
  const sectionId = `safe-copy-${documentId}`;
  const hintId = `${id}-hint`;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const stateRef = useRef<HTMLParagraphElement>(null);
  const editHeadingRef = useRef<HTMLHeadingElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const preparingHeadingRef = useRef<HTMLHeadingElement>(null);
  const adjustRef = useRef<HTMLFieldSetElement>(null);
  const mounted = useRef(true);
  const [state, setState] = useState<SafeCopyStateName>(initialState);
  const [step, setStepState] = useState<Step>('closed');
  const stepRef = useRef<Step>('closed');
  const setStep = (next: Step) => {
    stepRef.current = next;
    setStepState(next);
  };
  const [info, setInfo] = useState<EditorInfo | null>(null);
  const [pages, setPages] = useState<EditorBox[][]>([]);
  const [current, setCurrent] = useState(0);
  const currentRef = useRef(0);
  const [selected, setSelected] = useState<string | null>(null);
  /** The box that has keyboard focus, which always shows its ring, selected or not. */
  const [focusedBox, setFocusedBox] = useState<string | null>(null);

  // Decoded pages, for one version at a time. `generation` changes whenever they are all let go,
  // so a page still arriving for an earlier opening is closed instead of kept.
  const [images, setImagesState] = useState<Record<number, ImageState>>({});
  const imagesRef = useRef<Record<number, ImageState>>({});
  const imagesVersion = useRef<string | null>(null);
  const generation = useRef(0);
  /** Decoded pages, least recently shown first. */
  const recent = useRef<number[]>([]);
  /** Review pages on screen now, which are never let go while they show. */
  const onScreen = useRef<Set<number>>(new Set());
  /** Pages shown at least once in this review, so saving can ask that every page was seen. */
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set());
  const setImages = (change: (all: Record<number, ImageState>) => Record<number, ImageState>) => {
    imagesRef.current = change(imagesRef.current);
    setImagesState(imagesRef.current);
  };
  /** Closes every decoded page and forgets them all. */
  const releaseImages = () => {
    generation.current += 1;
    for (const image of Object.values(imagesRef.current)) {
      if (typeof image === 'object') image.bitmap.close();
    }
    imagesRef.current = {};
    imagesVersion.current = null;
    recent.current = [];
    if (mounted.current) setImagesState({});
  };
  /** Lets go of the least recently shown pages past the limit, never the ones showing now. */
  const trimImages = () => {
    const keep = new Set<number>(onScreen.current);
    if (stepRef.current === 'edit') keep.add(currentRef.current);
    let decoded = recent.current.length;
    const release: number[] = [];
    for (const index of recent.current) {
      if (decoded <= MAX_DECODED_PAGES) break;
      if (keep.has(index)) continue;
      release.push(index);
      decoded -= 1;
    }
    if (release.length === 0) return;
    recent.current = recent.current.filter((index) => !release.includes(index));
    setImages((all) => {
      const next = { ...all };
      for (const index of release) {
        const image = next[index];
        if (typeof image === 'object') image.bitmap.close();
        delete next[index];
      }
      return next;
    });
  };
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [nothingToHide, setNothingToHide] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<RedactionBox | null>(null);
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState<{ message: string; reauthUrl?: string } | null>(null);
  const [busy, setBusy] = useState<'suggest' | 'save' | 'clear' | null>(null);
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
      generation.current += 1;
      for (const image of Object.values(imagesRef.current)) {
        if (typeof image === 'object') image.bitmap.close();
      }
      imagesRef.current = {};
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

  // Focus follows the step, so it is never left on a button that has gone: each step's heading,
  // the state line once the copy is ready, and the main action again when the editor closes.
  const shownStep = useRef<Step>('closed');
  useEffect(() => {
    const previous = shownStep.current;
    if (previous === step) return;
    shownStep.current = step;
    if (step === 'edit') editHeadingRef.current?.focus();
    else if (step === 'review') reviewHeadingRef.current?.focus();
    else if (step === 'preparing') preparingHeadingRef.current?.focus();
    else if (step === 'saved') stateRef.current?.focus();
    else if (step === 'closed' && previous !== 'closed') {
      (continueRef.current ?? startRef.current ?? stateRef.current)?.focus();
    }
  }, [step]);

  // After a box is added or removed, focus lands on the box asked for (or Add Box, or the
  // Selected Box controls).
  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    if (target === 'add') {
      addRef.current?.focus();
      return;
    }
    if (target === 'adjust') {
      adjustRef.current?.focus();
      return;
    }
    if (target === 'start') {
      (startRef.current ?? stateRef.current)?.focus();
      return;
    }
    const element = overlayRef.current?.querySelector<SVGRectElement>(`[data-box="${target}"]`);
    element?.focus();
  });

  // Keep the boxes for this tab while editing, so a fresh identity check (which reloads the page)
  // never loses them. Positions and page numbers only; removed on save, removal or cancel.
  useEffect(() => {
    if (!info || (step !== 'edit' && step !== 'review')) return;
    writeDraft(documentId, info.versionId, pages);
  }, [documentId, info, pages, step]);

  // Review pages draw as they scroll into view, and are let go once off screen and past the
  // limit, so a long document never holds every page decoded at once.
  const reviewListRef = useRef<HTMLOListElement>(null);
  const pageWork = useRef<{
    load: (index: number, versionId: string) => Promise<boolean>;
    trim: () => void;
  } | null>(null);
  const reviewVersion = step === 'review' ? (info?.versionId ?? null) : null;
  useEffect(() => {
    const list = reviewListRef.current;
    if (!reviewVersion || !list || typeof IntersectionObserver !== 'function') return;
    const shown = onScreen.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number(entry.target.getAttribute('data-review-page'));
          if (!Number.isSafeInteger(index)) continue;
          if (entry.isIntersecting) {
            shown.add(index);
            void pageWork.current?.load(index, reviewVersion);
          } else {
            shown.delete(index);
            pageWork.current?.trim();
          }
        }
      },
      { rootMargin: '200px 0px' },
    );
    for (const item of list.querySelectorAll('[data-review-page]')) observer.observe(item);
    return () => {
      observer.disconnect();
      shown.clear();
    };
  }, [reviewVersion]);

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

  /** Says, politely, that a page did not show and which button shows it again. */
  const pageFailed = (index: number) => {
    const again = stepRef.current === 'review' ? 'Try Again' : 'Show the Page Again';
    setStatus(`Page ${index + 1} could not be shown. Choose ${again}.`);
  };

  /** Loads one page if it is not loaded or loading yet; true once it is shown. */
  const loadPage = async (index: number, versionId: string): Promise<boolean> => {
    if (imagesVersion.current !== versionId) {
      releaseImages();
      imagesVersion.current = versionId;
    }
    const known = imagesRef.current[index];
    if (known === 'loading') return false;
    if (known && known !== 'error') {
      recent.current = [...recent.current.filter((i) => i !== index), index];
      setSeen((all) => (all.has(index) ? all : new Set([...all, index])));
      return true;
    }
    const opening = generation.current;
    const stillWanted = () => mounted.current && opening === generation.current;
    setImages((all) => ({ ...all, [index]: 'loading' }));
    try {
      const response = await request('/api/documents/redaction-page', {
        versionId,
        page: index + 1,
      });
      if (!response.ok || response.headers.get('content-type') !== 'image/jpeg') {
        await fail(response);
        if (stillWanted()) {
          setImages((all) => ({ ...all, [index]: 'error' }));
          pageFailed(index);
        }
        return false;
      }
      if (typeof createImageBitmap !== 'function') throw new Error('no image decoding');
      const bitmap = await createImageBitmap(await response.blob());
      if (!stillWanted()) {
        bitmap.close();
        return false;
      }
      setImages((all) => ({ ...all, [index]: { bitmap } }));
      recent.current = [...recent.current.filter((i) => i !== index), index];
      setSeen((all) => (all.has(index) ? all : new Set([...all, index])));
      trimImages();
      return true;
    } catch {
      if (stillWanted()) {
        setImages((all) => ({ ...all, [index]: 'error' }));
        setProblem({ message: 'This page could not be shown. Try again.' });
        pageFailed(index);
      }
      return false;
    }
  };

  pageWork.current = { load: loadPage, trim: trimImages };

  const start = async (resume = false) => {
    if (step === 'loading' || step === 'preparing') return;
    setProblem(null);
    // Whatever was shown before (another version, or this one before a change) is let go.
    releaseImages();
    setSeen(new Set());
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
        maskRevision: string | null;
      };
      if (!mounted.current) return;
      const opened = {
        versionId: body.versionId,
        pageCount: body.pageCount,
        canSave: body.canSave,
      };
      setInfo(opened);
      // A saved copy still being prepared carries on preparing, without editing again.
      if (resume && body.state === 'PREPARING' && body.maskRevision) {
        await prepare(opened, body.maskRevision);
        return;
      }
      const saved = fromSaved(body.savedPages);
      const kept = readDraft(documentId, body.versionId, body.pageCount);
      setPages(
        kept ??
          (saved && saved.length === body.pageCount
            ? saved
            : Array.from({ length: body.pageCount }, () => [])),
      );
      setNothingToHide(!kept && body.state === 'NOTHING_TO_HIDE');
      setCurrent(0);
      currentRef.current = 0;
      setSelected(null);
      setStep('edit');
      setStatus(
        [
          `Showing page 1 of ${body.pageCount}.`,
          kept ? 'Your unsaved boxes were restored.' : '',
          body.canSave ? '' : 'Safe copies are not ready yet, so nothing can be saved.',
        ]
          .filter(Boolean)
          .join(' '),
      );
      void loadPage(0, body.versionId);
    } catch {
      if (mounted.current) {
        setProblem({ message: 'The editor could not be opened. Try again.' });
        setStep('closed');
      }
    }
  };

  /** Closes the editor without saving, letting go of every page shown. */
  const closeEditor = (message: string) => {
    if (info) removeDraft(documentId, info.versionId);
    drag.current = null;
    setDraft(null);
    setStep('closed');
    setSelected(null);
    releaseImages();
    setStatus(message);
  };

  const goTo = (index: number) => {
    if (!info || index < 0 || index >= info.pageCount) return;
    setCurrent(index);
    currentRef.current = index;
    setSelected(null);
    setStatus(`Showing page ${index + 1} of ${info.pageCount}.`);
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

  /**
   * Escape: stops a box being drawn (or puts back a box being dragged), and otherwise lets go of
   * the selected box. Listened for on the whole window while editing, since a pointer drag keeps
   * focus where it was.
   */
  const onEscape = () => {
    const active = drag.current;
    if (active) {
      drag.current = null;
      if (active.kind === 'draw') {
        setDraft(null);
        setStatus('Drawing that box was stopped. Nothing was added.');
      } else {
        updatePage(current, (boxes) =>
          boxes.map((b) => (b.id === active.boxId ? { ...b, box: active.origin } : b)),
        );
        setStatus('The box was put back where it was.');
      }
      return true;
    }
    if (selected !== null) {
      setSelected(null);
      setStatus('No box selected.');
      return true;
    }
    return false;
  };
  const escapeWork = useRef(onEscape);
  escapeWork.current = onEscape;
  const editing = step === 'edit';
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const inside = detailsRef.current?.contains(document.activeElement) ?? false;
      if (!inside && !drag.current) return;
      if (escapeWork.current()) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  /** Selects a box from the list and moves focus to its controls, for touch and switch users. */
  const selectBox = (boxIdValue: string, index: number) => {
    const item = pageBoxes[index];
    if (!item) return;
    setSelected(boxIdValue);
    focusAfter.current = 'adjust';
    setStatus(`Box ${index + 1} selected: ${describeRedactionBox(item.box)}.`);
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
    drag.current = null;
    setDraft(null);
    setNothingToHide(choseNothing);
    setSeen(new Set());
    setStep('review');
    setStatus(`Review: ${info.pageCount} ${info.pageCount === 1 ? 'page' : 'pages'} to check.`);
    if (typeof IntersectionObserver !== 'function') void loadReviewPages(info);
  };

  /**
   * Without a way to know which pages are on screen, review pages load one at a time, in order,
   * never all at once, and only the last few stay decoded.
   */
  const loadReviewPages = async (opened: EditorInfo) => {
    for (let index = 0; index < opened.pageCount; index++) {
      if (!mounted.current || stepRef.current !== 'review') return;
      await loadPage(index, opened.versionId);
    }
  };

  /**
   * Prepares every page, one after another, for the saved revision. Pages already prepared are
   * skipped by the server, so this resumes after an interruption. Never throws: however it stops,
   * the boxes stay saved and Continue Preparing carries on.
   */
  const prepare = async (opened: EditorInfo, revision: string) => {
    setStep('preparing');
    setProblem(null);
    setProgress({ done: 0, total: opened.pageCount });
    // The editor's own pages are not needed while preparing.
    releaseImages();
    const stopped = (page: number, why?: { message: string; reauthUrl?: string }) => {
      if (!mounted.current) return;
      setState('PREPARING');
      setProgress(null);
      setStep('closed');
      setProblem({
        message: [
          `Your boxes are saved. Preparing stopped at page ${page} of ${opened.pageCount}.`,
          why?.message ?? '',
          'Choose Continue Preparing to carry on.',
        ]
          .filter(Boolean)
          .join(' '),
        ...(why?.reauthUrl ? { reauthUrl: why.reauthUrl } : {}),
      });
      setStatus(`Preparing stopped at page ${page} of ${opened.pageCount}.`);
    };
    for (let page = 1; page <= opened.pageCount; page++) {
      if (!mounted.current) return;
      setStatus(`Preparing page ${page} of ${opened.pageCount}.`);
      let body: { preparedPages: number; pageCount: number; state: SafeCopyStateName };
      try {
        const response = await request('/api/documents/safe-copy-prepare', {
          versionId: opened.versionId,
          page,
          maskRevision: revision,
        });
        if (!response.ok) {
          stopped(page, await readMessage(response));
          return;
        }
        body = (await response.json()) as typeof body;
        if (
          typeof body?.preparedPages !== 'number' ||
          typeof body.pageCount !== 'number' ||
          typeof body.state !== 'string'
        ) {
          throw new Error('unexpected answer');
        }
      } catch {
        stopped(page);
        return;
      }
      if (!mounted.current) return;
      setProgress({ done: body.preparedPages, total: body.pageCount });
      if (body.state === 'MASKED' || body.state === 'NOTHING_TO_HIDE') {
        setState(body.state);
        setStep('saved');
        setProgress(null);
        setStatus('Safe copy ready. People you share safe copies with can now download it.');
        return;
      }
    }
    if (mounted.current) {
      setState('PREPARING');
      setProgress(null);
      setStep('closed');
      setProblem({
        message:
          'Your boxes are saved. Some pages are not prepared yet. Choose Continue Preparing.',
      });
    }
  };

  const allReviewPagesShown =
    info !== null &&
    Array.from({ length: info.pageCount }, (_, index) => index).every((index) => seen.has(index));

  const save = async () => {
    if (!info || busy) return;
    if (!info.canSave) {
      setStatus('Safe copies are not ready yet, so nothing can be saved.');
      return;
    }
    if (!allReviewPagesShown) {
      setStatus('Every page must show before the safe copy can be saved.');
      return;
    }
    setBusy('save');
    setProblem(null);
    let revision: string;
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
        if (mounted.current) setBusy(null);
        return;
      }
      const body = (await response.json()) as { maskRevision?: unknown };
      if (typeof body?.maskRevision !== 'string') throw new Error('unexpected answer');
      revision = body.maskRevision;
    } catch {
      // Nothing is known to be saved: the boxes stay on screen to try again.
      if (mounted.current) {
        setProblem({ message: 'The safe copy was not saved. Try again.' });
        setBusy(null);
      }
      return;
    }
    if (!mounted.current) return;
    // Saved: from here on the boxes are kept, and preparing reports for itself.
    removeDraft(documentId, info.versionId);
    setState('PREPARING');
    setBusy(null);
    await prepare(info, revision);
  };

  const clear = async () => {
    if (busy) return;
    setBusy('clear');
    setProblem(null);
    try {
      // The latest version as the page knows it: removing needs no drawing of the file at all.
      const versionId = info?.versionId ?? latestVersionId;
      if (!versionId) return;
      const response = await request('/api/documents/redaction-masks', { versionId, clear: true });
      if (!response.ok) {
        await fail(response);
        return;
      }
      if (!mounted.current) return;
      removeDraft(documentId, versionId);
      setState('NOT_PREPARED');
      setStep('closed');
      setInfo(null);
      releaseImages();
      setStatus('Safe copy removed. Nothing is shared as a safe copy until you prepare it again.');
      // The button pressed has gone; the main action takes focus.
      focusAfter.current = 'start';
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
          <PageCanvas bitmap={shown.bitmap} label={`Page ${index + 1} of ${pageCount}`} />
        ) : (
          <div className="safe-copy-page-placeholder">
            {shown === 'error'
              ? 'This page could not be shown.'
              : shown === 'loading' || interactive
                ? 'Loading the page...'
                : 'This page shows when you scroll to it.'}
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
            const ringed = isSelected || (interactive && item.id === focusedBox);
            const pending = item.suggestion && !item.suggestion.accepted;
            const x = item.box.x * UNITS;
            const y = item.box.y * UNITS;
            const width = item.box.w * UNITS;
            const height = item.box.h * UNITS;
            return (
              <g key={item.id}>
                {ringed ? (
                  <>
                    <rect
                      className="safe-copy-ring-halo"
                      x={x - 6}
                      y={y - 6}
                      width={width + 12}
                      height={height + 12}
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      className="safe-copy-ring"
                      x={x - 6}
                      y={y - 6}
                      width={width + 12}
                      height={height + 12}
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : null}
                {pending ? (
                  <rect
                    className="safe-copy-box-halo"
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                <rect
                  data-box={item.id}
                  className={`safe-copy-box${pending ? ' safe-copy-box-suggested' : ''}`}
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  vectorEffect="non-scaling-stroke"
                  {...(interactive
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': boxLabel(item, boxIndex, index + 1),
                        'aria-describedby': hintId,
                        'aria-pressed': isSelected,
                        onKeyDown: (event: KeyboardEvent<SVGRectElement>) => onBoxKey(event, item),
                        onPointerDown: (event: PointerEvent<SVGRectElement>) =>
                          onBoxPointerDown(event, item),
                        onFocus: () => {
                          setFocusedBox(item.id);
                          setSelected(item.id);
                        },
                        onBlur: () => setFocusedBox((was) => (was === item.id ? null : was)),
                      }
                    : {})}
                />
              </g>
            );
          })}
          {interactive && draft ? (
            <>
              <rect
                className="safe-copy-draft-halo"
                x={draft.x * UNITS}
                y={draft.y * UNITS}
                width={draft.w * UNITS}
                height={draft.h * UNITS}
                vectorEffect="non-scaling-stroke"
              />
              <rect
                className="safe-copy-draft"
                x={draft.x * UNITS}
                y={draft.y * UNITS}
                width={draft.w * UNITS}
                height={draft.h * UNITS}
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </svg>
      </div>
    );
  };

  return (
    <details className="safe-copy" id={sectionId} ref={detailsRef}>
      <summary className="safe-copy-title">Safe Copy</summary>
      <p className="safe-copy-state" ref={stateRef} tabIndex={-1}>
        {SAFE_COPY_STATE_LABELS[state]}
      </p>
      <p className="safe-copy-note">
        A safe copy is a new picture of each page with the parts you choose covered in black. It is
        what people you share safe copies with can download, never the original.
      </p>
      {!available ? (
        <p className="safe-copy-note">Safe copies are not available here yet.</p>
      ) : null}
      {available && unavailable ? (
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

      {available &&
      !unavailable &&
      (step === 'closed' || step === 'loading' || step === 'saved') ? (
        <div className="safe-copy-actions">
          {state === 'PREPARING' ? (
            <button
              type="button"
              className="btn btn-primary"
              ref={continueRef}
              onClick={() => void start(true)}
              aria-disabled={step === 'loading' ? true : undefined}
            >
              Continue Preparing
            </button>
          ) : null}
          <button
            type="button"
            className={ready || state === 'PREPARING' ? 'btn btn-secondary' : 'btn btn-primary'}
            ref={startRef}
            onClick={() => void start()}
            aria-disabled={step === 'loading' ? true : undefined}
          >
            {ready || state === 'PREPARING' ? 'Change Safe Copy' : 'Prepare Safe Copy'}
          </button>
          {(ready || state === 'PREPARING') && latestVersionId ? (
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
      {step === 'preparing' && progress ? (
        <div className="safe-copy-editor">
          <h3 className="safe-copy-subtitle" ref={preparingHeadingRef} tabIndex={-1}>
            Preparing the Safe Copy
          </h3>
          <p className="safe-copy-note">
            Each page is drawn once with its black boxes. Keep this page open; if it closes, choose
            Continue Preparing to carry on where it stopped.
          </p>
          <progress className="safe-copy-progress" max={progress.total} value={progress.done}>
            {progress.done} of {progress.total}
          </progress>
        </div>
      ) : null}
      {available && ready && step !== 'edit' && step !== 'review' && step !== 'preparing' ? (
        <SafeCopyDownload documentId={documentId} returnTo={returnTo} />
      ) : null}

      {step === 'edit' && info ? (
        <div className="safe-copy-editor">
          <h3 className="safe-copy-subtitle" ref={editHeadingRef} tabIndex={-1}>
            Mark What to Hide
          </h3>
          <p className="safe-copy-note">
            Check every page. Only the black boxes are hidden. Suggestions can miss things.
          </p>
          <p className="safe-copy-note" id={hintId}>
            On a selected box, arrow keys move it, Shift with an arrow key changes its size, and
            Delete removes it. Escape stops a box being drawn and lets go of the selected box.
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
              onClick={() => void loadPage(current, info.versionId)}
            >
              Show the Page Again
            </button>
          ) : null}

          {selectedBox ? (
            <fieldset className="safe-copy-adjust" ref={adjustRef} tabIndex={-1}>
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
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => selectBox(item.id, index)}
                      aria-label={`Select box ${index + 1}`}
                      aria-pressed={item.id === selected}
                    >
                      Select
                    </button>
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
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => closeEditor('Editing cancelled. Nothing was saved.')}
            >
              Cancel Editing
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' && info ? (
        <div className="safe-copy-editor">
          <h3 className="safe-copy-subtitle" ref={reviewHeadingRef} tabIndex={-1}>
            Check Every Page
          </h3>
          <p className="safe-copy-note">Check every page. Only the black boxes are hidden.</p>
          {nothingToHide ? (
            <p className="safe-copy-note">
              You chose Nothing to Hide on This Document. Each page is shared as a picture, with no
              hidden text or file details.
            </p>
          ) : null}
          <ol className="safe-copy-review" ref={reviewListRef}>
            {pages.map((boxes, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: pages are fixed for this version
              <li key={index} data-review-page={index}>
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
                {images[index] === 'error' ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void loadPage(index, info.versionId)}
                    aria-label={`Try again to show page ${index + 1}`}
                  >
                    Try Again
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="safe-copy-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              aria-disabled={
                busy === 'save' || !info.canSave || !allReviewPagesShown ? true : undefined
              }
              aria-describedby={allReviewPagesShown ? undefined : `${id}-review-wait`}
            >
              Save Safe Copy
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setStep('edit');
                setStatus(`Back to editing. Showing page ${current + 1} of ${pageCount}.`);
                void loadPage(current, info.versionId);
              }}
            >
              Back to Editing
            </button>
          </div>
          {!allReviewPagesShown ? (
            <p className="safe-copy-note" id={`${id}-review-wait`}>
              Every page must show before the safe copy can be saved: {seen.size} of {pageCount}{' '}
              shown so far. Scroll through every page.
            </p>
          ) : null}
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
