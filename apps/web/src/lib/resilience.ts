/**
 * Helpers that keep a screen honest when the network is not (directive Part 9
 * section 3: interrupted upload, slow request, a job still processing, reload).
 * Pure, so the rules are tested without a browser.
 */

/**
 * How long to wait before asking the server again whether a document has finished,
 * given how many times it has been asked. Starts quick (most checks finish in
 * seconds), backs off so a slow job is not hammered, and gives up after about ten
 * minutes, when the page says to check back later instead of polling for ever.
 * `null` means stop.
 */
export const REFRESH_DELAYS_MS: readonly number[] = [
  3000, 5000, 8000, 13000, 20000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000,
  30000, 30000, 30000, 30000, 30000, 30000,
];

export function refreshDelayMs(attempt: number): number | null {
  return REFRESH_DELAYS_MS[attempt] ?? null;
}

export interface RefreshLoopDeps {
  /** Ask the server for fresh data (`router.refresh()`). */
  readonly refresh: () => void;
  /** Whether nobody is looking at the page (a background tab). */
  readonly isHidden: () => boolean;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

/**
 * The rule behind `AutoRefresh`: ask again after each delay in `REFRESH_DELAYS_MS`,
 * spend nothing while the tab is hidden, catch up the moment it is shown, and stop for
 * good when the schedule runs out. Returns what the component needs to wire up: call
 * `onVisible` when the tab is shown again, `stop` when the page no longer needs
 * watching.
 */
export function startRefreshLoop(deps: RefreshLoopDeps): {
  readonly onVisible: () => void;
  readonly stop: () => void;
} {
  let attempt = 0;
  let timer: unknown;
  let stopped = false;
  let exhausted = false;

  const schedule = () => {
    const delay = refreshDelayMs(attempt);
    if (delay === null) {
      exhausted = true;
      return;
    }
    timer = deps.setTimer(tick, delay);
  };
  function tick() {
    timer = undefined;
    if (stopped) return;
    // A tab nobody is looking at is not asked again; `onVisible` picks it up.
    if (deps.isHidden()) return;
    attempt += 1;
    deps.refresh();
    schedule();
  }

  schedule();
  return {
    onVisible: () => {
      if (stopped || exhausted || deps.isHidden() || timer !== undefined) return;
      tick();
    },
    stop: () => {
      stopped = true;
      if (timer !== undefined) deps.clearTimer(timer);
      timer = undefined;
    },
  };
}

/** The document states in which the server is still working on the file, so the page should keep itself up to date. */
export const IN_FLIGHT_DOCUMENT_STATES: ReadonlySet<string> = new Set([
  'UPLOADING',
  'QUARANTINED',
  'SCANNING',
  'NORMALIZING',
  'EXTRACTING',
]);

export function isStillProcessing(state: string | null): boolean {
  return state !== null && IN_FLIGHT_DOCUMENT_STATES.has(state);
}

/** What a form shows when its request never got an answer, so the person does not guess whether it worked. */
export interface Outcome {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
}

/**
 * Wraps a server action so that a request that fails on the way (a dropped
 * connection, a timeout, the phone going into a tunnel) becomes a message on the
 * form instead of an error screen that throws the page away. The request may well
 * have reached the server, so the message must not say "it failed"; it says it is
 * not known and where to look.
 */
export function guardNetwork<State, Result extends Outcome>(
  action: (previous: State, formData: FormData) => Promise<Result>,
  unknownOutcome: string,
): (previous: State, formData: FormData) => Promise<Result | Outcome> {
  return async (previous, formData) => {
    try {
      return await action(previous, formData);
    } catch {
      return { ok: false, message: unknownOutcome };
    }
  };
}

/** How long a request may run before the form says it is taking longer than usual. */
export const SLOW_AFTER_MS = 15000;
