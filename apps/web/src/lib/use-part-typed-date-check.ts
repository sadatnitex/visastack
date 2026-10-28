import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { DATE_NOT_REAL } from './form-dates';

/**
 * The browser half of the case forms' date check (see form-dates.ts): a date box holding a
 * part-typed date sends nothing, so at submit the form looks for one, stops, says beside it
 * "Enter a full date: day, month and year." and moves focus to the first. The returned errors
 * go through the form's own field error path; they clear on the next submit that has none.
 */
export function usePartTypedDateCheck<F extends string>(
  dateFields: readonly F[],
): {
  readonly errors: Readonly<Partial<Record<F, string>>>;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
} {
  const [errors, setErrors] = useState<Readonly<Partial<Record<F, string>>>>(
    () => ({}) as Partial<Record<F, string>>,
  );
  // A fresh object each time, so the same box is focused again on a second try.
  const [focusTarget, setFocusTarget] = useState<{ readonly box: HTMLElement } | null>(null);

  // After the messages are drawn, so the box is announced with its problem.
  useEffect(() => {
    focusTarget?.box.focus();
  }, [focusTarget]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      const next: Partial<Record<F, string>> = {};
      let first: HTMLInputElement | null = null;
      for (const name of dateFields) {
        const box = event.currentTarget.elements.namedItem(name);
        if (box instanceof HTMLInputElement && box.validity.badInput) {
          next[name] = DATE_NOT_REAL;
          first ??= box;
        }
      }
      setErrors(next);
      if (first) {
        event.preventDefault();
        setFocusTarget({ box: first });
      }
    },
    [dateFields],
  );

  return { errors, onSubmit };
}
