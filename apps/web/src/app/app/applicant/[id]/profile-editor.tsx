'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { formatDateOnly } from '../../../../lib/format-date';
import {
  PACK_DESCRIPTIONS,
  PACK_LABELS,
  PACK_ORDER,
  type ProfileFieldDef,
  type ProfilePack,
  repeatingGroups,
  singleFields,
} from '../../../../lib/profile-fields';
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
  const inputId = repeatingRecordKey ? `f-${field.key}-${repeatingRecordKey}` : `f-${field.key}`;
  const sensitivityLabel = SENSITIVITY_LABELS[field.sensitivity];

  return (
    <form action={formAction} className="field-row">
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
        <input
          id={inputId}
          name="value"
          type={field.type === 'date' ? 'date' : 'text'}
          defaultValue={currentValue ?? ''}
          placeholder={field.placeholder ?? ''}
          className="input"
        />
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
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
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
  readonly values: Readonly<Record<string, ProfileValue>>;
  readonly repeatingValues: Readonly<Record<string, Readonly<Record<string, ProfileValue>>>>;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
  readonly search: string;
}

function matchesSearch(label: string, search: string): boolean {
  return search.trim() === '' || label.toLowerCase().includes(search.trim().toLowerCase());
}

/** Every field belonging to a pack, single or repeating — used to test "does this pack have any match". */
function allFieldsInPack(pack: ProfilePack): readonly ProfileFieldDef[] {
  return [...singleFields(pack), ...[...repeatingGroups(pack).values()].flat()];
}

function PackSection({
  applicantId,
  pack,
  values,
  repeatingValues,
  assurance,
  search,
}: PackSectionProps) {
  const groups = repeatingGroups(pack);
  const visibleSingleFields = singleFields(pack).filter((f) => matchesSearch(f.label, search));

  return (
    <>
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
  const [universalPack, ...targetGroupPacks] = PACK_ORDER;
  const [search, setSearch] = useState('');
  const searching = search.trim() !== '';

  return (
    <div>
      <div className="field-row" style={{ marginBottom: '1.25rem' }}>
        <label className="field-label" htmlFor="profile-search">
          Search fields
        </label>
        <input
          id="profile-search"
          type="search"
          className="input"
          placeholder="e.g. passport, address, employer"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!searching ? (
        <nav aria-label="Profile sections" className="pill-list" style={{ marginBottom: '1.5rem' }}>
          {PACK_ORDER.map((pack) => (
            <a key={pack} href={`#profile-pack-${pack}`} className="pill">
              {PACK_LABELS[pack]}
            </a>
          ))}
        </nav>
      ) : null}

      {universalPack ? (
        <div id={`profile-pack-${universalPack}`}>
          <PackSection
            applicantId={applicantId}
            pack={universalPack}
            values={values}
            repeatingValues={repeatingValues}
            assurance={assurance}
            search={search}
          />
        </div>
      ) : null}

      {targetGroupPacks.map((pack) => {
        const hasMatch =
          searching && allFieldsInPack(pack).some((f) => matchesSearch(f.label, search));
        return (
          <details
            key={pack}
            id={`profile-pack-${pack}`}
            style={{ marginTop: '1.75rem' }}
            open={hasMatch || undefined}
          >
            <summary
              style={{
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.15rem',
              }}
            >
              <span className="card-kicker" style={{ margin: 0 }}>
                {PACK_LABELS[pack]}
              </span>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {PACK_DESCRIPTIONS[pack]}
              </span>
            </summary>
            <div style={{ marginTop: '1rem' }}>
              <PackSection
                applicantId={applicantId}
                pack={pack}
                values={values}
                repeatingValues={repeatingValues}
                assurance={assurance}
                search={search}
              />
            </div>
          </details>
        );
      })}
    </div>
  );
}
