import type { FactStatus } from '@visastack/core';
import {
  CATALOGUE_MODULES,
  MODULE_FIELDS,
  ORIGINAL_DOCUMENT_KEYS,
  computeCompletion,
  documentsSupportingFields,
  resolveDocumentType,
} from '@visastack/core/catalogue';
import { isRestrictedDocumentType } from './access/require-access';
import { isTrustedFactStatus } from './ai';
import { type ExpiryUrgency, classifyExpiry } from './expiry';
import type { OverallReadinessState, RequirementResultState } from './missions';
import type { DocumentLifecycleStatus } from './wallet';

/**
 * Traveller insights (AI data plan Phase 2, deterministic first slice).
 *
 * One pure function turns what is already stored about one traveller (documents, saved profile
 * details, readings still waiting for a decision, case readiness) into summaries: which documents
 * back which details, where a reading and a saved detail differ, which profile sections have a
 * supporting document, what expires when, which originals a case will need, and how ready each
 * case is. Nothing is stored and no outside service is called.
 *
 * Privacy rule: the result never carries a saved value or a value read from a document. Values
 * come in only so two of them can be compared; what goes out is document kinds, field keys,
 * section names, counts, readiness states, case titles and, for the expiry timeline only, the
 * document's own expiry date (which the Expiry page already shows). A document is named by its
 * catalogue kind, never by its file name, which could carry a person's name. A restricted document
 * (identity, civil status, medical, financial, or a kind not known yet) is summarised by kind and
 * section only: neither the evidence map nor a mismatch names the details it holds (owner decision
 * 2026-10-25). A replaced document is left out everywhere, and is not counted when numbering.
 */

/** One document, reduced to what insights need. */
export interface InsightDocumentInput {
  readonly id: string;
  readonly docType: string | null;
  /** The document's own expiry, as an ISO timestamp, or null when none is recorded. */
  readonly expiresAt: string | null;
  readonly lifecycle: DocumentLifecycleStatus;
  readonly safetyStatus: string | null;
  /** Used only to number documents of the same kind in a stable order. */
  readonly createdAt: string;
  /** Reminder ladder for this kind (expiry.ts `getReminderThresholds`). */
  readonly reminderThresholds: readonly number[];
}

/** One saved profile entry. `value` is used only for comparison and never copied into the result. */
export interface InsightFactInput {
  readonly fieldKey: string;
  readonly repeatingRecordKey: string | null;
  readonly status: FactStatus | null;
  readonly isProtected: boolean;
  readonly value: string | null;
  /** False when a protected value could not be read, so it cannot be compared. */
  readonly comparable: boolean;
  /** The document the current value was read from, when it came from one. */
  readonly sourceDocumentId: string | null;
}

/** A reading from a document still waiting for the person's decision. */
export interface InsightReadingInput {
  readonly documentId: string;
  readonly fieldKey: string;
  readonly value: string | null;
}

export interface InsightCaseInput {
  readonly id: string;
  readonly title: string;
  /** Whether a checklist (a visa route's pack) is attached to the case. */
  readonly hasChecklist: boolean;
  /**
   * The case readiness (missions.ts `computeReadiness`). Null when there is no checklist, or when
   * there is one but its readiness could not be worked out just now (`hasChecklist` tells which).
   */
  readonly readiness: {
    readonly overallState: OverallReadinessState;
    readonly requiredCount: number;
    readonly satisfiedRequired: number;
    readonly requirementResults: readonly {
      readonly kind: 'FIELD' | 'DOCUMENT';
      readonly key: string;
      readonly optional: boolean;
      readonly state: RequirementResultState;
    }[];
  } | null;
}

export interface InsightsInput {
  readonly documents: readonly InsightDocumentInput[];
  readonly facts: readonly InsightFactInput[];
  readonly pendingReadings: readonly InsightReadingInput[];
  /** Documents with a pending "something here does not match" note from the document check. */
  readonly pendingCheckDocumentIds: readonly string[];
  readonly sections: {
    readonly activated: ReadonlySet<string>;
    readonly notApplicable: ReadonlySet<string>;
    readonly noneDeclared: ReadonlySet<string>;
  };
  /** Active cases only (closed and cancelled ones are left out by the caller). */
  readonly cases: readonly InsightCaseInput[];
  readonly now: Date;
}

