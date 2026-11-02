import { createHash } from 'node:crypto';
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import { type CollectionItem, canonicalJson } from './umpe-collection-request-items';

/**
 * The plain rules of a traveller's answer to an agency document request (UMPE P7): which saved
 * documents and details match an issued item, how each is labelled, what the traveller agrees to,
 * and the canonical content a submitted response carries the SHA-256 of. Pure: no database, so the
 * rules are tested on their own.
 */

/** The wording the traveller agrees to when they submit. A new wording takes a new version. */
export const RESPONSE_CONSENT_VERSION = 'umpe-p7-consent-1';
export const RESPONSE_CONSENT_TEXT =
  'I agree to share only the files and details I chose above with this agency, exactly as they are now. Later changes to my record are not shared. I can withdraw this answer at any time.';

/** How a candidate copy reads next to its item. Plain words, Title Case. */
export type EvidenceLabel = 'Current Copy' | 'Replaced Copy' | 'Expired Copy' | 'Confirmed Detail';

export interface DocumentLike {
  readonly id: string;
  readonly docType: string | null;
  readonly title: string;
  readonly expiresAt: Date | null;
  readonly supersededByDocumentId: string | null;
}

/** The newest servable version of a document, the only one ever offered. */
export interface ServableVersionLike {
  readonly id: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly createdAt: Date;
}

export interface FactLike {
  readonly factId: string;
  readonly factVersionId: string;
  readonly fieldKey: string;
  readonly repeatingRecordKey: string | null;
  /** What the traveller sees for this value (their own record). */
  readonly display: string;
  readonly savedAt: Date;
}

export interface DocumentCandidate {
  readonly key: string;
  readonly kind: 'DOCUMENT';
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly title: string;
  readonly versionNumber: number;
  readonly savedAt: Date;
  readonly label: EvidenceLabel;
  /** Of the item's own type, so it is offered first. */
  readonly matches: boolean;
}

export interface FactCandidate {
  readonly key: string;
  readonly kind: 'FIELD';
  readonly factId: string;
  readonly factVersionId: string;
  readonly display: string;
  readonly savedAt: Date;
  readonly label: EvidenceLabel;
  readonly matches: true;
}

export type EvidenceCandidate = DocumentCandidate | FactCandidate;

export interface ItemProposal {
  readonly item: CollectionItem;
  /** Matching copies first, then every other document the traveller may choose instead. */
  readonly candidates: readonly EvidenceCandidate[];
  /** The one copy proposed for this item, or null when nothing in the record matches. */
  readonly proposedKey: string | null;
}

export function documentKey(documentVersionId: string): string {
  return `document:${documentVersionId}`;
}

export function factKey(factVersionId: string): string {
  return `detail:${factVersionId}`;
}

/** The catalogue key a document type name stands for, so aliases match ("Pay Slip", "payslip"). */
function canonicalType(name: string | null): string | null {
  if (!name) return null;
  return resolveDocumentType(name)?.key ?? name.trim().toLowerCase();
}

function documentLabel(document: DocumentLike, now: Date): EvidenceLabel {
  if (document.supersededByDocumentId) return 'Replaced Copy';
  if (document.expiresAt && document.expiresAt.getTime() <= now.getTime()) return 'Expired Copy';
  return 'Current Copy';
}

const LABEL_RANK: Readonly<Record<EvidenceLabel, number>> = {
  'Current Copy': 0,
  'Confirmed Detail': 0,
  'Expired Copy': 1,
  'Replaced Copy': 2,
};

/**
 * The candidates and the proposal for every issued item. A document item offers the newest
 * servable version of each document of the item's type first (current copies before expired or
 * replaced ones, newest first), then every other document the traveller has, so an agency's own
 * item with no type can still be answered. A detail item offers the person's saved values of that
 * field. Only a current copy or a confirmed detail is ever proposed; nothing is ever chosen for the
 * traveller beyond that one proposal, which they can untick.
 */
