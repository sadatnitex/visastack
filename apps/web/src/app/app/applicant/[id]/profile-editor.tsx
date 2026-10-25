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
import type {
  EditorFieldDef,
  EditorGroup,
  EditorLayer,
  EditorSection,
  MasterProfileView,
} from '../../../../lib/master-profile-types';
import { type ActionState, saveFactAction } from './actions';
import {
  openSuggestedSectionsAction,
  saveOtherItemAction,
  setExemptionAction,
  setSectionOpenAction,
} from './section-actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** The choice that opens a free text box. Matches the catalogue's own wording. */
const OTHER_CHOICE = 'Other';

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
      <summary className="muted" style={{ fontSize: 'var(--text-caption)', cursor: 'pointer' }}>
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
        <p className="muted u-fs-075-m0">
          {assurance.applicantDeclared ? '✓ Declared by the applicant.' : '✗ Not yet declared.'}
        </p>
        <p className="muted u-fs-075-m0">
          {assurance.documentSupplied
            ? '✓ Backed by a supplied document.'
            : '✗ No supporting document supplied.'}
        </p>
        <div>
          <p className="muted u-fs-075-m0">
            Named machine checks: {assurance.machineChecks.length === 0 ? 'none performed.' : ''}
          </p>
          {assurance.machineChecks.map((c) => (
            <p
              key={`${c.name}-${c.performedAt}`}
              className="muted"
              style={{ fontSize: 'var(--text-caption)', margin: '0 0 0 0.75rem' }}
            >
              {c.passed ? '✓' : '✗'} {c.name}, {formatDate(c.performedAt)}
              {c.detail ? `: ${c.detail}` : ''}
            </p>
          ))}
        </div>
        <div>
          <p className="muted u-fs-075-m0">
            Agency reviewed: {assurance.agencyReviews.length === 0 ? 'not yet.' : ''}
          </p>
          {assurance.agencyReviews.map((r) => (
            <p
              key={`${r.missionTitle}-${r.decidedAt}`}
              className="muted"
              style={{ fontSize: 'var(--text-caption)', margin: '0 0 0 0.75rem' }}
            >
              {r.outcome === 'ACCEPTED' ? '✓' : '✗'} {r.missionTitle}, {formatDate(r.decidedAt)}
              {r.reason ? `: ${r.reason}` : ''}
            </p>
          ))}
        </div>
        <div>
          <p className="muted u-fs-075-m0">
            Issuer confirmed:{' '}
            {assurance.issuerConfirmations.length === 0 ? 'no evidence supports this yet.' : ''}
          </p>
          {assurance.issuerConfirmations.map((c) => (
            <p
              key={`${c.issuerIdentity}-${c.validUntil}`}
              className="muted"
              style={{ fontSize: 'var(--text-caption)', margin: '0 0 0 0.75rem' }}
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
  readonly field: EditorFieldDef;
  readonly repeatingRecordKey?: string;
  readonly currentValue: string | null;
  readonly status: string | null;
  readonly updatedAt?: string | null | undefined;
  readonly effectiveFrom?: string | null | undefined;
  readonly assurance?: FieldAssurance | undefined;
  /** The document this value was read from, when it came from one. */
  readonly sourceDocumentId?: string | null | undefined;
  /** Called with the chosen option, so a choice that accepts "Other" can open its text box at once. */
  readonly onChoice?: ((choice: string) => void) | undefined;
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
  sourceDocumentId,
  onChoice,
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
        <span className="field-badges">
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
            onChange={(event) => onChoice?.(event.target.value)}
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
      <details className="field-backdate">
        <summary className="muted">Add the Date This Became True</summary>
        <div className="field-control">
          <input
            type="date"
            name="effectiveFrom"
            className="input"
            aria-label={`When ${field.label.toLowerCase()} became true. Leave blank if you are not sure.`}
            {...fieldProblem(state, 'effectiveFrom', messageId)}
          />
        </div>
      </details>
      {effectiveFrom && updatedAt && !sameDay(effectiveFrom, updatedAt) ? (
        <p className="muted u-fs-075-m0">Effective as of {formatDateOnly(effectiveFrom)}</p>
      ) : null}
      {updatedAt ? (
        <p className="muted u-fs-075-m0">Last confirmed {formatDate(updatedAt)}</p>
      ) : null}
      {sourceDocumentId ? (
        <p className="u-fs-075-m0">
          <Link
            href={`/app/applicant/${applicantId}/documents?document=${encodeURIComponent(sourceDocumentId)}`}
            aria-label={`Where this came from: the document ${field.label} was read from`}
          >
            Where This Came From
          </Link>
        </p>
      ) : null}
      {assurance ? <AssuranceDetail assurance={assurance} /> : null}
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

export interface ProfileValue {
  readonly factId: string;
  readonly value: string | null;
  readonly status: string | null;
  readonly updatedAt?: string | null;
  readonly effectiveFrom?: string | null;
  /** The document the current value was read from, when it came from one. */
  readonly sourceDocumentId?: string | null;
}

type RepeatingValues = Readonly<Record<string, Readonly<Record<string, ProfileValue>>>>;

/** One field, plus the text box that opens when its choice is "Other". */
function FieldWithOther({
  applicantId,
  field,
  repeatingRecordKey,
  lookup,
  assurance,
}: {
  readonly applicantId: string;
  readonly field: EditorFieldDef;
  readonly repeatingRecordKey?: string;
  readonly lookup: (fieldKey: string) => ProfileValue | undefined;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
}) {
  const current = lookup(field.key);
  const [choice, setChoice] = useState(current?.value ?? '');
  const detail = field.otherDetail;
  const detailCurrent = detail ? lookup(detail.key) : undefined;
  return (
    <>
      <FieldRow
        applicantId={applicantId}
        field={field}
        {...(repeatingRecordKey ? { repeatingRecordKey } : {})}
        currentValue={current?.value ?? null}
        status={current?.status ?? null}
        updatedAt={current?.updatedAt}
        effectiveFrom={current?.effectiveFrom}
        assurance={current ? assurance.get(current.factId) : undefined}
        sourceDocumentId={current?.sourceDocumentId}
        onChoice={detail ? setChoice : undefined}
      />
      {detail && (choice === OTHER_CHOICE || detailCurrent?.value) ? (
        <FieldRow
          applicantId={applicantId}
          field={detail}
          {...(repeatingRecordKey ? { repeatingRecordKey } : {})}
          currentValue={detailCurrent?.value ?? null}
          status={detailCurrent?.status ?? null}
          updatedAt={detailCurrent?.updatedAt}
          effectiveFrom={detailCurrent?.effectiveFrom}
          assurance={detailCurrent ? assurance.get(detailCurrent.factId) : undefined}
        />
      ) : null}
    </>
  );
}

/** A tick box that records "this does not apply to me" (a detail) or "I have none" (a whole record). */
function ExemptionToggle({
  applicantId,
  kind,
  targetKey,
  on,
  label,
}: {
  readonly applicantId: string;
  readonly kind: 'FIELD_NOT_APPLICABLE' | 'RECORD_NONE';
  readonly targetKey: string;
  readonly on: boolean;
  readonly label: string;
}) {
  const [state, formAction, pending] = useActionState(setExemptionAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  return (
    <form ref={formRef} action={formAction} className="profile-exempt">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="targetKey" value={targetKey} />
      <input type="hidden" name="on" value={String(!on)} />
      <label className="profile-exempt-label">
        <input
          type="checkbox"
          checked={on}
          aria-busy={pending}
          onChange={() => {
            if (!pending) formRef.current?.requestSubmit();
          }}
        />
        {label}
      </label>
      <noscript>
        <button type="submit" className="btn btn-secondary">
          Apply
        </button>
      </noscript>
      {state.ok ? null : <FormMessage id={messageId} result={state} />}
    </form>
  );
}

interface RepeatingGroupProps {
  readonly applicantId: string;
  readonly group: EditorGroup;
  readonly repeatingValues: RepeatingValues;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
}

function RepeatingGroup({ applicantId, group, repeatingValues, assurance }: RepeatingGroupProps) {
  const [newRecordKeys, setNewRecordKeys] = useState<readonly string[]>([]);
  // Union of record keys across every field in the group: a record with only some fields filled in still shows up.
  const savedKeys = new Set<string>();
  for (const field of group.fields) {
    for (const recordKey of Object.keys(repeatingValues[field.key] ?? {})) savedKeys.add(recordKey);
  }
  const recordKeys = [...savedKeys, ...newRecordKeys];

  return (
    <div className="profile-group">
      <div className="field-head">
        <span className="card-kicker u-m-0">
          {group.label} {recordKeys.length > 0 ? `(${recordKeys.length})` : null}
        </span>
        {group.noneDeclared ? null : (
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => setNewRecordKeys((keys) => [...keys, crypto.randomUUID()])}
          >
            + Add {group.label.toLowerCase()}
          </button>
        )}
      </div>
      {recordKeys.length === 0 ? (
        <p className="muted u-fs-085">
          {group.noneDeclared ? 'You said you have none.' : 'None recorded yet.'}
        </p>
      ) : (
        <div className="profile-group-records">
          {recordKeys.map((recordKey) => (
            <div key={recordKey} className="field-list profile-group-record">
              {group.fields.map((field) => (
                <FieldWithOther
                  key={field.key}
                  applicantId={applicantId}
                  field={field}
                  repeatingRecordKey={recordKey}
                  lookup={(fieldKey) => repeatingValues[fieldKey]?.[recordKey]}
                  assurance={assurance}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {recordKeys.length === 0 || group.noneDeclared ? (
        <ExemptionToggle
          applicantId={applicantId}
          kind="RECORD_NONE"
          targetKey={group.key}
          on={group.noneDeclared}
          label={`I have no ${group.label.toLowerCase()}`}
        />
      ) : null}
    </div>
  );
}

function matchesSearch(label: string, search: string): boolean {
  return search.trim() === '' || label.toLowerCase().includes(search.trim().toLowerCase());
}

function displayValue(field: EditorFieldDef, current: ProfileValue | undefined): string {
  const value = current?.value;
  if (!value) {
    return current?.status && field.sensitivity !== 'STANDARD'
      ? 'Protected detail'
      : 'Not recorded';
  }
  if (value === '[protected: could not decrypt]') return 'Could not read this detail';
  if (value === '[protected]') return 'Protected detail';
  return field.type === 'date' ? formatDateOnly(value) : value;
}

/** The free "something else" record every section keeps, so nothing a person needs is left without a home. */
function OtherItems({
  applicantId,
  section,
  repeatingValues,
  assurance,
}: {
  readonly applicantId: string;
  readonly section: EditorSection;
  readonly repeatingValues: RepeatingValues;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
}) {
  const [state, formAction, pending] = useActionState(saveOtherItemAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  const baseId = useId();
  useFocusInvalidField(formRef, state);
  useEffect(() => {
    if (state.ok && state.message === 'Saved.') formRef.current?.reset();
  }, [state]);
  const { sectionFieldKey, fields } = section.otherItem;
  const recordKeys = Object.entries(repeatingValues[sectionFieldKey] ?? {})
    .filter(([, value]) => value.value === section.key)
    .map(([recordKey]) => recordKey);
  const [title, details, date, note] = fields;

  return (
    <div className="profile-other-items">
      <h5>Something else in {section.label}</h5>
      <p className="muted">
        Not on the list? Add it here. It stays with this section and is saved like any other detail.
      </p>
      {recordKeys.map((recordKey) => (
        <div key={recordKey} className="field-list profile-group-record">
          {fields.map((field) => (
            <FieldWithOther
              key={field.key}
              applicantId={applicantId}
              field={field}
              repeatingRecordKey={recordKey}
              lookup={(fieldKey) => repeatingValues[fieldKey]?.[recordKey]}
              assurance={assurance}
            />
          ))}
        </div>
      ))}
      <details className="profile-edit-section">
        <summary>+ Add something else</summary>
        <form ref={formRef} action={formAction} className="field-list">
          <input type="hidden" name="applicantId" value={applicantId} />
          <input type="hidden" name="sectionKey" value={section.key} />
          {(
            [
              ['title', title],
              ['details', details],
              ['date', date],
              ['note', note],
            ] as const
          ).map(([name, field]) =>
            field ? (
              <div key={name} className="field-row">
                <label className="field-label" htmlFor={`${baseId}-${name}`}>
                  {field.label}
                </label>
                <input
                  id={`${baseId}-${name}`}
                  name={name}
                  type={field.type === 'date' ? 'date' : 'text'}
                  className="input"
                  {...fieldProblem(state, name, messageId)}
                />
              </div>
            ) : null,
          )}
          <SubmitButton
            pending={pending}
            idle="Save This Item"
            busy="Saving…"
            className="btn btn-secondary"
          />
          <FormMessage id={messageId} result={state} />
        </form>
      </details>
    </div>
  );
}

/** The kinds of document that back a section, with what is on file and a way to add one. */
function SectionDocuments({
  applicantId,
  documents,
  search,
}: {
  readonly applicantId: string;
  readonly documents: NonNullable<EditorSection['documents']>;
  readonly search: string;
}) {
  const headingId = useId();
  const shown = documents.filter((document) => matchesSearch(document.label, search));
  if (shown.length === 0) return null;
  return (
    <section className="section-documents" aria-labelledby={headingId}>
      <h5 id={headingId}>Documents for This Section</h5>
      <ul>
        {shown.map((document) => (
          <li key={document.key}>
            <div>
              <b>{document.label}</b>
              {document.original ? (
                <small className="muted">
                  Usually handed in as the original when you apply. Upload a clear scan or photo
                  here so it is ready to share.
                </small>
              ) : null}
            </div>
            {document.uploaded === null ? null : (
              <span
                className={`badge ${document.uploaded > 0 ? 'badge-success' : 'badge-neutral'}`}
              >
                {document.uploaded > 0 ? 'Uploaded' : 'Not Uploaded Yet'}
              </span>
            )}
            <Link
              className="btn btn-secondary"
              href={`/app/applicant/${applicantId}/documents?type=${document.key}#document-upload`}
            >
              {document.uploaded ? 'Add Another' : 'Upload'}
              <span className="sr-only"> {document.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionFields({
  applicantId,
  section,
  values,
  repeatingValues,
  assurance,
  search,
}: {
  readonly applicantId: string;
  readonly section: EditorSection;
  readonly values: Readonly<Record<string, ProfileValue>>;
  readonly repeatingValues: RepeatingValues;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
  readonly search: string;
}) {
  const notApplicable = new Set(section.notApplicable);
  const singles = section.singles.filter((field) => matchesSearch(field.label, search));
  const groups = section.groups.filter(
    (group) =>
      matchesSearch(group.label, search) ||
      group.fields.some((field) => matchesSearch(field.label, search)),
  );
  return (
    <>
      {singles.length > 0 ? (
        <dl className="profile-read-summary">
          {singles.map((field) => {
            const current = values[field.key];
            const otherText = field.otherDetail ? values[field.otherDetail.key]?.value : undefined;
            return (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>
                  {notApplicable.has(field.key)
                    ? 'Does not apply'
                    : current?.value === OTHER_CHOICE && otherText
                      ? `Other: ${otherText}`
                      : displayValue(field, current)}
                </dd>
                {current?.status === 'CONFLICTED' ? (
                  <span className="badge badge-warning">Needs Review</span>
                ) : null}
              </div>
            );
          })}
        </dl>
      ) : null}
      {singles.length > 0 ? (
        <details className="profile-edit-section" open={search.trim() ? true : undefined}>
          <summary>Edit These Details</summary>
          <div className="field-list">
            {singles.map((field) => {
              const applies = !notApplicable.has(field.key);
              const hasValue = Boolean(values[field.key]?.value || values[field.key]?.status);
              return (
                <div key={field.key} className="profile-field-item">
                  {applies ? (
                    <FieldWithOther
                      applicantId={applicantId}
                      field={field}
                      lookup={(fieldKey) => values[fieldKey]}
                      assurance={assurance}
                    />
                  ) : (
                    <p className="muted">{field.label}: marked as not applying to you.</p>
                  )}
                  {(hasValue && applies) || field.optional ? null : (
                    <ExemptionToggle
                      applicantId={applicantId}
                      kind="FIELD_NOT_APPLICABLE"
                      targetKey={field.key}
                      on={!applies}
                      label="This does not apply to me"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
      {groups.map((group) => (
        <RepeatingGroup
          key={group.key}
          applicantId={applicantId}
          group={group}
          repeatingValues={repeatingValues}
          assurance={assurance}
        />
      ))}
      <OtherItems
        applicantId={applicantId}
        section={section}
        repeatingValues={repeatingValues}
        assurance={assurance}
      />
    </>
  );
}

/** The tick box that opens or closes a section. Opening adds its details to the completion at once. */
function SectionToggle({
  applicantId,
  section,
}: {
  readonly applicantId: string;
  readonly section: EditorSection;
}) {
  const [state, formAction, pending] = useActionState(setSectionOpenAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  if (section.reason === 'default') {
    return <span className="muted">Open for everyone</span>;
  }
  if (section.open && !section.canClose) {
    return <span className="muted">Open because it holds your details</span>;
  }
  return (
    <form ref={formRef} action={formAction} className="profile-exempt">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="sectionKey" value={section.key} />
      <input type="hidden" name="open" value={String(!section.open)} />
      <label className="profile-exempt-label">
        <input
          type="checkbox"
          checked={section.open}
          aria-busy={pending}
          onChange={() => {
            if (!pending) formRef.current?.requestSubmit();
          }}
        />
        Use this section
      </label>
      <noscript>
        <button type="submit" className="btn btn-secondary">
          Apply
        </button>
      </noscript>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

function SectionCard({
  applicantId,
  section,
  values,
  repeatingValues,
  assurance,
  search,
}: {
  readonly applicantId: string;
  readonly section: EditorSection;
  readonly values: Readonly<Record<string, ProfileValue>>;
  readonly repeatingValues: RepeatingValues;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
  readonly search: string;
}) {
  const headingId = useId();
  const searching = search.trim() !== '';
  return (
    <article
      id={`section-${section.key}`}
      aria-labelledby={headingId}
      className={`profile-section-card ${section.open ? 'is-open' : 'is-locked'}`}
    >
      <header className="profile-section-head">
        <div>
          <h4 id={headingId}>{section.label}</h4>
          <p className="muted">{section.description}</p>
          {section.extendsLabel ? <p className="muted">{section.extendsLabel}</p> : null}
        </div>
        <div className="profile-section-state">
          <span className={`badge ${section.open ? 'badge-success' : 'badge-neutral'}`}>
            {section.open ? 'Open' : 'Locked'}
          </span>
          {section.suggested ? <span className="badge badge-warning">Suggested</span> : null}
          <SectionToggle applicantId={applicantId} section={section} />
        </div>
      </header>
      {section.open ? (
        <>
          <p className="muted profile-section-progress">
            {section.answered} of {section.total} details counted
          </p>
          <SectionDocuments
            applicantId={applicantId}
            documents={section.documents ?? []}
            search={search}
          />
          <SectionFields
            applicantId={applicantId}
            section={section}
            values={values}
            repeatingValues={repeatingValues}
            assurance={assurance}
            search={search}
          />
        </>
      ) : (
        <details className="profile-section-preview" open={searching || undefined}>
          <summary>See the {section.detailCount} details inside</summary>
          <ul>
            {section.previewLabels
              .filter((label) => matchesSearch(label, search))
              .map((label) => (
                <li key={label}>{label}</li>
              ))}
          </ul>
          <p className="muted">
            Locked and not counted. Tick “Use this section” to fill it in; it then counts toward
            your completion.
          </p>
        </details>
      )}
    </article>
  );
}

function sectionMatches(section: EditorSection, search: string): boolean {
  if (search.trim() === '') return true;
  return (
    matchesSearch(section.label, search) ||
    matchesSearch(section.description, search) ||
    section.previewLabels.some((label) => matchesSearch(label, search)) ||
    section.singles.some((field) => matchesSearch(field.label, search)) ||
    section.groups.some(
      (group) =>
        matchesSearch(group.label, search) ||
        group.fields.some((field) => matchesSearch(field.label, search)),
    )
  );
}

function SuggestionBar({
  applicantId,
  view,
}: {
  readonly applicantId: string;
  readonly view: MasterProfileView;
}) {
  const [state, formAction, pending] = useActionState(openSuggestedSectionsAction, INITIAL);
  const messageId = useId();
  return (
    <div className="profile-suggest">
      <form method="get" action="#profile-editor" className="profile-suggest-pick">
        <label className="field-label" htmlFor="profile-purpose">
          What is this profile for?
        </label>
        <select
          id="profile-purpose"
          name="for"
          className="input"
          defaultValue={view.suggestedFamily ?? ''}
        >
          <option value="">Choose a purpose…</option>
          {view.families.map((family) => (
            <option key={family.key} value={family.key}>
              {family.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary">
          Show Suggestions
        </button>
      </form>
      {view.suggestedFamily ? (
        view.suggestedLockedCount > 0 ? (
          <form action={formAction} className="profile-suggest-open">
            <input type="hidden" name="applicantId" value={applicantId} />
            <input type="hidden" name="family" value={view.suggestedFamily} />
            <p>
              {view.suggestedLockedCount} suggested section
              {view.suggestedLockedCount === 1 ? ' is' : 's are'} still locked.
            </p>
            <SubmitButton
              pending={pending}
              idle="Open Suggested Sections"
              busy="Opening…"
              className="btn btn-primary"
            />
            <FormMessage id={messageId} result={state} />
          </form>
        ) : (
          <p className="muted">Every section suggested for this purpose is already open.</p>
        )
      ) : null}
    </div>
  );
}

/** How many of an area's details are filled in, or null when the area counts none (a pack nobody has opened). */
function layerProgress(layer: EditorLayer): { answered: number; total: number } | null {
  let answered = 0;
  let total = 0;
  for (const section of layer.sections) {
    answered += section.answered;
    total += section.total;
  }
  return total > 0 ? { answered, total } : null;
}

function AreaCount({ layer }: { readonly layer: EditorLayer }) {
  const progress = layerProgress(layer);
  if (!progress) return null;
  return (
    <span className="profile-area-count">
      {progress.answered}/{progress.total}
      <span className="sr-only"> details filled</span>
    </span>
  );
}

interface ProfileEditorProps {
  readonly applicantId: string;
  readonly values: Readonly<Record<string, ProfileValue>>;
  /** fieldKey -> recordKey -> value/status, for repeating fields only. */
  readonly repeatingValues: RepeatingValues;
  /** factId -> assurance breakdown (EVI-05), owner-only, empty when denied. */
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
  /** The sections, built on the server from the catalogue and what this person has opened. */
  readonly view: MasterProfileView;
}

export function ProfileEditor({
  applicantId,
  values,
  repeatingValues,
  assurance,
  view,
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
  const [selected, setSelected] = useState<string>(view.layers[0]?.key ?? 'identity');
  const searching = search.trim() !== '';
  const visibleLayers = view.layers.filter((layer) =>
    searching
      ? layer.sections.some((section) => sectionMatches(section, search))
      : layer.key === selected,
  );

  function selectLayer(key: string) {
    setSelected(key);
    setSearch('');
  }
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = view.layers.find((layer) => layer.key === selected) ?? view.layers[0];
  function chooseFromPicker(key: string) {
    selectLayer(key);
    setPickerOpen(false);
  }
  /** Arrow keys move through the areas as in any list of tabs; Home and End jump to the ends. */
  function moveBetweenAreas(event: React.KeyboardEvent, index: number) {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? view.layers.length - 1
          : step
            ? (index + step + view.layers.length) % view.layers.length
            : null;
    if (next === null) return;
    event.preventDefault();
    const target = view.layers[next];
    if (target) {
      selectLayer(target.key);
      document.getElementById(`profile-tab-${target.key}`)?.focus();
    }
  }
  return (
    <div ref={editor} id="profile-editor" tabIndex={-1}>
      <SuggestionBar applicantId={applicantId} view={view} />
      <div className="profile-areas">
        <div className="profile-area-nav">
          <div
            className="profile-area-rail"
            role={searching ? undefined : 'tablist'}
            aria-orientation={searching ? undefined : 'vertical'}
            aria-label="Profile areas"
          >
            {view.layers.map((layer, index) => (
              <button
                key={layer.key}
                type="button"
                role={searching ? undefined : 'tab'}
                id={`profile-tab-${layer.key}`}
                aria-selected={searching ? undefined : selected === layer.key}
                aria-controls={`profile-panel-${layer.key}`}
                tabIndex={searching || selected === layer.key ? 0 : -1}
                onClick={() => selectLayer(layer.key)}
                onKeyDown={(event) => moveBetweenAreas(event, index)}
              >
                <span className="profile-area-name">{layer.label}</span>
                <AreaCount layer={layer} />
              </button>
            ))}
          </div>
          <details
            className="profile-area-picker"
            open={pickerOpen}
            onToggle={(event) => setPickerOpen(event.currentTarget.open)}
          >
            <summary>
              <span className="profile-area-picker-label">Area</span>
              <span className="profile-area-name">{current?.label}</span>
              {current ? <AreaCount layer={current} /> : null}
            </summary>
            <div className="profile-area-picker-list">
              {view.layers.map((layer) => (
                <button
                  key={layer.key}
                  type="button"
                  aria-current={!searching && selected === layer.key ? 'true' : undefined}
                  onClick={() => chooseFromPicker(layer.key)}
                >
                  <span className="profile-area-name">{layer.label}</span>
                  <AreaCount layer={layer} />
                </button>
              ))}
            </div>
          </details>
        </div>
        <div className="profile-area-content">
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
          {searching && visibleLayers.length === 0 ? (
            <output className="muted">No fields match. Try another field name.</output>
          ) : null}
          {view.layers.map((layer) => {
            const visible = visibleLayers.some((item) => item.key === layer.key);
            return (
              <section
                key={layer.key}
                id={`profile-panel-${layer.key}`}
                role={searching ? undefined : 'tabpanel'}
                aria-labelledby={`profile-tab-${layer.key}`}
                hidden={!visible}
              >
                <h3>{layer.label}</h3>
                <p className="muted">
                  {layer.description} {layer.openCount} of {layer.sections.length} sections open.
                </p>
                {layer.sections
                  .filter((section) => sectionMatches(section, search))
                  .map((section) => (
                    <SectionCard
                      key={section.key}
                      applicantId={applicantId}
                      section={section}
                      values={values}
                      repeatingValues={repeatingValues}
                      assurance={assurance}
                      search={search}
                    />
                  ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
