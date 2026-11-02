/**
 * UMPE P4 (R15, R19, R23, S05): the pure rules of a trip package, with no database access.
 *
 * - The three plain readiness phrases are a reading of the existing case readiness (missions.ts),
 *   never a replacement for it: Needs Attention, Ready for Final Review, Prepared for Handoff.
 *   Prepared for Handoff only ever comes from an explicit traveller confirmation that still
 *   matches the case. None of them means submitted, received or approved.
 * - The steps outside VisaStack (official forms, appointments, originals, fees) are listed in plain
 *   words, from a fixed list plus the pack's own requirement notes.
 * - Continuous matching picks the one most important change for a case, so a person meets one
 *   precise next action rather than a pile of notices.
 */
import type { OverallReadinessState } from './missions';

export const PACKAGE_PHRASES = [
  'NEEDS_ATTENTION',
  'READY_FOR_FINAL_REVIEW',
  'PREPARED_FOR_HANDOFF',
] as const;
export type PackagePhrase = (typeof PACKAGE_PHRASES)[number];

/** The words a person sees for each phrase (Title Case, plain, never "submitted" or "approved"). */
export const PACKAGE_PHRASE_LABELS: Readonly<Record<PackagePhrase, string>> = {
  NEEDS_ATTENTION: 'Needs Attention',
  READY_FOR_FINAL_REVIEW: 'Ready for Final Review',
  PREPARED_FOR_HANDOFF: 'Prepared for Handoff',
};

/** Why a case reads Needs Attention. Codes, so the page words them and tests can pin them. */
export type AttentionReason =
  | 'NO_CHECKLIST'
  | 'MANUAL_CHECK'
  | 'REQUIRED_GAP'
  | 'NEEDS_ANSWER'
  | 'PINNED_COPY_UNUSABLE'
  | 'CHECKLIST_WITHDRAWN'
  | 'CHECKLIST_REPLACED'
  | 'SOMETHING_CHANGED';

export interface PhraseInput {
  /** Null when the case has no checklist yet. */
  readonly overallState: OverallReadinessState | null;
  /** A blocking requirement's chosen copy can no longer be used (unsafe, removed or expired). */
  readonly pinnedCopyUnusable: boolean;
  /** The pack version is withdrawn, or a newer one replaced it (freshness check). */
  readonly packWithdrawn: boolean;
  readonly packReplaced: boolean;
  /** An open "something changed" item the person has not reviewed yet. */
  readonly openChange: boolean;
  /** The latest handoff confirmation still matches the case exactly. */
  readonly handoffCurrent: boolean;
}

export interface PhraseResult {
  readonly phrase: PackagePhrase;
  readonly reasons: readonly AttentionReason[];
}

/**
 * The plain phrase for a case. Prepared for Handoff only while the traveller's own confirmation
 * still matches the case; Ready for Final Review only when the existing readiness says every
 * required item is covered and nothing material is open. Everything else is Needs Attention,
 * with its reasons: an unknown condition (Unverified) is never read as ready, and a recommended
 * or optional gap never holds a case back (readiness already leaves those out).
 */
export function derivePackagePhrase(input: PhraseInput): PhraseResult {
  const reasons: AttentionReason[] = [];
  if (input.overallState === null) reasons.push('NO_CHECKLIST');
  else if (input.overallState === 'MANUAL_ONLY') reasons.push('MANUAL_CHECK');
  else if (input.overallState === 'NEEDS_ACTION') reasons.push('REQUIRED_GAP');
  else if (input.overallState === 'NEEDS_REVIEW') reasons.push('NEEDS_ANSWER');
  if (input.pinnedCopyUnusable) reasons.push('PINNED_COPY_UNUSABLE');
  if (input.packWithdrawn) reasons.push('CHECKLIST_WITHDRAWN');
  else if (input.packReplaced) reasons.push('CHECKLIST_REPLACED');
  if (input.openChange) reasons.push('SOMETHING_CHANGED');
  if (input.handoffCurrent && !input.packWithdrawn) {
    return { phrase: 'PREPARED_FOR_HANDOFF', reasons };
  }
  return reasons.length === 0
    ? { phrase: 'READY_FOR_FINAL_REVIEW', reasons }
    : { phrase: 'NEEDS_ATTENTION', reasons };
}

// --- Steps outside VisaStack (R23) ------------------------------------------------------------

export type OutsideStepKind =
  | 'APPLICATION_FORM'
  | 'APPOINTMENT'
  | 'ORIGINALS'
  | 'FEE'
  | 'TRANSLATION'
  | 'BIOMETRICS';

/** Plain words for each step; every case shows the first four, the pack's notes can add more. */
export const OUTSIDE_STEP_LABELS: Readonly<Record<OutsideStepKind, string>> = {
  APPLICATION_FORM: 'Fill in and send the official application form yourself.',
  APPOINTMENT: 'Book any appointment the embassy or visa centre asks for.',
  ORIGINALS: 'Bring the original documents if you are asked to show them.',
  FEE: 'Pay the official fee where the authority says.',
  TRANSLATION: 'Get any translation the authority asks for.',
  BIOMETRICS: 'Give fingerprints or a photo in person if asked.',
};