export function proposeEvidence(
  items: readonly CollectionItem[],
  documents: readonly DocumentLike[],
  versions: readonly ServableVersionLike[],
  facts: readonly FactLike[],
  now: Date,
): ItemProposal[] {
  const newest = new Map<string, ServableVersionLike>();
  for (const version of versions) {
    const seen = newest.get(version.documentId);
    if (!seen || version.versionNumber > seen.versionNumber)
      newest.set(version.documentId, version);
  }
  const offered = documents
    .map((document) => ({ document, version: newest.get(document.id) }))
    .filter(
      (entry): entry is { document: DocumentLike; version: ServableVersionLike } =>
        entry.version !== undefined,
    );

  return items.map((item) => {
    if (item.kind === 'FIELD') {
      const candidates: FactCandidate[] = facts
        .filter((fact) => item.fieldKey !== null && fact.fieldKey === item.fieldKey)
        .sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime() || cmp(a.factId, b.factId))
        .map((fact) => ({
          key: factKey(fact.factVersionId),
          kind: 'FIELD',
          factId: fact.factId,
          factVersionId: fact.factVersionId,
          display: fact.display,
          savedAt: fact.savedAt,
          label: 'Confirmed Detail',
          matches: true,
        }));
      return { item, candidates, proposedKey: candidates[0]?.key ?? null };
    }
    const wanted = canonicalType(item.docType);
    const candidates: DocumentCandidate[] = offered
      .map(({ document, version }) => ({
        key: documentKey(version.id),
        kind: 'DOCUMENT' as const,
        documentId: document.id,
        documentVersionId: version.id,
        title: document.title,
        versionNumber: version.versionNumber,
        savedAt: version.createdAt,
        label: documentLabel(document, now),
        matches: wanted !== null && canonicalType(document.docType) === wanted,
      }))
      .sort(
        (a, b) =>
          Number(b.matches) - Number(a.matches) ||
          LABEL_RANK[a.label] - LABEL_RANK[b.label] ||
          b.savedAt.getTime() - a.savedAt.getTime() ||
          cmp(a.documentVersionId, b.documentVersionId),
      );
    const proposed = candidates.find((c) => c.matches && c.label === 'Current Copy');
    return { item, candidates, proposedKey: proposed?.key ?? null };
  });
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One line of a submitted response. */
export type ResponseLine =
  | {
      readonly itemId: string;
      readonly kind: 'DOCUMENT';
      readonly documentId: string;
      readonly documentVersionId: string;
    }
  | {
      readonly itemId: string;
      readonly kind: 'FIELD';
      readonly factId: string;
      readonly factVersionId: string;
    }
  | { readonly itemId: string; readonly kind: 'MISSING' };

/** At most this many copies may answer one item. */
export const MAX_CHOICES_PER_ITEM = 10;

export type SelectionProblem = 'unknown_item' | 'not_offered' | 'too_many';

/**
 * The exact lines a set of choices makes, checked against the proposals worked out on the server
 * at submit time: every chosen key must be one of that item's own candidates (so nothing outside
 * the person's present, servable record can be named), at most `MAX_CHOICES_PER_ITEM` per item,
 * and every item with no choice becomes a Still Missing line. The order is fixed (issued order,
 * then key), so the same choices always make the same lines.
 */
export function linesFromSelections(
  proposals: readonly ItemProposal[],
  selections: Readonly<Record<string, readonly string[]>>,
): { ok: true; lines: ResponseLine[] } | { ok: false; problem: SelectionProblem } {
  const byId = new Map(proposals.map((proposal) => [proposal.item.id, proposal] as const));
  for (const itemId of Object.keys(selections)) {
    if (!byId.has(itemId)) return { ok: false, problem: 'unknown_item' };
  }
  const lines: ResponseLine[] = [];
  for (const proposal of proposals) {
    const chosen = [...new Set(selections[proposal.item.id] ?? [])].sort(cmp);
    if (chosen.length > MAX_CHOICES_PER_ITEM) return { ok: false, problem: 'too_many' };
    if (chosen.length === 0) {
      lines.push({ itemId: proposal.item.id, kind: 'MISSING' });
      continue;
    }
    const byKey = new Map(proposal.candidates.map((c) => [c.key, c] as const));
    for (const key of chosen) {
      const candidate = byKey.get(key);
      if (!candidate) return { ok: false, problem: 'not_offered' };
      lines.push(
        candidate.kind === 'DOCUMENT'
          ? {
              itemId: proposal.item.id,
              kind: 'DOCUMENT',
              documentId: candidate.documentId,
              documentVersionId: candidate.documentVersionId,
            }
          : {
              itemId: proposal.item.id,
              kind: 'FIELD',
              factId: candidate.factId,
              factVersionId: candidate.factVersionId,
            },
      );
    }
  }
  return { ok: true, lines };
}

export interface ResponseContent {
  readonly requestId: string;
  readonly revisionId: string;
  readonly applicantId: string;
  readonly consentVersion: string;
  readonly lines: readonly ResponseLine[];
}

/** The SHA-256 (hex) of a response's canonical content (never of stored jsonb or row order). */
export function responseContentSha256(content: ResponseContent): string {
  const lines = [...content.lines]
    .map((line) => canonicalJson(line))
    .sort(cmp)
    .map((text) => JSON.parse(text) as unknown);
  return createHash('sha256')
    .update(
      canonicalJson({
        format: 1,
        requestId: content.requestId,
        revisionId: content.revisionId,
        applicantId: content.applicantId,
        consentVersion: content.consentVersion,
        lines,
      }),
    )
    .digest('hex');
}
