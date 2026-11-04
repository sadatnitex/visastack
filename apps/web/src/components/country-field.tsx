'use client';

import { useId, useState } from 'react';
import type { CaseCountryOption } from '../lib/case-choices';

/**
 * Where are you going? A plain text box with the browser's own list of country names, in place of
 * a 150-line pick list. It works with a keyboard, a screen reader and a phone's picker without any
 * custom widget: type a few letters and choose a name, or open the list.
 *
 * The box sends the text itself under `name`; the server turns it into one country or refuses it
 * (`resolveCaseCountry`), so the words typed here are never saved on their own. The line under the
 * box only says what the server will understand (a whole name, a code or another common name) and
 * speaks politely when that changes. "No country matches" waits until someone leaves the box, so it
 * never interrupts typing.
 */

/** Same folding as the server (`packMatchKey`): accents, case, hyphens and spacing do not matter. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The country a whole typed name, other common name or capital-letter code stands for. */
export function matchCountry(
  text: string,
  countries: readonly CaseCountryOption[],
): CaseCountryOption | null {
  const typed = text.trim();
  if (typed === '') return null;
  const byCode = /^[A-Z]{2}$/.test(typed) ? countries.find((c) => c.iso2 === typed) : undefined;
  if (byCode) return byCode;
  const wanted = plain(typed);
  const found = countries.filter(
    (c) => plain(c.name) === wanted || (c.aka ?? []).some((other) => plain(other) === wanted),
  );
  return found.length === 1 ? (found[0] ?? null) : null;
}

export function CountryField({
  id,
  name = 'destination',
  countries,
  defaultValue = '',
  placeholder,
  hint,
  problem,
}: {
  readonly id: string;
  readonly name?: string;
  readonly countries: readonly CaseCountryOption[];
  /** What the box starts with: what was typed before (kept as typed), a country code (shown as its name), or empty. */
  readonly defaultValue?: string;
  readonly placeholder?: string;
  /** A short line under the box, read with it. */
  readonly hint?: string;
  /** The form's own problem attributes for this box (`fieldProblem`), kept and added to. */
  readonly problem?: { readonly 'aria-invalid'?: true; readonly 'aria-describedby'?: string };
}) {
  const ids = useId();
  const listId = `${ids}-names`;
  const hintId = `${ids}-hint`;
  const statusId = `${ids}-status`;
  const [text, setText] = useState(() =>
    /^[A-Z]{2}$/.test(defaultValue)
      ? (matchCountry(defaultValue, countries)?.name ?? defaultValue)
      : defaultValue,
  );
  // The line under the box speaks only once the answer is settled: the person left the box, or
  // picked a name from the browser's list. Never while typing, where "Dominica" is only on the way
  // to "Dominican Republic".
  const [settled, setSettled] = useState(false);

  const country = matchCountry(text, countries);
  const noMatch = settled && text.trim() !== '' && !country;
  const status =
    settled && country
      ? `${country.name} chosen.`
      : noMatch
        ? 'No country matches. Pick one from the list.'
        : '';
  const describedBy = [problem?.['aria-describedby'], hint ? hintId : null, statusId]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="country-field">
      <input
        id={id}
        name={name}
        type="text"
        className="input"
        list={listId}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          // Choosing a name from the browser's list arrives as a replacement, not as typing.
          setSettled((event.nativeEvent as InputEvent).inputType === 'insertReplacementText');
        }}
        onBlur={() => setSettled(true)}
        // Not the browser's "country-name" fill: that would put the person's own country here.
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint="next"
        {...(placeholder ? { placeholder } : {})}
        {...(problem?.['aria-invalid'] || noMatch ? { 'aria-invalid': true as const } : {})}
        aria-describedby={describedBy}
      />
      <datalist id={listId}>
        {countries.map((entry) => (
          <option key={entry.iso2} value={entry.name} />
        ))}
      </datalist>
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      <output
        id={statusId}
        className={noMatch ? 'field-msg field-msg-err' : 'field-msg field-msg-ok'}
      >
        {status}
      </output>
    </div>
  );
}
