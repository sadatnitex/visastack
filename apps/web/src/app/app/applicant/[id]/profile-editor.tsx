'use client';

import { useState } from 'react';
import { useActionState } from 'react';
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

interface FieldRowProps {
  readonly applicantId: string;
  readonly field: ProfileFieldDef;
  readonly repeatingRecordKey?: string;
  readonly currentValue: string | null;
  readonly status: string | null;
}

function FieldRow({ applicantId, field, repeatingRecordKey, currentValue, status }: FieldRowProps) {
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
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

interface RepeatingRecordValues {
  readonly value: string | null;
  readonly status: string | null;
}

interface RepeatingGroupProps {
  readonly applicantId: string;
  readonly groupKey: string;
  readonly groupLabel: string;
  readonly fields: readonly ProfileFieldDef[];
  /** recordKey -> fieldKey -> current value/status. */
  readonly records: ReadonlyMap<string, ReadonlyMap<string, RepeatingRecordValues>>;
}

function RepeatingGroup({ applicantId, groupLabel, fields, records }: RepeatingGroupProps) {
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
  readonly value: string | null;
  readonly status: string | null;
}

interface ProfileEditorProps {
  readonly applicantId: string;
  readonly values: Readonly<Record<string, ProfileValue>>;
  /** fieldKey -> recordKey -> value/status, for repeating fields only. */
  readonly repeatingValues: Readonly<Record<string, Readonly<Record<string, ProfileValue>>>>;
}

interface PackSectionProps {
  readonly applicantId: string;
  readonly pack: ProfilePack;
  readonly values: Readonly<Record<string, ProfileValue>>;
  readonly repeatingValues: Readonly<Record<string, Readonly<Record<string, ProfileValue>>>>;
}

function PackSection({ applicantId, pack, values, repeatingValues }: PackSectionProps) {
  const groups = repeatingGroups(pack);

  return (
    <>
      <div className="field-list">
        {singleFields(pack).map((field) => {
          const current = values[field.key];
          return (
            <FieldRow
              key={field.key}
              applicantId={applicantId}
              field={field}
              currentValue={current?.value ?? null}
              status={current?.status ?? null}
            />
          );
        })}
      </div>

      {[...groups.entries()].map(([groupKey, fields]) => {
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
          />
        );
      })}
    </>
  );
}

export function ProfileEditor({ applicantId, values, repeatingValues }: ProfileEditorProps) {
  const [universalPack, ...targetGroupPacks] = PACK_ORDER;

  return (
    <div>
      {universalPack ? (
        <PackSection
          applicantId={applicantId}
          pack={universalPack}
          values={values}
          repeatingValues={repeatingValues}
        />
      ) : null}

      {targetGroupPacks.map((pack) => (
        <details key={pack} style={{ marginTop: '1.75rem' }}>
          <summary
            style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}
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
            />
          </div>
        </details>
      ))}
    </div>
  );
}
