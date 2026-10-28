'use client';

import { useState } from 'react';
import type { FormResult } from './form-feedback';

/**
 * One status line for an area of a screen where several forms act on the same things, such as
 * a task list and the form that adds a task. React keeps each form's last result separately, so
 * without this an area shows every form's last line at once ("Task added." beside "Task
 * started."). Here the area keeps one result, the latest, and each new one replaces it.
 *
 * `sources` names each form's `useActionState` state; a new answer is always a new object, even
 * when its words are the same. The hook returns the latest result and the name of the form that
 * gave it, so a screen can show the line beside the button that was pressed. When several
 * answers arrive in the same render, a failure wins over a success, so a problem is never hidden
 * behind a "done". Before any answer the source is the first name given.
 *
 * Nothing here reads the wording of a message.
 */
export function useLatestOf<K extends string, R extends FormResult>(
  sources: Readonly<Record<K, R>>,
): readonly [result: R, source: K] {
  const names = Object.keys(sources) as K[];
  const [record, setRecord] = useState(() => ({
    seen: sources,
    latest: sources[names[0] as K],
    source: names[0] as K,
  }));
  const changed = names.filter((name) => sources[name] !== record.seen[name]);
  if (changed.length === 0) return [record.latest, record.source];
  const source = changed.find((name) => sources[name].ok === false) ?? (changed.at(-1) as K);
  const latest = sources[source];
  // Adjusting state while rendering (React's pattern for "changed since the last render"):
  // React renders again straight away with the new record, before anything reaches the screen.
  setRecord({ seen: sources, latest, source });
  return [latest, source];
}
