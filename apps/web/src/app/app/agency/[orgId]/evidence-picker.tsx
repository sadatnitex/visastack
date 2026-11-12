'use client';

import { type RefObject, useId, useMemo, useState } from 'react';
import { useT } from '../../../../components/i18n-provider';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
import type {
  MissingForCase,
  MissingRow,
  RequestPicker,
  RequestPickerGroup,
} from '../../../../lib/request-picker-types';
import { MAX_ASK_ITEMS, pickerItemId } from '../../../../lib/request-picker-types';

/** Rows drawn per group before "Show More": 962 rows are never in the page at once. */
const PAGE = 60;

/** What a checklist item's state says in words, shown beside its name. */
const STATE_WORDS: Readonly<Record<MissingRow['state'], string>> = {
  ask: '',
  alternative: '',
  optional: 'Optional',
  conflict: 'Two Answers on File',
  stale: 'Needs a Newer Copy',
  asked: 'Already Asked',
  unlisted: 'Not in the List',
};

interface Entry {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /** Lower case: the name, its context line, the plain names people use, and its group. */
  readonly hay: string;
}

interface PickerGroupView {
  readonly group: RequestPickerGroup;
  readonly entries: readonly Entry[];
}

/** The words typed, split on spaces. An item matches when every word is somewhere in it. */
function wordsOf(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
}

