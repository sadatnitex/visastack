'use client';

import { type Locale, formatDate as formatLocaleDate } from '@visastack/i18n';
import Link from 'next/link';
import {
  type ReactNode,
  createContext,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { useLocale, useT } from '../../../../components/i18n-provider';
import {
  STATUS_MEANINGS,
  type StatusKind,
  StatusPicture,
  isStatusKind,
  statusPictureWords,
} from '../../../../components/pictures/status-picture';
import { ExpandableSection } from '../../../../components/ui-lift/expandable-section';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import { changeImpactCatalog } from '../../../../i18n/change-impact';
import { fieldStatusWords } from '../../../../lib/field-state-words';
import { formatTimestampDate } from '../../../../lib/format-date';
import type {
  EditorFieldDef,
  EditorGroup,
  EditorLayer,
  EditorSection,
  EssentialItem,
  MasterProfileView,
} from '../../../../lib/master-profile-types';
import { plural } from '../../../../lib/plural';
import { type ActionState, saveFactAction } from './actions';
import { ChangeImpactNotice } from './change-impact/change-impact-notice';
import {
  MaskedValue,
  NOT_ADDED_YET,
  PASSPORT_PAGE_KEYS,
  PASSPORT_PAGE_LABELS,
  type PassportLine,
  type PassportLineState,
  PassportPageCard,
  isMaskedDetail,
  valueRowId,
} from './passport-page-card';
import { numberText } from './number-text';
import { revealProfileValueAction } from './profile-reveal-actions';
import {
  markEndedAction,
  markNotCurrentAction,
  openSuggestedSectionsAction,
  saveOtherItemAction,
  setExemptionAction,
  setSectionOpenAction,
} from './section-actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** The choice that opens a free text box. Matches the catalogue's own wording. */
const OTHER_CHOICE = 'Other';

const SENSITIVITY_LABELS: Record<string, string> = {
  SENSITIVE: 'Sensitive',
  RESTRICTED: 'Restricted',
};

/**
 * A date-only value (a birth date, an expiry, the day something became true or ended) as one
 * unambiguous day, the same for every viewer: "17 Dec 2024", or in Bengali digits and month names.
 * Read in UTC, so a viewer west of UTC never sees the day before (finding #25). Timestamps (when a
 * value was saved or checked) use formatTimestampDate, which prints the same style (ESS1: one date
 * style on the page). A value that is not a date is shown as it was typed.
 */
const DAY_ONLY = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
function dayText(iso: string, locale: Locale): string {
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return iso;
  return formatLocaleDate(day, locale, DAY_ONLY);
}

/** A saved value as the page prints it: a date as a day, anything else as it is. */
function readText(field: EditorFieldDef, value: string, locale: Locale): string {
  return field.type === 'date' ? dayText(value, locale) : value;
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

/** How a detail was checked, as plain lines inside its row's Details (one disclosure per row). */
function AssuranceDetail({ assurance }: { readonly assurance: FieldAssurance }) {
  const t = useT(appApplicantCatalog);
  const locale = useLocale();
  return (
    <div className="profile-row-assurance">
      <p className="profile-row-details-title">
        {t.node('appApplicant.appApplicantIdProfileEditor.howThisWasChecked')}
      </p>
      <p className="muted u-fs-075-m0">
        {assurance.applicantDeclared
          ? t.node('appApplicant.appApplicantIdProfileEditor.enteredByTheTraveller')
          : t.node('appApplicant.appApplicantIdProfileEditor.notYetEntered')}
      </p>
      <p className="muted u-fs-075-m0">
        {assurance.documentSupplied
          ? t.node('appApplicant.appApplicantIdProfileEditor.backedByASuppliedDocument')
          : t.node('appApplicant.appApplicantIdProfileEditor.noSupportingDocumentSupplied')}
      </p>
      <div>
        <p className="muted u-fs-075-m0">
          Automatic checks: {assurance.machineChecks.length === 0 ? 'none done.' : ''}
        </p>
        {assurance.machineChecks.map((c) => (
          <p key={`${c.name}-${c.performedAt}`} className="muted profile-row-assurance-item">
            {c.passed ? '✓' : '✗'} {c.name}, {formatTimestampDate(c.performedAt, locale)}
            {c.detail ? `: ${c.detail}` : ''}
          </p>
        ))}
      </div>
      <div>
        <p className="muted u-fs-075-m0">
          Agency reviewed: {assurance.agencyReviews.length === 0 ? 'not yet.' : ''}
        </p>
        {assurance.agencyReviews.map((r) => (
          <p key={`${r.missionTitle}-${r.decidedAt}`} className="muted profile-row-assurance-item">
            {r.outcome === 'ACCEPTED' ? '✓' : '✗'} {r.missionTitle},{' '}
            {formatTimestampDate(r.decidedAt, locale)}
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
            className="muted profile-row-assurance-item"
          >
            {c.expired ? '✗ (expired)' : '✓'} {c.issuerIdentity}: "{c.exactClaim}", response:{' '}
            {c.response}, valid until {formatTimestampDate(c.validUntil, locale)}
          </p>
        ))}
      </div>
    </div>
  );
}

interface FieldRowProps {
  readonly applicantId: string;
  readonly field: EditorFieldDef;
  readonly repeatingRecordKey?: string;
  /** The saved fact, when there is one: needed to open a withheld value. */
  readonly factId?: string | undefined;
  readonly currentValue: string | null;
  readonly status: string | null;
  readonly updatedAt?: string | null | undefined;
  readonly effectiveFrom?: string | null | undefined;
  readonly assurance?: FieldAssurance | undefined;
  /** The document this value was read from, when it came from one. */
  readonly sourceDocumentId?: string | null | undefined;
  /** Called with the chosen option, so a choice that accepts "Other" can open its text box at once. */
  readonly onChoice?: ((choice: string) => void) | undefined;
  /** A protected value that is saved but could not be shown here (WALD2). */
  readonly locked?: ProtectedLock | undefined;
  /** Saved and protected, and not in the page: Show or Edit opens it (ESS1). */
  readonly withheld?: boolean | undefined;
  /** More history tools for this detail (No Longer Current), placed inside its Details. */
  readonly extra?: ReactNode;
}

/**
 * Why a saved, protected value is not shown: no key here (it cannot be shown or changed now), it
 * could not be opened, or what was stored is the stand-in itself (saved over the real value before
 * WALD2), so the real value has to be typed again.
 */
export type ProtectedLock = 'no_key' | 'unreadable' | 'lost';

/**
 * The stand-in a keyless read shows for a protected detail. Case and spaces do not matter. Mirrors
 * isProtectedPlaceholder in the services package (a test keeps the two in step); the client bundle
 * cannot import the services package itself.
 */
function protectedStandIn(value: string | null | undefined): ProtectedLock | undefined {
  if (!value) return undefined;
  const folded = value.replace(/\s+/g, '').toLowerCase();
  if (folded === '[protected]') return 'no_key';
  if (folded === '[protected:couldnotdecrypt]') return 'unreadable';
  return undefined;
}

/** Plain words under a protected detail whose value is saved but not shown. */
const LOCKED_HINT: Readonly<Record<ProtectedLock, string>> = {
  no_key: 'Saved and Protected. It cannot be shown or changed here right now.',
  unreadable:
    'Saved and Protected, but it could not be opened just now. Type a new value only to replace it.',
  lost: 'This detail needs to be added again. Type it and press Save.',
};

/** Same UTC day — the common case where a value is effective the moment it's saved. */
function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

/** What opening a withheld value gives back. The value lives in component state only. */
type RevealResult = { readonly ok: true; readonly value: string } | { readonly ok: false };

/**
 * ESS1: protected values are not in the page. The editor opens one when the person chooses Show
 * or Edit, once per saved version, and keeps it in memory only (never the address or storage).
 */
interface Reveals {
  /** The opened value of a withheld detail, or undefined while it is not opened. */
  readonly valueOf: (factId: string, updatedAt: string | null | undefined) => string | undefined;
  readonly reveal: (factId: string, updatedAt: string | null | undefined) => Promise<RevealResult>;
}
const RevealContext = createContext<Reveals>({
  valueOf: () => undefined,
  reveal: async () => ({ ok: false }),
});
function revealKey(factId: string, updatedAt: string | null | undefined): string {
  // A new save makes a new version: its value is opened afresh, never the one opened before.
  return `${factId}@${updatedAt ?? ''}`;
}

/**
 * One detail (ESS1). A saved value is a read row: its name, its value (a protected one masked,
 * with Show) and Edit. The box appears only after Edit, or at once for a detail not added yet.
 * The history tools (the date it became true, where it came from, how it was checked, No Longer
 * Current) sit behind one Details disclosure, closed at first. Without script the box is still
 * there, as plain server markup, empty for a protected value.
 */
function FieldRow({
  applicantId,
  field,
  repeatingRecordKey,
  factId,
  currentValue,
  status,
  updatedAt,
  effectiveFrom,
  assurance,
  sourceDocumentId,
  onChoice,
  locked,
  withheld = false,
  extra,
}: FieldRowProps) {
  const t = useT(appApplicantCatalog);
  const impactT = useT(changeImpactCatalog);
  const locale = useLocale();
  const reveals = useContext(RevealContext);
  const [state, formAction, pending] = useActionState(saveFactAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();
  const formId = useId();
  const dateId = useId();
  const dateHintId = useId();
  const problemId = useId();
  useFocusInvalidField(formRef, state);
  const inputId = repeatingRecordKey ? `f-${field.key}-${repeatingRecordKey}` : `f-${field.key}`;
  const sensitivityLabel = SENSITIVITY_LABELS[field.sensitivity];
  // A stand-in is never a value: it is never put in the box, so it can never be saved back.
  const standIn = protectedStandIn(currentValue);
  const shownValue = standIn ? null : currentValue;
  const lock = locked ?? standIn;
  const hintId = `${inputId}-locked`;
  const canOpen = withheld && factId !== undefined;
  const opened = canOpen ? reveals.valueOf(factId, updatedAt) : undefined;
  // Saved, so it reads as a row first. A value to add again ("lost") opens straight in its box.
  const filled = Boolean(shownValue) || withheld || lock === 'no_key' || lock === 'unreadable';
  const [editing, setEditing] = useState(!filled);
  // Shown for one saved version only: a new save starts masked again.
  const version = `${factId ?? ''}@${updatedAt ?? ''}@${currentValue ?? ''}`;
  const [shownVersion, setShownVersion] = useState<string | null>(null);
  const shown = shownVersion === version;
  const setShown = (on: boolean) => setShownVersion(on ? version : null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const focusNext = useRef<'box' | 'date' | 'edit' | null>(null);
  useEffect(() => {
    // The value went away (marked No Longer Current): the box is how a new one is added.
    if (!filled) setEditing(true);
  }, [filled]);
  useEffect(() => {
    if (!state.ok || state.message === '') return;
    // Saved: back to the read row, with the focus on Edit, so the saved message is read in place.
    focusNext.current = 'edit';
    setEditing(false);
    setShownVersion(null);
  }, [state]);
  useEffect(() => {
    const target = focusNext.current;
    if (!target || editing !== (target !== 'edit')) return;
    focusNext.current = null;
    if (target === 'edit') editRef.current?.focus();
    else document.getElementById(target === 'date' ? dateId : inputId)?.focus();
  }, [editing, inputId, dateId]);

  /** Opens a withheld value once; true when it is now in memory. */
  async function open(): Promise<boolean> {
    if (!canOpen || opened !== undefined) return true;
    setBusy(true);
    const result = await reveals.reveal(factId, updatedAt);
    setBusy(false);
    setProblem(!result.ok);
    return result.ok;
  }
  async function startEdit(focus: 'box' | 'date' = 'box') {
    // A value that would not open still leaves the box: typing a new value replaces it.
    await open();
    focusNext.current = focus;
    setEditing(true);
  }
  function cancelEdit() {
    focusNext.current = 'edit';
    setEditing(false);
  }
  async function toggleShow() {
    if (shown) {
      setShown(false);
      return;
    }
    if (await open()) setShown(true);
  }

  const labelWithName = (key: Parameters<typeof t.node>[0]) => (
    <>
      {t.node(key)}
      <span className="sr-only"> {field.label}</span>
    </>
  );
  const badges = (
    <span className="field-badges">
      {sensitivityLabel ? (
        <span
          className={`badge ${field.sensitivity === 'RESTRICTED' ? 'badge-danger' : 'badge-warning'}`}
          title={t('appApplicant.appApplicantIdProfileEditor.thisFieldIsMarkedTolowercaseIn', {
            toLowerCase: sensitivityLabel.toLowerCase(),
          })}
        >
          {sensitivityLabel}
        </span>
      ) : null}
      {status ? <span className="badge badge-neutral">{fieldStatusWords(status)}</span> : null}
    </span>
  );

  /**
   * The edit form. `live` is the one on the page; the other is the copy inside <noscript>, for a
   * browser with script switched off: it never holds a protected value.
   */
  function editForm(live: boolean) {
    const boxValue = live
      ? canOpen
        ? (opened ?? null)
        : shownValue
      : withheld
        ? null
        : shownValue;
    const describedBy = [...(lock ? [hintId] : []), ...(live && problem ? [problemId] : [])];
    const control = field.options ? (
      <select
        // Remount when the stored value changes, so a save shows what was stored, not old typing.
        key={boxValue ?? ''}
        id={inputId}
        name="value"
        defaultValue={boxValue ?? ''}
        className="input"
        onChange={(event) => onChoice?.(event.target.value)}
        {...fieldProblem(state, 'value', messageId, ...describedBy)}
      >
        <option {...t.lang('appApplicant.appApplicantIdProfileEditor.select')} value="">
          {t('appApplicant.appApplicantIdProfileEditor.select')}
        </option>
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    ) : (
      <input
        // Remount when the stored value changes, so a save shows what was stored, not old typing.
        key={boxValue ?? ''}
        id={inputId}
        name="value"
        type={field.type === 'date' ? 'date' : 'text'}
        defaultValue={boxValue ?? ''}
        placeholder={
          (lock && lock !== 'lost') || (withheld && boxValue === null)
            ? 'Saved and Protected'
            : (field.placeholder ?? '')
        }
        className="input"
        {...fieldProblem(state, 'value', messageId, ...describedBy)}
      />
    );
    return (
      <form
        ref={live ? formRef : undefined}
        id={live ? formId : undefined}
        action={formAction}
        className="field-row"
      >
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="fieldKey" value={field.key} />
        {repeatingRecordKey ? (
          <input type="hidden" name="repeatingRecordKey" value={repeatingRecordKey} />
        ) : null}
        <div className="field-head">
          <label className="field-label" htmlFor={inputId}>
            {field.label}
          </label>
          {badges}
        </div>
        <div className="field-control">
          {control}
          <SubmitButton pending={pending} idle="Save" busy="Saving…" className="btn btn-primary" />
          {live && filled ? (
            <button type="button" className="btn btn-secondary" onClick={cancelEdit}>
              {labelWithName('appApplicant.appApplicantIdProfileEditor.ess1Cancel')}
            </button>
          ) : null}
        </div>
        {lock ? (
          <p id={hintId} className="muted u-fs-075-m0" data-protected-lock={lock}>
            {LOCKED_HINT[lock]}
          </p>
        ) : null}
        {live ? null : (
          <p className="field-control">
            <input
              type="date"
              name="effectiveFrom"
              className="input"
              aria-label={t(
                'appApplicant.appApplicantIdProfileEditor.whenTolowercaseBecameTrueLeaveBlank',
                { toLowerCase: field.label.toLowerCase() },
              )}
            />
          </p>
        )}
      </form>
    );
  }

  // The read row's value: masked while protected and not shown, the words for a value that is
  // saved but cannot be opened here, never the stand-in.
  const masked =
    !lock && (withheld || (shownValue !== null && isMaskedDetail(field.key, field.sensitivity)));
  const plain = canOpen ? opened : shownValue;
  const readValue: ReactNode =
    lock === 'no_key' || lock === 'unreadable' ? (
      displayValue(field, { factId: factId ?? '', value: null, status, locked: lock }, locale)
    ) : masked && !(shown && plain) ? (
      <MaskedValue />
    ) : plain ? (
      readText(field, plain, locale)
    ) : (
      NOT_ADDED_YET
    );

  const effectiveLine =
    effectiveFrom && updatedAt && !sameDay(effectiveFrom, updatedAt)
      ? t.node('appApplicant.appApplicantIdProfileEditor.effectiveAsOfFormatdateonly', {
          formatDateOnly: dayText(effectiveFrom, locale),
        })
      : null;
  return (
    <div className="profile-field-row" data-field={field.key} data-editing={editing || undefined}>
      {editing ? (
        editForm(true)
      ) : (
        <div className="field-row profile-read-row">
          <div className="field-head">
            <span className="field-label">{field.label}</span>
            {badges}
          </div>
          <div className="profile-read-line">
            <span
              className="profile-read-value"
              data-value
              data-masked={masked && !(shown && plain) ? 'true' : undefined}
            >
              {readValue}
            </span>
            <span className="profile-read-actions">
              {masked ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  aria-busy={busy || undefined}
                  aria-describedby={problem ? problemId : undefined}
                  onClick={toggleShow}
                >
                  {labelWithName(
                    shown
                      ? 'appApplicant.appApplicantIdProfileEditor.ess1Hide'
                      : 'appApplicant.appApplicantIdProfileEditor.ess1Show',
                  )}
                </button>
              ) : null}
              <button
                ref={editRef}
                type="button"
                className="btn btn-secondary btn-compact"
                data-edit={field.key}
                aria-busy={busy || undefined}
                onClick={() => startEdit()}
              >
                {labelWithName('appApplicant.appApplicantIdProfileEditor.ess1Edit')}
              </button>
            </span>
          </div>
          {lock ? (
            <p id={hintId} className="muted u-fs-075-m0" data-protected-lock={lock}>
              {LOCKED_HINT[lock]}
            </p>
          ) : null}
          {/* Without script, Edit cannot run: the form is there instead (empty when protected). */}
          <noscript>{editForm(false)}</noscript>
        </div>
      )}
      {problem ? (
        <output id={problemId} className="muted u-fs-075-m0 profile-row-problem">
          {t.node('appApplicant.appApplicantIdProfileEditor.ess1CouldNotShow')}
        </output>
      ) : null}
      {/* One Details per row, closed at first, in the order of the approved layout. */}
      <details className="profile-row-details">
        <summary className="muted">
          {labelWithName('appApplicant.appApplicantIdProfileEditor.ess1Details')}
        </summary>
        <div className="profile-row-details-body">
          {effectiveLine ? <p className="muted u-fs-075-m0">{effectiveLine}</p> : null}
          {updatedAt ? (
            <p className="muted u-fs-075-m0">
              {t.node('appApplicant.appApplicantIdProfileEditor.lastConfirmedFormatdate', {
                formatDate: formatTimestampDate(updatedAt, locale),
              })}
            </p>
          ) : null}
          {sourceDocumentId ? (
            <p className="u-fs-075-m0">
              <Link
                href={`/app/applicant/${applicantId}/documents?document=${encodeURIComponent(sourceDocumentId)}`}
                aria-label={t(
                  'appApplicant.appApplicantIdProfileEditor.whereThisCameFromTheDocument',
                  { label: field.label },
                )}
              >
                {t.node('appApplicant.appApplicantIdProfileEditor.whereThisCameFrom')}
              </Link>
            </p>
          ) : null}
          {assurance ? <AssuranceDetail assurance={assurance} /> : null}
          {editing ? (
            <div className="field-backdate">
              <label className="field-label" htmlFor={dateId}>
                {t.node('appApplicant.appApplicantIdProfileEditor.addTheDateThisBecameTrue')}
              </label>
              <p id={dateHintId} className="muted u-fs-075-m0">
                {t.node(
                  'appApplicant.appApplicantIdProfileEditor.whenTolowercaseBecameTrueLeaveBlank',
                  { toLowerCase: field.label.toLowerCase() },
                )}
              </p>
              <input
                id={dateId}
                type="date"
                name="effectiveFrom"
                form={formId}
                className="input"
                {...fieldProblem(state, 'effectiveFrom', messageId, dateHintId)}
              />
            </div>
          ) : (
            <p className="profile-row-details-actions">
              {/* Opens the box with the date field, so the date goes with the value it is for. */}
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => startEdit('date')}
              >
                {labelWithName('appApplicant.appApplicantIdProfileEditor.addTheDateThisBecameTrue')}
              </button>
            </p>
          )}
          {extra}
        </div>
      </details>
      <FormMessage id={messageId} result={state} />
      <ChangeImpactNotice
        summary={state.changeImpact}
        unavailable={state.changeImpactUnavailable}
        t={impactT}
      />
    </div>
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
  /** Saved and protected, but its value is not shown here (`value` is then null). */
  readonly locked?: ProtectedLock | null;
  /**
   * ESS1: saved and protected, and left out of the page on purpose (`value` is then null). Show
   * or Edit opens it through the owner-only reveal action.
   */
  readonly withheld?: boolean;
}

type RepeatingValues = Readonly<Record<string, Readonly<Record<string, ProfileValue>>>>;

/** One field, plus the text box that opens when its choice is "Other". */
function FieldWithOther({
  applicantId,
  field,
  repeatingRecordKey,
  lookup,
  assurance,
  extra,
}: {
  readonly applicantId: string;
  readonly field: EditorFieldDef;
  readonly repeatingRecordKey?: string;
  readonly lookup: (fieldKey: string) => ProfileValue | undefined;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
  /** More history tools for the detail itself, placed inside its Details. */
  readonly extra?: ReactNode;
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
        factId={current?.factId}
        currentValue={current?.value ?? null}
        status={current?.status ?? null}
        updatedAt={current?.updatedAt}
        effectiveFrom={current?.effectiveFrom}
        assurance={current ? assurance.get(current.factId) : undefined}
        sourceDocumentId={current?.sourceDocumentId}
        onChoice={detail ? setChoice : undefined}
        locked={current?.locked ?? undefined}
        withheld={current?.withheld}
        extra={extra}
      />
      {/* A saved Other text stays visible when it is protected and not shown here (WALD2). */}
      {detail &&
      (choice === OTHER_CHOICE ||
        detailCurrent?.value ||
        detailCurrent?.locked ||
        detailCurrent?.withheld) ? (
        <FieldRow
          applicantId={applicantId}
          field={detail}
          {...(repeatingRecordKey ? { repeatingRecordKey } : {})}
          factId={detailCurrent?.factId}
          withheld={detailCurrent?.withheld}
          currentValue={detailCurrent?.value ?? null}
          status={detailCurrent?.status ?? null}
          updatedAt={detailCurrent?.updatedAt}
          effectiveFrom={detailCurrent?.effectiveFrom}
          assurance={detailCurrent ? assurance.get(detailCurrent.factId) : undefined}
          locked={detailCurrent?.locked ?? undefined}
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
  const t = useT(appApplicantCatalog);
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
          {t.node('appApplicant.appApplicantIdProfileEditor.apply')}
        </button>
      </noscript>
      {state.ok ? null : <FormMessage id={messageId} result={state} />}
    </form>
  );
}

/** LC-G1: entry key to the date it ended (ISO), for the entries the person said have ended. */
const EndedRecordsContext = createContext<ReadonlyMap<string, string>>(new Map());

/** A saved value that is still current: something is on file and it was not marked no longer current. */
function isCurrentValue(current: ProfileValue | undefined): boolean {
  if (!current) return false;
  if (current.status === 'STALE' && !current.value && !current.withheld) return false;
  return Boolean(current.value || current.withheld || current.status);
}

/** Today as YYYY-MM-DD in the viewer's own time zone, the latest day an entry can have ended. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * "No Longer Current" for one saved value, or the note once it is marked. It stays mounted across
 * the change, so the result is still announced and focus moves to the detail's own input, ready
 * for a new value. Reversible by entering a new value.
 */
function NotCurrentControl({
  applicantId,
  field,
  current,
}: {
  readonly applicantId: string;
  readonly field: EditorFieldDef;
  readonly current: ProfileValue;
}) {
  const t = useT(appApplicantCatalog);
  const [state, formAction, pending] = useActionState(markNotCurrentAction, INITIAL);
  const messageId = useId();
  useEffect(() => {
    if (state.ok && state.message !== '') document.getElementById(`f-${field.key}`)?.focus();
  }, [state, field.key]);
  const marked = current.status === 'STALE' && !current.value && !current.withheld;
  return (
    <div className="profile-lifecycle-mark">
      {marked ? (
        <p className="muted u-fs-075-m0">
          {t.node('appApplicant.appApplicantIdProfileEditor.youMarkedThisNoLongerCurrent')}
        </p>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="applicantId" value={applicantId} />
          <input type="hidden" name="factId" value={current.factId} />
          <SubmitButton
            pending={pending}
            idle="No Longer Current"
            busy="Saving…"
            className="btn btn-secondary btn-compact"
            label={t('appApplicant.appApplicantIdProfileEditor.noLongerCurrentLabel', {
              label: field.label,
            })}
          />
        </form>
      )}
      <FormMessage id={messageId} result={state} />
    </div>
  );
}

/**
 * "Ended" for one saved entry of a list, or the note that it ended. It stays mounted across the
 * change, so the result is announced and focus moves to the note. `position` tells identical
 * entries apart for a screen reader ("Address 2").
 */
function RecordEndState({
  applicantId,
  group,
  recordKey,
  endedOn,
  position,
}: {
  readonly applicantId: string;
  readonly group: EditorGroup;
  readonly recordKey: string;
  readonly endedOn: string | undefined;
  readonly position: number;
}) {
  const t = useT(appApplicantCatalog);
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(markEndedAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const messageId = useId();
  const dateId = useId();
  useFocusInvalidField(formRef, state);
  useEffect(() => {
    if (state.ok && state.message !== '') noteRef.current?.focus();
  }, [state]);
  const name = `${group.label} ${position}`;
  return (
    <>
      {endedOn ? (
        <div ref={noteRef} tabIndex={-1} className="profile-record-ended">
          <span className="badge badge-neutral">
            {t.node('appApplicant.appApplicantIdProfileEditor.ended')}
          </span>
          <p className="muted u-fs-075-m0">
            {t.node(
              'appApplicant.appApplicantIdProfileEditor.endedOnFormatdateonlyItsDetailsStay',
              {
                formatDateOnly: dayText(endedOn, locale),
              },
            )}
          </p>
        </div>
      ) : (
        <details className="profile-record-end">
          <summary className="muted">
            {t.node('appApplicant.appApplicantIdProfileEditor.thisLabelEndedPosition', {
              label: group.label,
              position,
            })}
          </summary>
          <form ref={formRef} action={formAction} className="field-control">
            <input type="hidden" name="applicantId" value={applicantId} />
            <input type="hidden" name="recordGroupKey" value={group.key} />
            <input type="hidden" name="repeatingRecordKey" value={recordKey} />
            <label className="field-label" htmlFor={dateId}>
              {t.node('appApplicant.appApplicantIdProfileEditor.dateItEnded')}
            </label>
            <input
              id={dateId}
              type="date"
              name="endedOn"
              className="input"
              required
              max={localToday()}
              suppressHydrationWarning
              {...fieldProblem(state, 'endedOn', messageId)}
            />
            <SubmitButton
              pending={pending}
              idle="Mark as Ended"
              busy="Saving…"
              className="btn btn-secondary btn-compact"
              label={t('appApplicant.appApplicantIdProfileEditor.markAsEndedName', { name })}
            />
          </form>
        </details>
      )}
      <FormMessage id={messageId} result={state} />
    </>
  );
}

interface RepeatingGroupProps {
  readonly applicantId: string;
  readonly group: EditorGroup;
  readonly repeatingValues: RepeatingValues;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
}

function RepeatingGroup({ applicantId, group, repeatingValues, assurance }: RepeatingGroupProps) {
  const t = useT(appApplicantCatalog);
  const [newRecordKeys, setNewRecordKeys] = useState<readonly string[]>([]);
  // Union of record keys across every field in the group: a record with only some fields filled in still shows up.
  const savedKeys = new Set<string>();
  for (const field of group.fields) {
    for (const recordKey of Object.keys(repeatingValues[field.key] ?? {})) savedKeys.add(recordKey);
  }
  const recordKeys = [...savedKeys, ...newRecordKeys];
  const ended = useContext(EndedRecordsContext);

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
            {t.node('appApplicant.appApplicantIdProfileEditor.addLabel', { label: group.label })}
          </button>
        )}
      </div>
      {recordKeys.length === 0 ? (
        <p className="muted u-fs-085">
          {group.noneDeclared
            ? t.node('appApplicant.appApplicantIdProfileEditor.youSaidYouHaveNone')
            : t.node('appApplicant.appApplicantIdProfileEditor.noneRecordedYet')}
        </p>
      ) : (
        <div className="profile-group-records">
          {recordKeys.map((recordKey, index) => (
            <div key={recordKey} className="field-list profile-group-record">
              {savedKeys.has(recordKey) ? (
                <RecordEndState
                  applicantId={applicantId}
                  group={group}
                  recordKey={recordKey}
                  endedOn={ended.get(recordKey)}
                  position={index + 1}
                />
              ) : null}
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
          label={t('appApplicant.appApplicantIdProfileEditor.iHaveNoTolowercase', {
            toLowerCase: group.label.toLowerCase(),
          })}
        />
      ) : null}
    </div>
  );
}

function matchesSearch(label: string, search: string): boolean {
  return search.trim() === '' || label.toLowerCase().includes(search.trim().toLowerCase());
}

function displayValue(
  field: EditorFieldDef,
  current: ProfileValue | undefined,
  locale: Locale,
): string {
  const value = current?.value;
  const lock = current?.locked ?? protectedStandIn(value);
  if (lock === 'unreadable') return 'Could not read this detail';
  if (lock === 'lost') return 'Needs to be added again';
  if (lock === 'no_key') return 'Protected detail';
  if (!value && current?.status === 'STALE') return 'No Longer Current';
  if (!value) {
    return current?.status && field.sensitivity !== 'STANDARD'
      ? 'Protected detail'
      : 'Not recorded';
  }
  return readText(field, value, locale);
}

/**
 * What one detail shows in place of an edit box (WAL4), for the Passport Page Card and the value
 * rows alike, so both always say the same thing: the saved value (a protected one masked), or the
 * words that stand in its place. Never the stand-in "[protected]".
 */
function detailState(
  field: EditorFieldDef,
  current: ProfileValue | undefined,
  applies: boolean,
  otherText: string | null | undefined,
  doesNotApply: ReactNode,
  otherWords: (otherText: string) => string,
  locale: Locale,
  /** The value of a withheld detail, once the person opened it with Show or Edit. */
  opened: string | undefined,
): PassportLineState {
  if (!applies) return { kind: 'note', text: doesNotApply };
  const value = current?.value ?? null;
  if (current?.locked || protectedStandIn(value)) {
    return { kind: 'note', text: displayValue(field, current, locale) };
  }
  if (current?.withheld) {
    // Not in the page: masked, and printed only after Show opens it.
    return {
      kind: 'value',
      text: opened === undefined ? null : readText(field, opened, locale),
      masked: true,
    };
  }
  if (value) {
    if (value === OTHER_CHOICE && otherText) {
      return { kind: 'value', text: otherWords(otherText), masked: false };
    }
    return {
      kind: 'value',
      text: readText(field, value, locale),
      masked: isMaskedDetail(field.key, field.sensitivity),
    };
  }
  if (current?.status === 'STALE' || (current?.status && field.sensitivity !== 'STANDARD')) {
    return { kind: 'note', text: displayValue(field, current, locale) };
  }
  return { kind: 'empty' };
}

/** The status picture code for a saved value, or null: none for a value that has to be added again. */
function statusKindOf(current: ProfileValue | undefined): StatusKind | null {
  if (!current?.status || current.locked === 'lost') return null;
  return isStatusKind(current.status) ? current.status : null;
}

/** The one line under a value row's name. */
function ValueSummary({
  field,
  current,
  applies,
  otherText,
}: {
  readonly field: EditorFieldDef;
  readonly current: ProfileValue | undefined;
  readonly applies: boolean;
  readonly otherText: string | null;
}) {
  const t = useT(appApplicantCatalog);
  const locale = useLocale();
  // The summary stays masked: Show is on the row inside, so the summary never prints the value.
  const state = detailState(
    field,
    current,
    applies,
    otherText,
    t.node('appApplicant.appApplicantIdProfileEditor.doesNotApply'),
    (text) => t('appApplicant.appApplicantIdProfileEditor.otherOthertext', { otherText: text }),
    locale,
    undefined,
  );
  return (
    <>
      {state.kind === 'empty' ? (
        NOT_ADDED_YET
      ) : state.kind === 'note' ? (
        state.text
      ) : state.masked ? (
        <MaskedValue />
      ) : (
        state.text
      )}
      {current?.status === 'CONFLICTED' ? (
        <>
          {' '}
          <span className="badge badge-warning">
            {t.node('appApplicant.appApplicantIdProfileEditor.needsReview')}
          </span>
        </>
      ) : null}
    </>
  );
}

/** Where each of the eleven passport details has its edit row in this view. */
interface PassportPlace {
  readonly field: EditorFieldDef;
  readonly layerKey: string;
  readonly notApplicable: boolean;
}

function passportPlaces(view: MasterProfileView): ReadonlyMap<string, PassportPlace> {
  const keys: ReadonlySet<string> = new Set(PASSPORT_PAGE_KEYS);
  const places = new Map<string, PassportPlace>();
  for (const layer of view.layers) {
    for (const section of layer.sections) {
      if (!section.open) continue;
      for (const field of section.singles) {
        if (!keys.has(field.key) || places.has(field.key)) continue;
        places.set(field.key, {
          field,
          layerKey: layer.key,
          notApplicable: section.notApplicable.includes(field.key),
        });
      }
    }
  }
  return places;
}

const PASSPORT_DATE_KEYS: ReadonlySet<string> = new Set([
  'date_of_birth',
  'passport_issue_date',
  'passport_expiry',
]);

/** A stand-in definition for a detail this view does not list, so its value is still drawn safely. */
function fallbackField(key: string): EditorFieldDef {
  return {
    key,
    label: key,
    sensitivity: isMaskedDetail(key, undefined) ? 'SENSITIVE' : 'STANDARD',
    ...(PASSPORT_DATE_KEYS.has(key) ? { type: 'date' as const } : {}),
  };
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
  const t = useT(appApplicantCatalog);
  const [state, formAction, pending] = useActionState(saveOtherItemAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  const baseId = useId();
  useFocusInvalidField(formRef, state);
  useEffect(() => {
    // Any success clears the form so a second click cannot save the same item twice; the wording is free to change.
    if (state.ok && state.message !== '') formRef.current?.reset();
  }, [state]);
  const { sectionFieldKey, fields } = section.otherItem;
  const recordKeys = Object.entries(repeatingValues[sectionFieldKey] ?? {})
    .filter(([, value]) => value.value === section.key)
    .map(([recordKey]) => recordKey);
  const [title, details, date, note] = fields;

  return (
    <div className="profile-other-items">
      <h5>
        {t.node('appApplicant.appApplicantIdProfileEditor.somethingElseInLabel', {
          label: section.label,
        })}
      </h5>
      <p className="muted">
        {t.node('appApplicant.appApplicantIdProfileEditor.notOnTheListAddIt')}
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
        <summary>{t.node('appApplicant.appApplicantIdProfileEditor.addSomethingElse')}</summary>
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
  const t = useT(appApplicantCatalog);
  const headingId = useId();
  const shown = documents.filter((document) => matchesSearch(document.label, search));
  if (shown.length === 0) return null;
  return (
    <section className="section-documents" aria-labelledby={headingId}>
      <h5 id={headingId}>
        {t.node('appApplicant.appApplicantIdProfileEditor.documentsForThisSection')}
      </h5>
      <ul>
        {shown.map((document) => (
          <li key={document.key}>
            <div>
              <b>{document.label}</b>
              {document.original ? (
                <small className="muted">
                  {t.node('appApplicant.appApplicantIdProfileEditor.usuallyHandedInAsTheOriginal')}
                </small>
              ) : null}
            </div>
            {document.uploaded === null ? null : (
              <span
                className={`badge ${document.uploaded > 0 ? 'badge-success' : 'badge-neutral'}`}
              >
                {document.uploaded > 0
                  ? t.node('appApplicant.appApplicantIdProfileEditor.uploaded')
                  : t.node('appApplicant.appApplicantIdProfileEditor.notUploadedYet')}
              </span>
            )}
            <Link
              className="btn btn-secondary"
              href={`/app/applicant/${applicantId}/documents/add?type=${document.key}`}
            >
              {document.uploaded
                ? t.node('appApplicant.appApplicantIdProfileEditor.addAnother')
                : t.node('appApplicant.appApplicantIdProfileEditor.upload')}
              <span className="sr-only"> {document.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One single detail with its edit form, or the note that it does not apply, plus the "does not
 * apply" tick box while it holds no value. Sections and the Essentials First list both use it.
 */
function SingleField({
  applicantId,
  field,
  applies,
  values,
  assurance,
}: {
  readonly applicantId: string;
  readonly field: EditorFieldDef;
  readonly applies: boolean;
  readonly values: Readonly<Record<string, ProfileValue>>;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
}) {
  const t = useT(appApplicantCatalog);
  const current = values[field.key];
  const hasValue = isCurrentValue(current);
  return (
    <div className="profile-field-item">
      {applies ? (
        <FieldWithOther
          applicantId={applicantId}
          field={field}
          lookup={(fieldKey) => values[fieldKey]}
          assurance={assurance}
          extra={
            current && (hasValue || current.status === 'STALE') ? (
              <NotCurrentControl applicantId={applicantId} field={field} current={current} />
            ) : undefined
          }
        />
      ) : (
        <p className="muted">
          {t.node('appApplicant.appApplicantIdProfileEditor.labelMarkedAsNotApplyingTo', {
            label: field.label,
          })}
        </p>
      )}
      {(hasValue && applies) || field.optional ? null : (
        <ExemptionToggle
          applicantId={applicantId}
          kind="FIELD_NOT_APPLICABLE"
          targetKey={field.key}
          on={!applies}
          label={t('appApplicant.appApplicantIdProfileEditor.thisDoesNotApplyToMe')}
        />
      )}
    </div>
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
        <div className="profile-value-rows">
          {singles.map((field) => {
            const current = values[field.key];
            const applies = !notApplicable.has(field.key);
            const kind = statusKindOf(current);
            return (
              <ExpandableSection
                key={field.key}
                id={valueRowId(field.key)}
                className="profile-value-row"
                headingLevel={5}
                title={field.label}
                summary={
                  <ValueSummary
                    field={field}
                    current={current}
                    applies={applies}
                    otherText={
                      field.otherDetail ? (values[field.otherDetail.key]?.value ?? null) : null
                    }
                  />
                }
                {...(kind
                  ? {
                      status: (
                        <StatusPicture
                          kind={kind}
                          label={`${field.label}: ${STATUS_MEANINGS[kind].name}`}
                        />
                      ),
                      statusDescription: statusPictureWords(kind),
                    }
                  : {})}
                defaultOpen={search.trim() !== ''}
              >
                <SingleField
                  applicantId={applicantId}
                  field={field}
                  applies={applies}
                  values={values}
                  assurance={assurance}
                />
              </ExpandableSection>
            );
          })}
        </div>
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
  const t = useT(appApplicantCatalog);
  const [state, formAction, pending] = useActionState(setSectionOpenAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  if (section.reason === 'default') {
    return (
      <span className="muted">
        {t.node('appApplicant.appApplicantIdProfileEditor.openForEveryone')}
      </span>
    );
  }
  if (section.open && !section.canClose) {
    return (
      <span className="muted">
        {t.node('appApplicant.appApplicantIdProfileEditor.openBecauseItHoldsYourDetails')}
      </span>
    );
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
        {t.node('appApplicant.appApplicantIdProfileEditor.useThisSection')}
      </label>
      <noscript>
        <button type="submit" className="btn btn-secondary">
          {t.node('appApplicant.appApplicantIdProfileEditor.apply')}
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
  const t = useT(appApplicantCatalog);
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
            {section.open
              ? t.node('appApplicant.appApplicantIdProfileEditor.open')
              : t.node('appApplicant.appApplicantIdProfileEditor.locked')}
          </span>
          {section.suggested ? (
            <span className="badge badge-warning">
              {t.node('appApplicant.appApplicantIdProfileEditor.suggested')}
            </span>
          ) : null}
          <SectionToggle applicantId={applicantId} section={section} />
        </div>
      </header>
      {section.open ? (
        <>
          <p className="muted profile-section-progress">
            {t.node('appApplicant.appApplicantIdProfileEditor.answeredOfTotalDetailsCounted', {
              answered: section.answered,
              total: section.total,
            })}
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
          <summary>
            {t.node('appApplicant.appApplicantIdProfileEditor.seeThePluralInside', {
              plural: plural(section.detailCount, 'detail'),
            })}
          </summary>
          <ul>
            {section.previewLabels
              .filter((label) => matchesSearch(label, search))
              .map((label) => (
                <li key={label}>{label}</li>
              ))}
          </ul>
          <p className="muted">
            {t.node('appApplicant.appApplicantIdProfileEditor.lockedAndNotCountedTickUse')}
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
  const t = useT(appApplicantCatalog);
  const [state, formAction, pending] = useActionState(openSuggestedSectionsAction, INITIAL);
  const messageId = useId();
  return (
    <div className="profile-suggest">
      <form method="get" action="#profile-editor" className="profile-suggest-pick">
        <label className="field-label" htmlFor="profile-purpose">
          {t.node('appApplicant.appApplicantIdProfileEditor.whatIsThisProfileFor')}
        </label>
        <select
          id="profile-purpose"
          name="for"
          className="input"
          defaultValue={view.suggestedFamily ?? ''}
        >
          <option {...t.lang('appApplicant.appApplicantIdProfileEditor.chooseAPurpose')} value="">
            {t('appApplicant.appApplicantIdProfileEditor.chooseAPurpose')}
          </option>
          {view.families.map((family) => (
            <option key={family.key} value={family.key}>
              {family.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary">
          {t.node('appApplicant.appApplicantIdProfileEditor.showSuggestions')}
        </button>
      </form>
      {view.suggestedFamily ? (
        view.suggestedLockedCount > 0 ? (
          <form action={formAction} className="profile-suggest-open">
            <input type="hidden" name="applicantId" value={applicantId} />
            <input type="hidden" name="family" value={view.suggestedFamily} />
            <p>
              {t.node(
                'appApplicant.appApplicantIdProfileEditor.suggestedlockedcountSuggestedSectionsAreStillLoc',
                { suggestedLockedCount: view.suggestedLockedCount },
              )}
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
          <p className="muted">
            {t.node('appApplicant.appApplicantIdProfileEditor.everySectionSuggestedForThisPurpose')}
          </p>
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
  const t = useT(appApplicantCatalog);
  const progress = layerProgress(layer);
  if (!progress) return null;
  return (
    <span className="profile-area-count">
      {progress.answered}/{progress.total}
      <span className="sr-only">
        {' '}
        {t.node('appApplicant.appApplicantIdProfileEditor.detailsFilled')}
      </span>
    </span>
  );
}

/** What an essential's badge says. "Added" never claims the value was checked or confirmed. */
function essentialStatus(item: EssentialItem): { readonly label: string; readonly tone: string } {
  if (!item.answered) return { label: 'Not Added Yet', tone: 'badge-neutral' };
  if (item.notApplicable) return { label: 'Does Not Apply', tone: 'badge-neutral' };
  if (item.group?.noneDeclared) return { label: 'None Recorded', tone: 'badge-neutral' };
  return { label: 'Added', tone: 'badge-success' };
}

/**
 * Essentials First: the essentials the Passport Page Card does not show (ESS1), still to add, as
 * a short list before everything else. The card already prints the passport ones, with Add on
 * each, so no detail is listed twice. An item added here stays until the page is next opened, so
 * the saved message and the focus are not lost. When nothing is left, the block is not drawn;
 * its count stays in the banner ("x of 12"). Each essential is also in its own section, behind
 * Show All Sections, so nothing is only reachable from here.
 */
function EssentialsFirst({
  applicantId,
  items,
  values,
  repeatingValues,
  assurance,
}: {
  readonly applicantId: string;
  readonly items: readonly EssentialItem[];
  readonly values: Readonly<Record<string, ProfileValue>>;
  readonly repeatingValues: RepeatingValues;
  readonly assurance: ReadonlyMap<string, FieldAssurance>;
}) {
  const t = useT(appApplicantCatalog);
  const locale = useLocale();
  const headingId = useId();
  const left = items.filter((item) => !item.answered).length;
  return (
    <section className="profile-essentials" aria-labelledby={headingId}>
      <div className="profile-essentials-head">
        <h3 id={headingId}>{t.node('appApplicant.appApplicantIdProfileEditor.essentialsFirst')}</h3>
        {left > 0 ? (
          <span className="badge badge-warning profile-essentials-left">
            {t.node('appApplicant.appApplicantIdProfileEditor.ess1LeftToAdd', {
              count: numberText(left, locale),
            })}
          </span>
        ) : null}
      </div>
      <p className="muted profile-essentials-lede">
        {t.node('appApplicant.appApplicantIdProfileEditor.ess1OnlyNotOnThePassportPage')}
      </p>
      <ol className="profile-essentials-list">
        {items.map((item) => {
          // A detail names itself in its own row; a record (Home Address) is named here.
          const named = Boolean(item.group) || Boolean(item.hint) || item.notApplicable;
          const status = essentialStatus(item);
          return (
            <li
              key={item.key}
              className={`profile-essential ${item.answered ? 'is-done' : 'is-missing'}`}
              data-essential={item.key}
            >
              {named ? (
                <div className="profile-essential-status">
                  {item.group ? <strong>{item.label}</strong> : null}
                  {item.notApplicable ? (
                    <span className={`badge ${status.tone}`}>{status.label}</span>
                  ) : null}
                  {item.hint ? <span className="muted">{item.hint}</span> : null}
                </div>
              ) : null}
              {item.field ? (
                <SingleField
                  applicantId={applicantId}
                  field={item.field}
                  applies={!item.notApplicable}
                  values={values}
                  assurance={assurance}
                />
              ) : item.group ? (
                <RepeatingGroup
                  applicantId={applicantId}
                  group={item.group}
                  repeatingValues={repeatingValues}
                  assurance={assurance}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Show All Sections (or back), with the full count while every section shows. */
function EssentialsToggle({
  view,
  showAll,
  onToggle,
}: {
  readonly view: MasterProfileView;
  readonly showAll: boolean;
  readonly onToggle: () => void;
}) {
  const t = useT(appApplicantCatalog);
  return (
    <div className="profile-essentials-bar">
      {view.essentials.done ? (
        <p className="muted">
          {t.node('appApplicant.appApplicantIdProfileEditor.everyEssentialIsAddedAddMore')}
        </p>
      ) : null}
      {showAll ? (
        <p className="muted">
          {t.node('appApplicant.appApplicantIdProfileEditor.fullProfileAnsweredOfTotalDetails', {
            answered: view.answered,
            total: view.total,
            plural: plural(view.openSections, 'open section'),
            percent: view.percent,
          })}
        </p>
      ) : null}
      <div className="profile-essentials-actions">
        <button type="button" className="btn btn-secondary" onClick={onToggle}>
          {showAll
            ? t.node('appApplicant.appApplicantIdProfileEditor.showEssentialsOnly')
            : t.node('appApplicant.appApplicantIdProfileEditor.showAllSections')}
        </button>
        {showAll ? null : (
          <span className="muted">
            {t.node('appApplicant.appApplicantIdProfileEditor.everySectionWithEveryDetailYou')}
          </span>
        )}
      </div>
    </div>
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
  /** Open on every section (a link that asks for it, or details that disagree). */
  readonly startWithAll?: boolean;
  /** LC-G1: entry key to the date it ended (ISO), for the entries the person said have ended. */
  readonly endedRecords?: Readonly<Record<string, string>>;
}

/**
 * Opens the first visible detail still to add and focuses its box; when every one is added, opens
 * the first detail and focuses its Edit. False when no detail is shown.
 */
function openFirstSection(root: HTMLElement | null): boolean {
  const rows = [
    ...(root?.querySelectorAll<HTMLDetailsElement>(
      '[id^="profile-panel-"]:not([hidden]) .profile-value-row > .expandable-section-details',
    ) ?? []),
  ];
  const box = 'input[name="value"], select[name="value"]';
  const details = rows.find((row) => row.querySelector(box)) ?? rows[0];
  if (!details) return false;
  let parent: HTMLElement | null = details;
  while (parent && parent !== root) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  (
    details.querySelector<HTMLElement>(box) ??
    details.querySelector<HTMLElement>('button[data-edit]')
  )?.focus();
  return true;
}

export function ProfileEditor({
  applicantId,
  values,
  repeatingValues,
  assurance,
  view,
  startWithAll = false,
  endedRecords,
}: ProfileEditorProps) {
  const t = useT(appApplicantCatalog);
  const locale = useLocale();
  const editor = useRef<HTMLDivElement>(null);
  // Essentials First leads until every essential is added; a profile with no essentials list
  // (nothing to show) opens on all sections. A link to one section always opens all sections.
  const hasEssentials = view.essentials.total > 0;
  const [showAll, setShowAll] = useState(
    !hasEssentials || view.essentials.done || view.suggestedFamily !== null || startWithAll,
  );
  // ESS1: protected values opened with Show or Edit, by saved version, in memory only.
  const [opened, setOpened] = useState<ReadonlyMap<string, string>>(() => new Map());
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const reveal = useCallback(
    async (factId: string, updatedAt: string | null | undefined): Promise<RevealResult> => {
      const key = revealKey(factId, updatedAt);
      const known = openedRef.current.get(key);
      if (known !== undefined) return { ok: true, value: known };
      try {
        const result = await revealProfileValueAction(applicantId, factId);
        if (!result.ok) return { ok: false };
        setOpened((current) => new Map(current).set(key, result.value));
        return { ok: true, value: result.value };
      } catch {
        return { ok: false };
      }
    },
    [applicantId],
  );
  const reveals = useMemo<Reveals>(
    () => ({ valueOf: (factId, updatedAt) => opened.get(revealKey(factId, updatedAt)), reveal }),
    [opened, reveal],
  );
  // "Add Information" while only the essentials show and all of them are added: open every
  // section, then go to the first one.
  const openAfterShowingAll = useRef(false);
  // Read through a ref, so the listeners added once always use this render's view.
  const openEditorRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const hash = () => {
      if (window.location.hash === '#profile-editor') openEditorRef.current();
    };
    const click = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href="#profile-editor"]'))
        openEditorRef.current();
    };
    window.addEventListener('hashchange', hash);
    document.addEventListener('click', click);
    hash();
    return () => {
      window.removeEventListener('hashchange', hash);
      document.removeEventListener('click', click);
    };
  }, []);
  useEffect(() => {
    if (!showAll || !openAfterShowingAll.current) return;
    openAfterShowingAll.current = false;
    openFirstSection(editor.current);
  }, [showAll]);
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
  // WP-V3 part 3: a link to #section-<key> (from the then-and-now view) opens the area that
  // holds that section and brings the section into view.
  const [sectionTarget, setSectionTarget] = useState<string | null>(null);
  // The latest areas, read when the address changes. Kept in a ref so a re-render after a save
  // (a new view) never follows the link again, which would move the person and clear their search.
  const layersRef = useRef(view.layers);
  layersRef.current = view.layers;
  useEffect(() => {
    const follow = () => {
      const match = window.location.hash.match(/^#section-([a-z0-9_]+)$/);
      const key = match?.[1];
      if (!key) return;
      const layer = layersRef.current.find((l) =>
        l.sections.some((section) => section.key === key),
      );
      if (!layer) return;
      setShowAll(true);
      setSelected(layer.key);
      setSearch('');
      setSectionTarget(key);
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  useEffect(() => {
    if (!sectionTarget) return;
    document.getElementById(`section-${sectionTarget}`)?.scrollIntoView?.({ block: 'start' });
    setSectionTarget(null);
  }, [sectionTarget]);
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
  const ended = useMemo(() => new Map(Object.entries(endedRecords ?? {})), [endedRecords]);
  // WAL4: the Passport Page Card. Its lines come from the profile; a tap opens that detail's row.
  const places = useMemo(() => passportPlaces(view), [view]);
  const passportLines = useMemo((): readonly PassportLine[] => {
    if (searching) return [];
    return PASSPORT_PAGE_KEYS.map((key) => {
      const place = places.get(key);
      const field = place?.field ?? fallbackField(key);
      const current = values[key];
      return {
        key,
        label: place?.field.label ?? PASSPORT_PAGE_LABELS[key],
        state: detailState(
          field,
          current,
          !place?.notApplicable,
          field.otherDetail ? values[field.otherDetail.key]?.value : null,
          t.node('appApplicant.appApplicantIdProfileEditor.doesNotApply'),
          (otherText) =>
            t('appApplicant.appApplicantIdProfileEditor.otherOthertext', { otherText }),
          locale,
          current ? opened.get(revealKey(current.factId, current.updatedAt)) : undefined,
        ),
        status: statusKindOf(current),
        // Every detail on the card is edited in its own row (ESS1: Essentials First no longer
        // repeats the card's details), so without script the link opens every section on it.
        href: !place ? null : showAll ? `#${valueRowId(key)}` : `?view=all#${valueRowId(key)}`,
      };
    });
  }, [searching, places, values, showAll, t, locale, opened]);
  const revealCardLine = useCallback(
    async (key: string): Promise<boolean> => {
      const current = values[key];
      if (!current?.withheld) return false;
      return (await reveal(current.factId, current.updatedAt)).ok;
    },
    [values, reveal],
  );
  // ESS1: Essentials First lists only the essentials the card does not show, still to add. One
  // added here stays listed until the page is next opened (the saved message and focus stay put).
  const cardKeys = useMemo(
    () => (searching ? new Set<string>() : new Set(places.keys())),
    [searching, places],
  );
  const firstPending = useRef<ReadonlySet<string> | null>(null);
  const offCard = view.essentials.items.filter(
    (item) => !(item.field && cardKeys.has(item.field.key)),
  );
  if (firstPending.current === null) {
    firstPending.current = new Set(offCard.filter((item) => !item.answered).map((i) => i.key));
  }
  const keptPending = firstPending.current;
  const essentialsToList = offCard.filter((item) => !item.answered || keptPending.has(item.key));
  const [rowTarget, setRowTarget] = useState<string | null>(null);
  function editPassportDetail(key: string) {
    const place = places.get(key);
    if (!place) return;
    setShowAll(true);
    setSelected(place.layerKey);
    setSearch('');
    setRowTarget(key);
  }
  useEffect(() => {
    if (!rowTarget) return;
    setRowTarget(null);
    const row = document.getElementById(valueRowId(rowTarget));
    const details = row?.querySelector<HTMLDetailsElement>(':scope > details');
    if (!row || !details) return;
    details.open = true;
    row.scrollIntoView?.({ block: 'start' });
    // A saved value opens in its box through its own Edit (which also opens a protected one).
    const edit = details.querySelector<HTMLButtonElement>(`button[data-edit="${rowTarget}"]`);
    if (edit) {
      edit.click();
      return;
    }
    // The value box first; a detail that does not apply has only its switch back.
    const target =
      details.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([type="checkbox"]), select, textarea',
      ) ??
      details.querySelector<HTMLElement>('input[type="checkbox"], button') ??
      details.querySelector<HTMLElement>(':scope > summary');
    target?.focus();
  }, [rowTarget]);
  openEditorRef.current = () => {
    // "Add Information" goes to the first essential still to add, in the list's order: its own
    // row for one the card shows, or its box in Essentials First.
    const next = view.essentials.items.find((item) => !item.answered);
    if (next?.field && places.has(next.field.key) && !searching) {
      editPassportDetail(next.field.key);
      return;
    }
    const listed = next
      ? editor.current?.querySelector<HTMLElement>(`[data-essential="${next.key}"]`)
      : null;
    const essential = listed?.querySelector<HTMLElement>(
      [
        'input:not([type="hidden"]):not([type="checkbox"])',
        'select',
        'button:not([data-edit])',
      ].join(', '),
    );
    if (essential) {
      essential.focus();
      return;
    }
    if (!openFirstSection(editor.current)) {
      openAfterShowingAll.current = true;
      setShowAll(true);
    }
  };
  return (
    <EndedRecordsContext.Provider value={ended}>
      <RevealContext.Provider value={reveals}>
        <div ref={editor} id="profile-editor" tabIndex={-1}>
          {searching ? null : (
            <PassportPageCard
              lines={passportLines}
              onEdit={editPassportDetail}
              onReveal={revealCardLine}
            />
          )}
          {hasEssentials && !showAll && essentialsToList.length > 0 ? (
            <EssentialsFirst
              applicantId={applicantId}
              items={essentialsToList}
              values={values}
              repeatingValues={repeatingValues}
              assurance={assurance}
            />
          ) : null}
          {hasEssentials ? (
            <EssentialsToggle
              view={view}
              showAll={showAll}
              onToggle={() => setShowAll((shown) => !shown)}
            />
          ) : null}
          {showAll ? (
            <>
              <SuggestionBar applicantId={applicantId} view={view} />
              <div className="profile-areas">
                <div className="profile-area-nav">
                  <div
                    className="profile-area-rail"
                    role={searching ? undefined : 'tablist'}
                    aria-orientation={searching ? undefined : 'vertical'}
                    aria-label={t('appApplicant.appApplicantIdProfileEditor.profileAreas')}
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
                      <span className="profile-area-picker-label">
                        {t.node('appApplicant.appApplicantIdProfileEditor.area')}
                      </span>
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
                  <Link
                    href={`/app/applicant/${applicantId}/history`}
                    className="profile-history-link"
                  >
                    {t.node('appApplicant.appApplicantIdProfileEditor.history')}
                  </Link>
                  <div className="profile-field-search">
                    <label className="field-label" htmlFor="profile-search">
                      {t.node('appApplicant.appApplicantIdProfileEditor.searchAllProfileFields')}
                    </label>
                    <input
                      id="profile-search"
                      type="search"
                      className="input"
                      placeholder={t(
                        'appApplicant.appApplicantIdProfileEditor.eGPassportAddressEmployer',
                      )}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  {searching && visibleLayers.length === 0 ? (
                    <output className="muted">
                      {t.node(
                        'appApplicant.appApplicantIdProfileEditor.noFieldsMatchTryAnotherField',
                      )}
                    </output>
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
                          {t.node(
                            'appApplicant.appApplicantIdProfileEditor.descriptionOpencountOfLengthSectionsOpen',
                            {
                              description: layer.description,
                              openCount: layer.openCount,
                              length: layer.sections.length,
                            },
                          )}
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
            </>
          ) : null}
        </div>
      </RevealContext.Provider>
    </EndedRecordsContext.Provider>
  );
}