/** How a document is named in insights: its kind, and its place among documents of that kind. */
export interface InsightDocumentRef {
  readonly id: string;
  /** The catalogue key, or null when the kind is not known (never free text a person typed). */
  readonly kind: string | null;
  readonly restricted: boolean;
  /** 1-based position among documents of the same kind, oldest first. */
  readonly ordinal: number;
  readonly ofKind: number;
}

export interface InsightSection {
  readonly key: string;
  readonly label: string;
}

export interface EvidenceMapEntry {
  readonly document: InsightDocumentRef;
  /** Field keys whose saved value was read from this document. Empty for a restricted document. */
  readonly backedFieldKeys: readonly string[];
  readonly backedCount: number;
  /** Sections holding those saved details. */
  readonly backedSections: readonly InsightSection[];
  /** Open sections this kind of document can back, from the catalogue. */
  readonly canBackSections: readonly InsightSection[];
}

export interface MismatchEntry {
  /** An opaque, unique key for lists. It names nothing. */
  readonly key: string;
  readonly document: InsightDocumentRef | null;
  /** The detail that differs, or null when it came from a restricted document (section only). */
  readonly fieldKey: string | null;
  readonly section: InsightSection | null;
  /**
   * saved_conflict: a value read from a document was saved while a different confirmed value was
   * on file, and nobody has picked one yet. pending_reading: a reading waiting for a decision
   * differs from the confirmed value.
   */
  readonly source: 'saved_conflict' | 'pending_reading';
}

export interface CoverageKind {
  readonly kind: string;
  /** Usable copies on file: not expired, not replaced, not failed or held by the safety check. */
  readonly onFile: number;
  readonly original: boolean;
}

export interface CoverageEntry extends InsightSection {
  readonly covered: boolean;
  readonly kinds: readonly CoverageKind[];
}

export interface ExpiryEntry {
  readonly document: InsightDocumentRef;
  readonly expiresAt: string;
  readonly daysRemaining: number;
  readonly urgency: ExpiryUrgency;
}

export interface OriginalsItem {
  readonly kind: string;
  readonly optional: boolean;
  /**
   * The case's own verdict on this requirement, so this list never contradicts Readiness by Case:
   * SATISFIED is on file for this case. When the kind is asked for more than once, the state that
   * needs the most doing is shown.
   */
  readonly state: Exclude<RequirementResultState, 'NOT_APPLICABLE'>;
}

export interface OriginalsCase {
  readonly caseId: string;
  readonly title: string;
  /** True when the case has a checklist but its readiness could not be worked out just now. */
  readonly unavailable: boolean;
  readonly items: readonly OriginalsItem[];
}

export type CaseReadinessState = OverallReadinessState | 'NO_CHECKLIST' | 'UNAVAILABLE';

export interface CaseReadinessEntry {
  readonly caseId: string;
  readonly title: string;
  /** NO_CHECKLIST: no route chosen yet. UNAVAILABLE: a checklist exists but could not be read. */
  readonly state: CaseReadinessState;
  readonly requiredCount: number;
  readonly satisfiedRequired: number;
}

export interface TravellerInsights {
  readonly summary: {
    readonly documents: number;
    readonly mismatches: number;
    /** Rows on the Details to Check card: every mismatch, plus each document with check notes. */
    readonly toCheck: number;
    readonly expired: number;
    readonly expiringSoon: number;
    readonly sectionsWithoutDocument: number;
  };
  readonly evidence: readonly EvidenceMapEntry[];
  readonly mismatches: readonly MismatchEntry[];
  /** Documents the document check left notes on, with how many notes. */
  readonly checksToReview: readonly {
    readonly document: InsightDocumentRef;
    readonly count: number;
  }[];
  /** Readings not compared because the saved value is protected and could not be read. */
  readonly notCompared: number;
  readonly coverage: {
    readonly sections: readonly CoverageEntry[];
    readonly covered: number;
    readonly missing: number;
  };
  readonly expiry: readonly ExpiryEntry[];
  readonly originals: {
    readonly cases: readonly OriginalsCase[];
    /** Documents on file of a kind usually handed in as the original. */
    readonly onFile: readonly InsightDocumentRef[];
  };
  readonly cases: readonly CaseReadinessEntry[];
}

