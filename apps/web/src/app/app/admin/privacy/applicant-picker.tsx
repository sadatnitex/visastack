'use client';

import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { ApplicantMatch, ApplicantSearchResult } from './actions';

/** Fewer characters than this are not sent: the server would match nothing anyway. */
export const PICKER_MIN_CHARS = 2;
/** How long typing must pause before a search is sent, in milliseconds. */
export const PICKER_DELAY_MS = 250;

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'done'; readonly count: number }
  | { readonly kind: 'failed'; readonly message: string };

function statusText(status: Status, typed: string, chosen: ApplicantMatch | null): string {
  if (chosen) return `Chosen: ${chosen.displayName}.`;
  if (status.kind === 'searching') return 'Searching…';
  if (status.kind === 'failed') return status.message;
  if (status.kind === 'done') {
    if (status.count === 0) return 'No applicants match. Try another part of the name.';
    const shown = status.count === 1 ? '1 applicant matches.' : `${status.count} applicants match.`;
    return status.count >= 20
      ? `${shown} Showing the first 20: type more of the name to narrow it.`
      : `${shown} Use the arrow keys to choose.`;
  }
  return typed.trim().length > 0 && typed.trim().length < PICKER_MIN_CHARS
    ? `Type at least ${PICKER_MIN_CHARS} letters.`
    : 'Type part of a name, or paste an applicant ID.';
}

/**
 * Chooses the applicant for a legal hold by searching as you type (WP-SB7), instead of a list of
 * every applicant on the platform. A combobox (WAI-ARIA 1.2 list autocomplete): the text box keeps
 * focus, the arrow keys move through at most 20 matches, Enter chooses, Escape closes. The choice
 * travels in a hidden `applicantId` field; typing again clears it, and so does the form's reset
 * after a save. The search itself runs on the server with the page's own role check.
 */
export function ApplicantPicker({
  search,
  name = 'applicantId',
  label = 'Applicant',
}: {
  /** The server search; resolves to at most 20 matches. */
  readonly search: (text: string) => Promise<ApplicantSearchResult>;
  readonly name?: string;
  readonly label?: string;
}) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-status`;
  const [typed, setTyped] = useState('');
  const [matches, setMatches] = useState<readonly ApplicantMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [chosen, setChosen] = useState<ApplicantMatch | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const input = useRef<HTMLInputElement>(null);
  // Only the newest search may update the list: an older reply arriving late is dropped.
  const latest = useRef(0);

  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const clear = () => {
      latest.current += 1;
      setTyped('');
      setMatches([]);
      setOpen(false);
      setActive(-1);
      setChosen(null);
      setStatus({ kind: 'idle' });
    };
    form.addEventListener('reset', clear);
    return () => form.removeEventListener('reset', clear);
  }, []);

  useEffect(() => {
    const text = typed.trim();
    if (chosen || text.length < PICKER_MIN_CHARS) return;
    const ticket = latest.current + 1;
    latest.current = ticket;
    setStatus({ kind: 'searching' });
    const timer = window.setTimeout(() => {
      search(text)
        .then((result) => {
          if (latest.current !== ticket) return;
          if (!result.ok) {
            setMatches([]);
            setOpen(false);
            setStatus({ kind: 'failed', message: result.message });
            return;
          }
          setMatches(result.matches);
          setActive(-1);
          setOpen(result.matches.length > 0);
          setStatus({ kind: 'done', count: result.matches.length });
        })
        .catch(() => {
          if (latest.current !== ticket) return;
          setMatches([]);
          setOpen(false);
          setStatus({ kind: 'failed', message: 'The search did not work. Try again.' });
        });
    }, PICKER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [typed, chosen, search]);

  const choose = (match: ApplicantMatch) => {
    latest.current += 1;
    setChosen(match);
    setTyped(match.displayName);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (matches.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) =>
        current < 0 && step < 0
          ? matches.length - 1
          : (current + step + matches.length) % matches.length,
      );
    } else if (event.key === 'Enter') {
      const match = open ? matches[active] : undefined;
      if (match) {
        // Enter chooses the highlighted applicant instead of sending the form.
        event.preventDefault();
        choose(match);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  };

  const activeId = open && active >= 0 ? `${baseId}-option-${active}` : undefined;
  return (
    <div className="sb7-picker">
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        ref={input}
        id={inputId}
        type="text"
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-describedby={statusId}
        {...(activeId ? { 'aria-activedescendant': activeId } : {})}
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          setChosen(null);
          if (event.target.value.trim().length < PICKER_MIN_CHARS) {
            latest.current += 1;
            setMatches([]);
            setOpen(false);
            setStatus({ kind: 'idle' });
          }
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      <input type="hidden" name={name} value={chosen?.id ?? ''} />
      <div
        className="sb7-picker-list"
        id={listId}
        // biome-ignore lint/a11y/useSemanticElements: a native select cannot filter as you type; this is the WAI-ARIA combobox list.
        role="listbox"
        tabIndex={-1}
        aria-label={`${label} matches`}
        hidden={!open}
      >
        {matches.map((match, index) => (
          <div
            key={match.id}
            id={`${baseId}-option-${index}`}
            // biome-ignore lint/a11y/useSemanticElements: an option of the combobox list above; focus stays in the text box (aria-activedescendant).
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            className="sb7-picker-option"
            // Mouse down, not click: the text box would lose focus (and close the list) first.
            onMouseDown={(event) => {
              event.preventDefault();
              choose(match);
            }}
          >
            {match.displayName}
            <span className="muted u-fs-085"> · ID {match.id.slice(0, 8)}</span>
          </div>
        ))}
      </div>
      <output id={statusId} className="muted u-fs-085 sb7-picker-status">
        {statusText(status, typed, chosen)}
      </output>
    </div>
  );
}