export function EvidencePicker({
  picker,
  selected,
  onToggle,
  query,
  onQuery,
  searchRef,
  missing,
  onAskAllMissing,
  missingIds,
}: {
  readonly picker: RequestPicker;
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (id: string, label: string, hint: string) => void;
  readonly query: string;
  readonly onQuery: (text: string) => void;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  /** Only on a case: the checklist items the traveller has not provided yet. */
  readonly missing: MissingForCase | null;
  readonly onAskAllMissing: () => void;
  /** The ids "Ask for All Missing" ticks (required items, never provided, not already asked). */
  readonly missingIds: readonly string[];
}) {
  const t = useT(appAgencyCatalog);
  const uid = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<ReadonlyMap<string, number>>(new Map());
  const [missingOpen, setMissingOpen] = useState(true);

  const views = useMemo<readonly PickerGroupView[]>(
    () =>
      picker.groups.map((group) => ({
        group,
        entries: group.items.map((item) => {
          const label = item[1];
          const hint = item[2] ?? '';
          const words = (item[3] ?? '').replace(/\|/g, ' ');
          return {
            id: pickerItemId(group.kind, item),
            label,
            hint,
            hay: `${label} ${hint} ${words} ${group.label}`.toLowerCase(),
          };
        }),
      })),
    [picker],
  );

  const words = useMemo(() => wordsOf(query), [query]);
  const searching = words.length > 0;
  const results = useMemo(
    () =>
      views.map((view) => ({
        view,
        matches:
          words.length > 0
            ? view.entries.filter((entry) => words.every((word) => entry.hay.includes(word)))
            : view.entries,
      })),
    [views, words],
  );
  const total = results.reduce((count, r) => count + (searching ? r.matches.length : 0), 0);

  const toggleGroup = (id: string) =>
    setOpen((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const showMore = (id: string) =>
    setShown((before) => new Map(before).set(id, (before.get(id) ?? PAGE) + PAGE));

  const searchId = `${uid}-search`;
  const hintId = `${uid}-search-hint`;
  const kinds: readonly { kind: 'DOCUMENT' | 'FIELD'; title: string }[] = [
    { kind: 'DOCUMENT', title: 'Documents' },
    { kind: 'FIELD', title: 'Details' },
  ];

  const row = (id: string, label: string, hint: string, note?: string) => (
    <label className="ask-row" key={id}>
      <input
        type="checkbox"
        checked={selected.has(id)}
        onChange={() => onToggle(id, label, hint)}
      />
      <span className="ask-row-text">
        <span>{label}</span>
        {hint ? <span className="ask-hint"> ({hint})</span> : null}
        {note ? <span className="ask-note">{note}</span> : null}
      </span>
    </label>
  );

  const missingRow = (entry: MissingRow) =>
    entry.id === '' ? (
      <li className="ask-row ask-row-static" key={`unlisted-${entry.label}`}>
        <span className="ask-row-text">
          <span>{entry.label}</span>
          <span className="ask-note">{STATE_WORDS.unlisted}</span>
        </span>
      </li>
    ) : (
      <li key={entry.id}>{row(entry.id, entry.label, entry.hint, STATE_WORDS[entry.state])}</li>
    );

  return (
    <div className="ask-picker">
      <div className="field-row">
        <label className="field-label" htmlFor={searchId}>
          {t.node('appAgency.appAgencyOrgidEvidencePicker.searchDocumentsAndDetails')}
        </label>
        <input
          id={searchId}
          ref={searchRef}
          type="search"
          className="input"
          autoComplete="off"
          placeholder={t(
            'appAgency.appAgencyOrgidEvidencePicker.forExampleNidTradeLicenceSolvency',
          )}
          aria-describedby={hintId}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter in the search box searches; it must never send the form.
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
        <small className="muted" id={hintId}>
          {t.node('appAgency.appAgencyOrgidEvidencePicker.chooseAsManyAsYouNeed')}
        </small>
        <output className="sr-only">
          {searching
            ? total === 0
              ? t.node('appAgency.appAgencyOrgidEvidencePicker.noMatches')
              : t.node('appAgency.appAgencyOrgidEvidencePicker.totalMatches', { total })
            : ''}
        </output>
      </div>

      {searching && total === 0 ? (
        <p className="ask-empty">
          {t.node('appAgency.appAgencyOrgidEvidencePicker.nothingMatchesTrimNotInThe', {
            trim: query.trim(),
          })}
        </p>
      ) : null}

      {missing && !searching ? (
        <section
          className="ask-group ask-missing"
          aria-label={t('appAgency.appAgencyOrgidEvidencePicker.missingForThisCase')}
        >
          <div className="ask-group-head">
            <button
              type="button"
              className="ask-group-toggle"
              aria-expanded={missingOpen}
              aria-controls={`${uid}-missing`}
              onClick={() => setMissingOpen((value) => !value)}
            >
              Missing for This Case
              <span className="ask-count"> ({missing.rows.length + missing.anyOf.length})</span>
            </button>
          </div>
          <div id={`${uid}-missing`} hidden={!missingOpen}>
            {missingOpen ? (
              <>
                {missingIds.length > 0 ? (
                  <button type="button" className="btn btn-secondary" onClick={onAskAllMissing}>
                    {t.node('appAgency.appAgencyOrgidEvidencePicker.askForAllMissingLength', {
                      length: missingIds.length,
                    })}
                  </button>
                ) : null}
                {missingIds.length > MAX_ASK_ITEMS ? (
                  <p className="muted u-fs-085">
                    {t.node('appAgency.appAgencyOrgidEvidencePicker.onlyTheFirstMaxAskItems', {
                      MAX_ASK_ITEMS,
                    })}
                  </p>
                ) : null}
                <ul className="ask-list">{missing.rows.map(missingRow)}</ul>
                {missing.anyOf.map((members, index) => (
                  <fieldset
                    className="ask-anyof"
                    key={members.map((m) => m.id || m.label).join('|')}
                  >
                    <legend>
                      {missing.anyOf.length > 1
                        ? `Any One of These (${index + 1})`
                        : t.node('appAgency.appAgencyOrgidEvidencePicker.anyOneOfThese')}
                    </legend>
                    <p className="muted u-fs-085">
                      {t.node('appAgency.appAgencyOrgidEvidencePicker.theTravellerNeedsOnlyOneOf')}
                    </p>
                    <ul className="ask-list">{members.map(missingRow)}</ul>
                  </fieldset>
                ))}
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {kinds.map(({ kind, title }) => {
        const list = results.filter(
          (r) => r.view.group.kind === kind && (!searching || r.matches.length > 0),
        );
        if (list.length === 0) return null;
        return (
          <section className="ask-kind" key={kind} aria-label={title}>
            <p className="ask-kind-title">{title}</p>
            {list.map(({ view, matches }) => {
              const { group } = view;
              const isOpen = searching || open.has(group.id);
              const limit = shown.get(group.id) ?? PAGE;
              const picked = view.entries.reduce((n, e) => n + (selected.has(e.id) ? 1 : 0), 0);
              const panel = `${uid}-${group.id}`;
              return (
                <div className="ask-group" key={group.id}>
                  <div className="ask-group-head">
                    <button
                      type="button"
                      className="ask-group-toggle"
                      aria-expanded={isOpen}
                      aria-controls={panel}
                      onClick={() => {
                        if (!searching) toggleGroup(group.id);
                      }}
                    >
                      {group.label}
                      <span className="ask-count">
                        {' '}
                        (
                        {searching
                          ? t.node('appAgency.appAgencyOrgidEvidencePicker.lengthOfLength2', {
                              length: matches.length,
                              length2: view.entries.length,
                            })
                          : view.entries.length}
                        {picked > 0
                          ? t.node('appAgency.appAgencyOrgidEvidencePicker.pickedSelected', {
                              picked,
                            })
                          : ''}
                        )
                      </span>
                    </button>
                  </div>
                  <div id={panel} hidden={!isOpen}>
                    {isOpen ? (
                      <fieldset className="ask-fieldset">
                        <legend className="sr-only">{group.label}</legend>
                        <ul className="ask-list">
                          {matches.slice(0, limit).map((entry) => (
                            <li key={entry.id}>{row(entry.id, entry.label, entry.hint)}</li>
                          ))}
                        </ul>
                        {matches.length > limit ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => showMore(group.id)}
                          >
                            {`Show More (${matches.length - limit})`}
                          </button>
                        ) : null}
                      </fieldset>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
