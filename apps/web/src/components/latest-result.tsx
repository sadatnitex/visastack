'use client';

import { useState } from 'react';
import type { FormResult } from './form-feedback';

/**
 * One status line for an area of a screen where several forms act on the same things, such as
 * a task list and the form that adds a task. React keeps each form's last result separately, so
 * without this an area shows every form's last line at once ("Task added." beside "Task
 * started."). Here the area keeps one result, the latest, and each new one replaces it.
 *
 * Each argument is one form's `useActionState` state; a new answer is always a new object, even
 * when its words are the same. The hook returns the latest result and which form gave it, so a
 * screen can show the line beside the button that was pressed. When several answers arrive in
 * the same render, a failure wins over a success, so a problem is never hidden behind a "done".
 *
 * Nothing here reads the wording of a message.
 */
export function useLatestOf<R extends FormResult>(
  ...results: readonly R[]
): readonly [result: R, source: number] {
  const [record, setRecord] = useState(() => ({
    seen: results,
    latest: results[0] as R,
    source: 0,
  }));
  const changed = results.flatMap((result, index) =>
    result !== record.seen[index] ? [index] : [],
  );
  if (changed.length === 0) return [record.latest, record.source];
  const source = changed.find((index) => results[index]?.ok === false) ?? changed.at(-1) ?? 0;
  const latest = results[source] as R;
  // Adjusting state while rendering (React's pattern for "changed since the last render"):
  // React renders again straight away with the new record, before anything reaches the screen.
  setRecord({ seen: results, latest, source });
  return [latest, source];
}