const ALWAYS_SHOWN: readonly OutsideStepKind[] = [
  'APPLICATION_FORM',
  'APPOINTMENT',
  'ORIGINALS',
  'FEE',
];

const NOTE_SIGNALS: readonly { readonly kind: OutsideStepKind; readonly pattern: RegExp }[] = [
  { kind: 'APPLICATION_FORM', pattern: /\b(application form|online form|portal)\b/i },
  { kind: 'APPOINTMENT', pattern: /\b(appointment|interview|visa centre|visa center)\b/i },
  { kind: 'ORIGINALS', pattern: /\b(original|in person|hard copy|notari[sz]ed)\b/i },
  { kind: 'FEE', pattern: /\b(fee|payment)\b/i },
  { kind: 'TRANSLATION', pattern: /\b(translat\w*)\b/i },
  { kind: 'BIOMETRICS', pattern: /\b(biometric\w*|fingerprint\w*)\b/i },
];

export interface OutsideStep {
  readonly kind: OutsideStepKind;
  readonly label: string;
  /** True when one of this route's own requirement notes names it, not only the standard list. */
  readonly namedByChecklist: boolean;
}

/**
 * The short "Outside VisaStack" list for a route: the standard steps every application has, and
 * any further step a requirement's note names. The notes are read only for these signals; their
 * text is never shown here, so nothing unreviewed is presented as a rule.
 */
export function outsideSteps(notes: readonly (string | null)[]): OutsideStep[] {
  const named = new Set<OutsideStepKind>();
  for (const note of notes) {
    if (!note) continue;
    for (const signal of NOTE_SIGNALS) if (signal.pattern.test(note)) named.add(signal.kind);
  }
  const kinds: OutsideStepKind[] = [...ALWAYS_SHOWN];
  for (const kind of ['TRANSLATION', 'BIOMETRICS'] as const) if (named.has(kind)) kinds.push(kind);
  return kinds.map((kind) => ({
    kind,
    label: OUTSIDE_STEP_LABELS[kind],
    namedByChecklist: named.has(kind),
  }));
}

// --- Continuous matching (R19) ----------------------------------------------------------------

export const PACKAGE_CHANGE_KINDS = [
  'PACK_WITHDRAWN',
  'PACK_CHANGED',
  'EVIDENCE_EXPIRED',
  'FACT_CHANGED',
  'NEWER_DOCUMENT',
] as const;
export type PackageChangeKind = (typeof PACKAGE_CHANGE_KINDS)[number];

/** One observed change, by ids and kinds only. */
export interface PackageChangeSignal {
  readonly kind: PackageChangeKind;
  /** The requirement it concerns, when it concerns one. */
  readonly packRequirementId: string | null;
  /** The record that changed (a document, a fact or a pack version), by id. */
  readonly subjectId: string;
}

export interface PackageChange {
  readonly kind: PackageChangeKind;
  /** Stable across repeated checks of the same situation, so one change is recorded once. */
  readonly signature: string;
  readonly signals: readonly PackageChangeSignal[];
}

/**
 * The single change to tell the person about, most important first (a withdrawn checklist before
 * a newer statement), carrying every signal of that kind so the one next action covers them all.
 * Null when nothing material changed.
 */
export function pickPackageChange(signals: readonly PackageChangeSignal[]): PackageChange | null {
  for (const kind of PACKAGE_CHANGE_KINDS) {
    const ofKind = signals
      .filter((s) => s.kind === kind)
      .sort((a, b) =>
        `${a.packRequirementId ?? ''}:${a.subjectId}` <
        `${b.packRequirementId ?? ''}:${b.subjectId}`
          ? -1
          : 1,
      );
    if (ofKind.length === 0) continue;
    const signature = `${kind}|${ofKind
      .map((s) => `${s.packRequirementId ?? '-'}:${s.subjectId}`)
      .join(',')}`.slice(0, 512);
    return { kind, signature, signals: ofKind };
  }
  return null;
}

/** The one precise next action for each kind of change, in plain words. */
export const PACKAGE_CHANGE_LABELS: Readonly<Record<PackageChangeKind, string>> = {
  PACK_WITHDRAWN:
    'The checklist for this trip was withdrawn. Check what is needed before you share anything.',
  PACK_CHANGED:
    'A newer checklist was published for this trip. Review it before you share anything.',
  EVIDENCE_EXPIRED:
    'A document chosen for this trip has expired or is now too old. Choose a newer copy.',
  FACT_CHANGED: 'A saved answer used for this trip changed. Review it before you share anything.',
  NEWER_DOCUMENT:
    'A newer copy of a document is available for this trip. Review it before you share anything.',
};
