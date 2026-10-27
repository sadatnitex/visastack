'use client';

import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react';
import type { FormResult } from './form-feedback';

/**
 * One status line for an area of a screen where several forms act on the same things: a list
 * of invitations and the form that sends one, or a task list and the form that adds a task.
 *
 * React keeps each form's last result separately, so without this an area shows every form's
 * last line at once ("Task added." beside "Task started."), and a private link from an earlier
 * invitation stays on screen after that invitation has been revoked. Here the area keeps one
 * result, the latest, and each new one replaces it.
 *
 * Two ways in, for two shapes of screen:
 * - `useLatestOf` when one component holds every form of the area: it shows whichever of the
 *   forms' results changed last.
 * - `useLatestResult` with `LatestResultArea` when the forms are separate components, some of
 *   which leave the page with their own success (the row of a revoked invitation disappears as
 *   the page refreshes, taking its own message with it). The result then lives in the area,
 *   not in the form that acted, and the area shows the action that was started last, whatever
 *   order the answers come back in.
 *
 * Nothing here reads the wording of a message.
 */

/**
 * Of several forms' results, the one that changed most recently. Each argument is one form's
 * `useActionState` state; a new answer is always a new object, even when its words are the same.
 */
export function useLatestOf<R>(...results: readonly R[]): R {
  const [record, setRecord] = useState(() => ({ seen: results, latest: results[0] as R }));
  const changed = results.findIndex((result, index) => result !== record.seen[index]);
  if (changed === -1) return record.latest;
  // Adjusting state while rendering (React's pattern for "changed since the last render"):
  // React renders again straight away with the new record, before anything reaches the screen.
  const latest = results[changed] as R;
  setRecord({ seen: results, latest });
  return latest;
}

/** A form action as `useActionState` takes it. */
export type FormAction<R extends FormResult> = (previous: R, formData: FormData) => Promise<R>;

export interface LatestResult<R extends FormResult> {
  /** What the most recently started action in the area answered, or `initial` before any. */
  readonly result: R;
  /**
   * Wraps an action so its answer becomes the area's result. Pass the wrapped action to
   * `useActionState`; the form's own state still receives the answer as before.
   */
  readonly track: (action: FormAction<R>) => FormAction<R>;
}

export function useLatestResult<R extends FormResult>(initial: R): LatestResult<R> {
  const [result, setResult] = useState<R>(initial);
  // Numbers each action as it starts; an answer older than the one on screen is not shown.
  const started = useRef(0);
  const shown = useRef(0);
  const track = useCallback(
    (action: FormAction<R>): FormAction<R> =>
      async (previous, formData) => {
        started.current += 1;
        const order = started.current;
        const answer = await action(previous, formData);
        if (order > shown.current) {
          shown.current = order;
          setResult(answer);
        }
        return answer;
      },
    [],
  );
  return { result, track };
}

const AreaContext = createContext<LatestResult<FormResult> | null>(null);

/**
 * Makes `area` the status line for every form rendered inside it, including forms a server
 * page places there, which reach it through `useLatestResultArea`.
 */
export function LatestResultArea<R extends FormResult>({
  area,
  children,
}: {
  readonly area: LatestResult<R>;
  readonly children: ReactNode;
}) {
  return (
    <AreaContext.Provider value={area as unknown as LatestResult<FormResult>}>
      {children}
    </AreaContext.Provider>
  );
}

/**
 * The area this form reports to, or null when it stands alone (then the form shows its own
 * result, as it always did).
 */
export function useLatestResultArea<R extends FormResult>(): LatestResult<R> | null {
  return useContext(AreaContext) as LatestResult<R> | null;
}