const MODULE_BY_FIELD: ReadonlyMap<string, string> = new Map(
  MODULE_FIELDS.map((field) => [field.key, field.module] as const),
);
const MODULE_LABEL: ReadonlyMap<string, string> = new Map(
  CATALOGUE_MODULES.map((module) => [module.key, module.label] as const),
);
const FIELDS_BY_MODULE: ReadonlyMap<string, readonly string[]> = (() => {
  const byModule = new Map<string, string[]>();
  for (const field of MODULE_FIELDS) {
    byModule.set(field.module, [...(byModule.get(field.module) ?? []), field.key]);
  }
  return byModule;
})();

/** Lower needs more doing; the same order the case page sorts its requirements in. */
const STATE_URGENCY: Readonly<Record<OriginalsItem['state'], number>> = {
  CRITICAL_GAP: 0,
  CONFLICTING: 1,
  EXPIRING_STALE: 2,
  UNVERIFIED: 3,
  ATTENTION: 4,
  SATISFIED: 5,
};

function sectionOf(fieldKey: string): InsightSection | null {
  const key = MODULE_BY_FIELD.get(fieldKey);
  const label = key ? MODULE_LABEL.get(key) : undefined;
  return key && label ? { key, label } : null;
}

/** The catalogue key for a stored kind, or null: free text never leaves as a "kind". */
function catalogueKind(docType: string | null): string | null {
  return docType ? (resolveDocumentType(docType)?.key ?? null) : null;
}

/** Usable for coverage: keep in step with the same rule in apps/web/.../applicant/[id]/profile/page.tsx. */
function isUsable(document: InsightDocumentInput): boolean {
  if (document.lifecycle === 'EXPIRED' || document.lifecycle === 'SUPERSEDED') return false;
  return (
    document.safetyStatus !== null &&
    document.safetyStatus !== 'QUARANTINED' &&
    document.safetyStatus !== 'FAILED'
  );
}

/** Sections in catalogue order, deduplicated. */
function orderedSections(keys: Iterable<string>): InsightSection[] {
  const wanted = new Set(keys);
  return CATALOGUE_MODULES.filter((module) => wanted.has(module.key)).map((module) => ({
    key: module.key,
    label: module.label,
  }));
}

/** Every saved, non-empty value of each field, as completion counts them (a protected value counts). */
function savedValues(facts: readonly InsightFactInput[]): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  for (const fact of facts) {
    const text =
      fact.isProtected || fact.value === null
        ? fact.status
          ? '[protected]'
          : ''
        : fact.value.trim();
    if (text === '') continue;
    const list = values[fact.fieldKey] ?? [];
    list.push(text);
    values[fact.fieldKey] = list;
  }
  return values;
}

