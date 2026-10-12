'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { formatDateOnly } from '../../../../lib/format-date';
import {
  PACK_DESCRIPTIONS,
  PACK_LABELS,
  type ProfileFieldDef,
  type ProfilePack,
} from '../../../../lib/profile-fields';
import {
  PROFILE_SECTIONS,
  type ProfileSection,
  fieldsInProfileSection,
} from '../../../../lib/profile-sections';
import { type ActionState, saveFactAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const STATUS_LABELS: Record<string, string> = {
  DECLARED: 'Declared',
  APPLICANT_CONFIRMED: 'Confirmed',
  DOCUMENT_SUPPORTED: 'Document-supported',
  AGENCY_REVIEWED: 'Agency-reviewed',
  CONFLICTED: 'Conflicted',
  STALE: 'Stale',
};

const SENSITIVITY_LABELS: Record<string, string> = {
  SENSITIVE: 'Sensitive',
  RESTRICTED: 'Restricted',
};

/**
 * For genuine timestamps only (e.g. `updatedAt` — when a fact was last
 * confirmed) — local-time rendering is correct here, unlike the date-only
 * `effectiveFrom` value below (finding #25, post-programme defect
 * register), which uses the timezone-stable `formatDateOnly` instead.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * EVI-05 ("Display separate statements: applicant declared; document
 * supplied; named machine checks performed; agency reviewed; issuer
 * confirmed"). A client-safe (dates pre-serialized to ISO strings) mirror of
 * `@visastack/services`' `FactAssuranceView`, built once per fact in
 * `page.tsx`, looked up here by `factId`. `tier` is shown as a small,
 * secondary label; the five statements below it are what's actually
 * displayed, replacing the single opaque status badge with the breakdown
 * behind it.
 */
export interface FieldAssurance {
  readonly applicantDeclared: boolean;
  readonly documentSupplied: boolean;
  readonly machineChecks: ReadonlyArray<{
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string | null;
    readonly performedAt: string;
  }>;
  readonly agencyReviews: ReadonlyArray<{
    readonly missionTitle: string;
    readonly outcome: 'ACCEPTED' | 'REJECTED';
    readonly reason: string | null;
    readonly decidedAt: string;
  }>;
  readonly issuerConfirmations: ReadonlyArray<{
    readonly issuerIdentity: string;
    readonly exactClaim: string;
    readonly response: string;
    readonly validUntil: string;
    readonly expired: boolean;
  }>;
  readonly tier: 'E0' | 'E1' | 'E2' | 'E3';
}

function AssuranceDetail({ assurance }: { readonly assurance: FieldAssurance }) {
  return (
    <details style={{ marginTop: '0.3rem' }}>
      <summary className="muted" style={{ fontSize: '0.75rem', cursor: 'pointer' }}>
        Assurance ({assurance.tier})
      </summary>
      <div
        style={{
          marginTop: '0.4rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem',
          paddingLeft: '0.75rem',
          borderLeft: '2px solid var(--hairline-soft)',
        }}
      >
        <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
          {assurance.applicantDeclared ? '✓ Declared by the applicant.' : '✗ Not yet declared.'}
        </p>
        <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
          {assurance.documentSupplied
            ? '✓ Backed by a supplied document.'
            : '✗ No supporting document supplied.'}
        </p>
        <div>
          <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
            Named machine checks: {assurance.machineChecks.length === 0 ? 'none performed.' : ''}
          </p>
          {assurance.machineChecks.map((c) => (
            <p
              key={`${c.name}-${c.performedAt}`}
              className="muted"
              style={{ fontSize: '0.75rem', margin: '0 0 0 0.75rem' }}
            >
              {c.passed ? '✓' : '✗'} {c.name}, {formatDate(c.performedAt)}
              {c.detail ? `: ${c.detail}` : ''}
            </p>
          ))}
        </div>
        <div>
          <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
            Agency reviewed: {assurance.agencyReviews.length === 0 ? 'not yet.' : ''}
          </p>
          {assurance.agencyReviews.map((r) => (
            <p
              key={`${r.missionTitle}-${r.decidedAt}`}
              className="muted"
              style={{ fontSize: '0.75rem', margin: '0 0 0 0.75rem' }}
            >
              {r.outcome === 'ACCEPTED' ? '✓' : '✗'} {r.missionTitle}, {formatDate(r.decidedAt)}
              {r.reason ? `: ${r.reason}` : ''}
            </p>
          ))}
        </div>
        <div>
          <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
            Issuer confirmed:{' '}
            {assurance.issuerConfirmations.length === 0 ? 'no evidence supports this yet.' : ''}
          </p>
          {assurance.issuerConfirmations.map((c) => (
            <p
              key={`${c.issuerIdentity}-${c.validUntil}`}
              className="muted"
              style={{ fontSize: '0.75rem', margin: '0 0 0 0.75rem' }}
            >
              {c.expired ? '✗ (expired)' : '✓'} {c.issuerIdentity}: "{c.exactClaim}", response:{' '}
              {c.response}, valid until {formatDate(c.validUntil)}
            </p>
          ))}
        </div>
      </div>
    </details>
  );
}

interface FieldRowProps {
  readonly applicantId: string;
  readonly field: ProfileFieldDef;
  readonly repeatingRecordKey?: string;
  readonly currentValue: string | null;
  readonly status: string | null;
  readonly updatedAt?: string | null | undefined;
  readonly effectiveFrom?: string | null | undefined;
  readonly assurance?: FieldAssurance | undefined;
}

/** Same UTC day — the common case where a value is effective the moment it's saved. */
function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

function FieldRow({
  applicantId,
  field,
  repeatingRecordKey,
  currentValue,
  status,
  updatedAt,
  effectiveFrom,
  assurance,
}: FieldRowProps) {
  const [state, formAction, pending] = useActionState(saveFactAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  useFocusInvalidField(formRef, state);
  const inputId = repeatingRecordKey ? `f-${field.key}-${repeatingRecordKey}` : `f-${field.key}`;
  const sensitivityLabel = SENSITIVITY_LABELS[field.sensitivity];

  return (
    <form ref={formRef} action={formAction} className="field-row">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="fieldKey" value={field.key} />
      {repeatingRecordKey ? (
        <input type="hidden" name="repeatingRecordKey" value={repeatingRecordKey} />
      ) : null}
      <div className="field-head">
        <label className="field-label" htmlFor={inputId}>
          {field.label}
        </label>
        <span style={{ display: 'flex', gap: '0.4rem' }}>
          {sensitivityLabel ? (
            <span
              className={`badge ${field.sensitivity === 'RESTRICTED' ? 'badge-danger' : 'badge-warning'}`}
              title={`This field is marked ${sensitivityLabel.toLowerCase()} in the canonical registry.`}
            >
              {sensitivityLabel}
            </span>
          ) : null}
          {status ? (
            <span className="badge badge-neutral">{STATUS_LABELS[status] ?? status}</span>
          ) : null}
        </span>
      </div>
      <div className="field-control">
        {field.options ? (
          <select
            id={inputId}
            name="value"
            defaultValue={currentValue ?? ''}
            className="input"
            {...fieldProblem(state, 'value', messageId)}
          >
            <option value="">Select…</option>
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={inputId}
            name="value"
            type={field.type === 'date' ? 'date' : 'text'}
            defaultValue={currentValue ?? ''}
            placeholder={field.placeholder ?? ''}
            className="input"
            {...fieldProblem(state, 'value', messageId)}
          />
        )}
        <SubmitButton pending={pending} idle="Save" busy="Saving…" className="btn btn-secondary" />
      </div>
      <details style={{ marginTop: '-0.25rem' }}>
        <summary className="muted" style={{ fontSize: '0.75rem', cursor: 'pointer' }}>
          Backdate this entry
        </summary>
        <div className="field-control" style={{ marginTop: '0.4rem' }}>
          <input
            type="date"
            name="effectiveFrom"
            className="input"
            aria-label={`When ${field.label.toLowerCase()} became true, if not today`}
            {...fieldProblem(state, 'effectiveFrom', messageId)}
          />
        </div>
      </details>
      {effectiveFrom && updatedAt && !sameDay(effectiveFrom, updatedAt) ? (
        <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
          Effective as of {formatDateOnly(effectiveFrom)}
        </p>
      ) : null}
      {updatedAt ? (
        <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
          Last confirmed {formatDate(updatedAt)}
        </p>
      ) : null}
      {assurance ? <AssuranceDetail assurance={assurance} /> : null}
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

interface RepeatingRecordValues {
  readonly factId: string;
  readonly value: string | null;
  readonly status: string | null;
  readonly updatedAt?: string | null;
  readonly effectiveFrom?: string | null;
}

interface RepeatingGroupProps {
  readonly applicantId: string;
  readonly groupKey: string;
  readonly groupLabel: string;
  readonly fields: readonly ProfileFieldDef[];
  /** recordKey -> fieldKey -> current value/status. */
  readonly records: ReadonlyMap<string, ReadonlyMap<string, RepeatingRecordValues>>;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
}

function RepeatingGroup({
  applicantId,
  groupLabel,
  fields,
  records,
  assurance,
}: RepeatingGroupProps) {
  const [newRecordKeys, setNewRecordKeys] = useState<readonly string[]>([]);
  const recordKeys = [...records.keys(), ...newRecordKeys];

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div className="field-head" style={{ marginBottom: '0.75rem' }}>
        <span className="card-kicker" style={{ margin: 0 }}>
          {groupLabel} {recordKeys.length > 0 ? `(${recordKeys.length})` : null}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
          onClick={() => setNewRecordKeys((keys) => [...keys, crypto.randomUUID()])}
        >
          + Add {groupLabel.toLowerCase()}
        </button>
      </div>
      {recordKeys.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          None recorded yet.
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {recordKeys.map((recordKey) => (
            <div
              key={recordKey}
              className="field-list"
              style={{
                padding: '0.85rem',
                border: '1px solid var(--hairline-soft)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {fields.map((field) => {
                const current = records.get(recordKey)?.get(field.key);
                return (
                  <FieldRow
                    key={field.key}
                    applicantId={applicantId}
                    field={field}
                    repeatingRecordKey={recordKey}
                    currentValue={current?.value ?? null}
                    status={current?.status ?? null}
                    updatedAt={current?.updatedAt}
                    effectiveFrom={current?.effectiveFrom}
                    assurance={current ? assurance.get(current.factId) : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ProfileValue {
  readonly factId: string;
  readonly value: string | null;
  readonly status: string | null;
  readonly updatedAt?: string | null;
  readonly effectiveFrom?: string | null;
}

interface ProfileEditorProps {
  readonly applicantId: string;
  readonly values: Readonly<Record<string, ProfileValue>>;
  /** fieldKey -> recordKey -> value/status, for repeating fields only. */
  readonly repeatingValues: Readonly<Record<string, Readonly<Record<string, ProfileValue>>>>;
  /** factId -> assurance breakdown (EVI-05), owner-only, empty when denied. */
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
}

interface PackSectionProps {
  readonly applicantId: string;
  readonly pack: ProfilePack;
  readonly fields?: readonly ProfileFieldDef[];
  readonly values: Readonly<Record<string, ProfileValue>>;
  readonly repeatingValues: Readonly<Record<string, Readonly<Record<string, ProfileValue>>>>;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
  readonly search: string;
}

function matchesSearch(label: string, search: string): boolean {
  return search.trim() === '' || label.toLowerCase().includes(search.trim().toLowerCase());
}

function PackSection({
  applicantId,
  pack,
  values,
  repeatingValues,
  assurance,
  search,
  fields,
}: PackSectionProps) {
  const selectedFields =
    fields ?? fieldsInProfileSection('additional').filter((f) => f.pack === pack);
  const groups = new Map<string, ProfileFieldDef[]>();
  for (const field of selectedFields) {
    if (field.group) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  }
  const visibleSingleFields = selectedFields.filter(
    (f) => !f.group && matchesSearch(f.label, search),
  );

  return (
    <>
      {visibleSingleFields.length > 0 ? (
        <dl className="profile-read-summary">
          {visibleSingleFields.map((field) => {
            const current = values[field.key];
            const value = current?.value;
            return (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>
                  {value
                    ? value === '[protected: could not decrypt]'
                      ? 'Could not read this detail'
                      : value === '[protected]'
                        ? 'Protected detail'
                        : field.type === 'date'
                          ? formatDateOnly(value)
                          : (field.options?.find((option) => option === value) ?? value)
                    : current?.status && field.sensitivity !== 'STANDARD'
                      ? 'Protected detail'
                      : 'Not recorded'}
                </dd>
                {current?.status === 'CONFLICTED' ? (
                  <span className="badge badge-warning">Needs review</span>
                ) : null}
              </div>
            );
          })}
        </dl>
      ) : null}
      {visibleSingleFields.length > 0 ? (
        <details className="profile-edit-section" open={search.trim() ? true : undefined}>
          <summary>Edit these details</summary>
          <div className="field-list">
            {visibleSingleFields.map((field) => {
              const current = values[field.key];
              return (
                <FieldRow
                  key={field.key}
                  applicantId={applicantId}
                  field={field}
                  currentValue={current?.value ?? null}
                  status={current?.status ?? null}
                  updatedAt={current?.updatedAt}
                  effectiveFrom={current?.effectiveFrom}
                  assurance={current ? assurance.get(current.factId) : undefined}
                />
              );
            })}
          </div>
        </details>
      ) : null}

      {[...groups.entries()]
        .filter(([, fields]) => fields.some((f) => matchesSearch(f.label, search)))
        .map(([groupKey, fields]) => {
          // Union of record keys across every field in this group — a record
          // that only has some of its fields filled in still shows up.
          const recordKeys = new Set<string>();
          for (const field of fields) {
            for (const recordKey of Object.keys(repeatingValues[field.key] ?? {})) {
              recordKeys.add(recordKey);
            }
          }
          const records = new Map<string, Map<string, ProfileValue>>();
          for (const recordKey of recordKeys) {
            const byField = new Map<string, ProfileValue>();
            for (const field of fields) {
              const value = repeatingValues[field.key]?.[recordKey];
              if (value) byField.set(field.key, value);
            }
            records.set(recordKey, byField);
          }
          return (
            <RepeatingGroup
              key={groupKey}
              applicantId={applicantId}
              groupKey={groupKey}
              groupLabel={fields[0]?.groupLabel ?? groupKey}
              fields={fields}
              records={records}
              assurance={assurance}
            />
          );
        })}
    </>
  );
}

export function ProfileEditor({
  applicantId,
  values,
  repeatingValues,
  assurance,
}: ProfileEditorProps) {
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const openEditor = () => {
      const details = editor.current?.querySelector<HTMLDetailsElement>(
        '[id^="profile-panel-"]:not([hidden]) .profile-edit-section',
      );
      if (!details) return;
      let parent: HTMLElement | null = details;
      while (parent && parent !== editor.current) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      details.querySelector<HTMLElement>('input:not([type="hidden"]), select')?.focus();
    };
    const hash = () => {
      if (window.location.hash === '#profile-editor') openEditor();
    };
    const click = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href="#profile-editor"]'))
        openEditor();
    };
    window.addEventListener('hashchange', hash);
    document.addEventListener('click', click);
    hash();
    return () => {
      window.removeEventListener('hashchange', hash);
      document.removeEventListener('click', click);
    };
  }, []);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ProfileSection>('personal');
  const searching = search.trim() !== '';
  const visibleSections = PROFILE_SECTIONS.filter((section) =>
    searching
      ? fieldsInProfileSection(section.key).some((field) => matchesSearch(field.label, search))
      : section.key === selected,
  );

  function selectSection(key: ProfileSection) {
    setSelected(key);
    setSearch('');
  }
  return (
    <div ref={editor} id="profile-editor" tabIndex={-1}>
      <div
        className="profile-section-tabs"
        role={searching ? undefined : 'tablist'}
        aria-label="Profile sections"
      >
        {PROFILE_SECTIONS.map((section, index) => (
          <button
            key={section.key}
            type="button"
            role={searching ? undefined : 'tab'}
            id={`profile-tab-${section.key}`}
            aria-selected={searching ? undefined : selected === section.key}
            aria-controls={`profile-panel-${section.key}`}
            tabIndex={searching || selected === section.key ? 0 : -1}
            onClick={() => selectSection(section.key)}
            onKeyDown={(event) => {
              const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? PROFILE_SECTIONS.length - 1
                    : offset
                      ? (index + offset + PROFILE_SECTIONS.length) % PROFILE_SECTIONS.length
                      : null;
              if (next !== null) {
                event.preventDefault();
                const target = PROFILE_SECTIONS[next];
                if (target) {
                  selectSection(target.key);
                  document.getElementById(`profile-tab-${target.key}`)?.focus();
                }
              }
            }}
          >
            {section.label}
          </button>
        ))}
      </div>
      <Link href={`/app/applicant/${applicantId}/history`} className="profile-history-link">
        History →
      </Link>
      <div className="profile-field-search">
        <label className="field-label" htmlFor="profile-search">
          Search all profile fields
        </label>
        <input
          id="profile-search"
          type="search"
          className="input"
          placeholder="e.g. passport, address, employer"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {searching && visibleSections.length === 0 ? (
        <output className="muted">No fields match. Try another field name.</output>
      ) : null}
      {PROFILE_SECTIONS.map((section) => {
        const visible = visibleSections.some((item) => item.key === section.key);
        return (
          <section
            key={section.key}
            id={`profile-panel-${section.key}`}
            role={searching ? undefined : 'tabpanel'}
            aria-labelledby={`profile-tab-${section.key}`}
            hidden={!visible}
          >
            <h3>{section.label}</h3>
            {section.key === 'additional' ? (
              (['business', 'medical', 'medical_attendant'] as const).map((pack) => (
                <details
                  key={pack}
                  id={`profile-pack-${pack}`}
                  className="profile-extra-pack"
                  open={searching || undefined}
                >
                  <summary>
                    <strong>{PACK_LABELS[pack]}</strong>
                    <span className="muted">{PACK_DESCRIPTIONS[pack]}</span>
                  </summary>
                  <PackSection
                    applicantId={applicantId}
                    pack={pack}
                    values={values}
                    repeatingValues={repeatingValues}
                    assurance={assurance}
                    search={search}
                  />
                </details>
              ))
            ) : (
              <PackSection
                applicantId={applicantId}
                pack={section.key === 'employment' ? 'professional' : 'universal'}
                fields={fieldsInProfileSection(section.key)}
                values={values}
                repeatingValues={repeatingValues}
                assurance={assurance}
                search={search}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