export function buildTravellerInsights(input: InsightsInput): TravellerInsights {
  // Name every current document by kind, numbered oldest first within its kind. A replaced
  // document gets no name, so nothing below can show it or count it.
  const byAge = input.documents
    .filter((document) => document.lifecycle !== 'SUPERSEDED')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const kindTotals = new Map<string | null, number>();
  for (const document of byAge) {
    const kind = catalogueKind(document.docType);
    kindTotals.set(kind, (kindTotals.get(kind) ?? 0) + 1);
  }
  const seen = new Map<string | null, number>();
  const refs = new Map<string, InsightDocumentRef>();
  for (const document of byAge) {
    const kind = catalogueKind(document.docType);
    const ordinal = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, ordinal);
    refs.set(document.id, {
      id: document.id,
      kind,
      restricted: isRestrictedDocumentType(document.docType),
      ordinal,
      ofKind: kindTotals.get(kind) ?? 1,
    });
  }

  // Open sections, by the one completion rule used everywhere.
  const completion = computeCompletion({
    activated: input.sections.activated,
    values: savedValues(input.facts),
    notApplicable: input.sections.notApplicable,
    noneDeclared: input.sections.noneDeclared,
  });
  const openSections = completion.modules.filter((module) => module.open);
  const openKeys = new Set(openSections.map((module) => module.key));

  // Usable copies of each kind.
  const usableByKind = new Map<string, number>();
  for (const document of input.documents) {
    const kind = catalogueKind(document.docType);
    if (kind && isUsable(document)) usableByKind.set(kind, (usableByKind.get(kind) ?? 0) + 1);
  }

  // 1. Evidence map: saved details whose current value came from each document.
  const backedByDocument = new Map<string, Set<string>>();
  for (const fact of input.facts) {
    if (!fact.sourceDocumentId || !fact.status || !isTrustedFactStatus(fact.status)) continue;
    if (!refs.has(fact.sourceDocumentId)) continue;
    const set = backedByDocument.get(fact.sourceDocumentId) ?? new Set<string>();
    set.add(fact.fieldKey);
    backedByDocument.set(fact.sourceDocumentId, set);
  }
  const evidence: EvidenceMapEntry[] = byAge
    .map((document) => {
      const ref = refs.get(document.id) as InsightDocumentRef;
      const backed = [...(backedByDocument.get(document.id) ?? [])].sort();
      const supports = ref.kind ? (resolveDocumentType(ref.kind)?.supports ?? []) : [];
      const canBack = supports.flatMap((fieldKey) => {
        const module = MODULE_BY_FIELD.get(fieldKey);
        return module && openKeys.has(module) ? [module] : [];
      });
      return {
        document: ref,
        backedFieldKeys: ref.restricted ? [] : backed,
        backedCount: backed.length,
        backedSections: orderedSections(
          backed.flatMap((fieldKey) => {
            const module = MODULE_BY_FIELD.get(fieldKey);
            return module ? [module] : [];
          }),
        ),
        canBackSections: orderedSections(canBack),
      };
    })
    .sort((a, b) => b.backedCount - a.backedCount);

  // 2. Mismatches: only that two values differ, and where. Values never leave this function.
  // Every document given, replaced ones included: restriction is decided by the document's own kind.
  const sourceById = new Map(input.documents.map((document) => [document.id, document] as const));
  const mismatches: MismatchEntry[] = [];
  const mismatchKeys = new Set<string>();
  const addMismatch = (
    dedupeKey: string,
    document: InsightDocumentRef | null,
    restricted: boolean,
    fieldKey: string,
    source: MismatchEntry['source'],
  ): void => {
    if (mismatchKeys.has(dedupeKey)) return;
    mismatchKeys.add(dedupeKey);
    mismatches.push({
      key: `m${mismatches.length + 1}`,
      document,
      // A detail from a restricted (or unknown) document is named by section only.
      fieldKey: restricted ? null : fieldKey,
      section: sectionOf(fieldKey),
      source,
    });
  };
  for (const fact of input.facts) {
    if (fact.status !== 'CONFLICTED') continue;
    // A value from a replaced document is still a conflict on the profile; the document goes
    // unnamed, but its own kind still decides whether the detail may be named. A source that is
    // not among the traveller's documents (hidden from the wallet, or none recorded) counts as
    // restricted.
    const document = fact.sourceDocumentId ? (refs.get(fact.sourceDocumentId) ?? null) : null;
    const source = fact.sourceDocumentId ? sourceById.get(fact.sourceDocumentId) : undefined;
    addMismatch(
      `saved:${fact.fieldKey}:${fact.repeatingRecordKey ?? ''}`,
      document,
      source ? isRestrictedDocumentType(source.docType) : true,
      fact.fieldKey,
      'saved_conflict',
    );
  }
  // A reading is compared with a confirmed single detail only, as the review screen does: a
  // reading for one record among several (an address) is settled on that record.
  const confirmed = new Map<string, InsightFactInput>();
  for (const fact of input.facts) {
    if (fact.repeatingRecordKey !== null || !fact.status || !isTrustedFactStatus(fact.status))
      continue;
    if (fact.value === null) continue;
    confirmed.set(fact.fieldKey, fact);
  }
  let notCompared = 0;
  for (const reading of input.pendingReadings) {
    const document = refs.get(reading.documentId);
    const current = confirmed.get(reading.fieldKey);
    if (!document || !current) continue;
    if (!current.comparable) {
      notCompared += 1;
      continue;
    }
    if (current.value === (reading.value ?? '')) continue;
    addMismatch(
      `reading:${reading.documentId}:${reading.fieldKey}`,
      document,
      document.restricted,
      reading.fieldKey,
      'pending_reading',
    );
  }
  const checkCounts = new Map<string, number>();
  for (const documentId of input.pendingCheckDocumentIds) {
    if (!refs.has(documentId)) continue;
    checkCounts.set(documentId, (checkCounts.get(documentId) ?? 0) + 1);
  }
  const checksToReview = [...checkCounts.entries()].map(([documentId, count]) => ({
    document: refs.get(documentId) as InsightDocumentRef,
    count,
  }));

  // 3. Coverage: open sections the catalogue links to at least one kind of document.
  const coverageSections: CoverageEntry[] = [];
  for (const module of openSections) {
    const kinds = documentsSupportingFields(FIELDS_BY_MODULE.get(module.key) ?? []).map(
      (document) => ({
        kind: document.key,
        onFile: usableByKind.get(document.key) ?? 0,
        original: ORIGINAL_DOCUMENT_KEYS.has(document.key),
      }),
    );
    if (kinds.length === 0) continue;
    coverageSections.push({
      key: module.key,
      label: module.label,
      covered: kinds.some((kind) => kind.onFile > 0),
      kinds,
    });
  }
  const covered = coverageSections.filter((section) => section.covered).length;

  // 4. Expiry timeline: soonest first, already expired at the top. A replaced document is left out.
  const expiry: ExpiryEntry[] = [];
  for (const document of byAge) {
    if (!document.expiresAt) continue;
    const date = new Date(document.expiresAt);
    if (Number.isNaN(date.getTime())) continue;
    const classification = classifyExpiry(date, input.now, document.reminderThresholds);
    if (classification.daysRemaining === null) continue;
    // The wallet already counts it expired (its time has passed today): never "Expires today".
    const expired = classification.urgency === 'expired' || document.lifecycle === 'EXPIRED';
    // `|| 0` turns a rounded -0 into 0.
    const daysRemaining =
      (expired ? Math.min(classification.daysRemaining, 0) : classification.daysRemaining) || 0;
    expiry.push({
      document: refs.get(document.id) as InsightDocumentRef,
      expiresAt: date.toISOString(),
      daysRemaining,
      urgency: expired ? 'expired' : classification.urgency,
    });
  }
  expiry.sort(
    (a, b) => a.daysRemaining - b.daysRemaining || a.document.id.localeCompare(b.document.id),
  );

  // 5. Originals: each case's document requirements of a kind usually handed in as the original,
  // with the case's own verdict on each, so this never contradicts Readiness by Case.
  const originalCases: OriginalsCase[] = [];
  for (const entry of input.cases) {
    if (!entry.readiness) {
      if (entry.hasChecklist) {
        originalCases.push({ caseId: entry.id, title: entry.title, unavailable: true, items: [] });
      }
      continue;
    }
    const items = new Map<string, OriginalsItem>();
    for (const requirement of entry.readiness.requirementResults) {
      const state = requirement.state;
      if (requirement.kind !== 'DOCUMENT' || state === 'NOT_APPLICABLE') continue;
      const kind = catalogueKind(requirement.key);
      if (!kind || !ORIGINAL_DOCUMENT_KEYS.has(kind)) continue;
      const existing = items.get(kind);
      items.set(kind, {
        kind,
        // Required wins when the same kind is asked for twice.
        optional: existing ? existing.optional && requirement.optional : requirement.optional,
        state:
          existing && STATE_URGENCY[existing.state] <= STATE_URGENCY[state]
            ? existing.state
            : state,
      });
    }
    if (items.size > 0) {
      originalCases.push({
        caseId: entry.id,
        title: entry.title,
        unavailable: false,
        items: [...items.values()],
      });
    }
  }
  const originalsOnFile = byAge
    .filter((document) => {
      const kind = catalogueKind(document.docType);
      return kind !== null && ORIGINAL_DOCUMENT_KEYS.has(kind) && isUsable(document);
    })
    .map((document) => refs.get(document.id) as InsightDocumentRef);

  // 6. Readiness per case, exactly as the case page computes it.
  const cases: CaseReadinessEntry[] = input.cases.map((entry) => ({
    caseId: entry.id,
    title: entry.title,
    state: entry.readiness
      ? entry.readiness.overallState
      : entry.hasChecklist
        ? 'UNAVAILABLE'
        : 'NO_CHECKLIST',
    requiredCount: entry.readiness?.requiredCount ?? 0,
    satisfiedRequired: entry.readiness?.satisfiedRequired ?? 0,
  }));

  return {
    summary: {
      documents: input.documents.filter((document) => document.lifecycle !== 'SUPERSEDED').length,
      mismatches: mismatches.length,
      toCheck: mismatches.length + checksToReview.length,
      expired: expiry.filter((entry) => entry.urgency === 'expired').length,
      expiringSoon: expiry.filter((entry) => entry.urgency === 'reminder').length,
      sectionsWithoutDocument: coverageSections.length - covered,
    },
    evidence,
    mismatches,
    checksToReview,
    notCompared,
    coverage: {
      sections: coverageSections,
      covered,
      missing: coverageSections.length - covered,
    },
    expiry,
    originals: { cases: originalCases, onFile: originalsOnFile },
    cases,
  };
}
