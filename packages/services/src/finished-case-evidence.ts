import type { FactStatus } from '@visastack/core';
import type { DocumentInstance, FactInstance } from './missions';

/**
 * What a finished case used, read back from the copy saved while it was open: for each
 * requirement the answers and files the case considered, with the values and file details they
 * had then. Pure reading of a stored value; it reads no table, so it stays outside the
 * applicant-data access ratchet. Anything that is not the expected shape is left out rather than
 * guessed, so a screen shows less, never something invented.
 */

export interface StoredRequirementEvidence {
  readonly facts: readonly FactInstance[];
  readonly documents: readonly DocumentInstance[];
}

export interface StoredCaseEvidence {
  readonly byRequirement: ReadonlyMap<string, StoredRequirementEvidence>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readFact(raw: unknown): FactInstance | null {
  if (!isObject(raw)) return null;
  const { factId, factVersionId, repeatingRecordKey, value, status, evidenceLinkIds } = raw;
  if (typeof factId !== 'string' || typeof status !== 'string') return null;
  return {
    factId,
    factVersionId: text(factVersionId),
    repeatingRecordKey: text(repeatingRecordKey),
    value: text(value),
    status: status as FactStatus,
    evidenceLinkIds: Array.isArray(evidenceLinkIds)
      ? evidenceLinkIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

function readDocument(raw: unknown): DocumentInstance | null {
  if (!isObject(raw)) return null;
  const {
    documentId,
    documentVersionId,
    displayName,
    safetyStatus,
    processingStatus,
    docType,
    sha256,
    eligible,
    documentDate,
  } = raw;
  if (
    typeof documentId !== 'string' ||
    typeof documentVersionId !== 'string' ||
    typeof displayName !== 'string' ||
    typeof safetyStatus !== 'string' ||
    typeof processingStatus !== 'string'
  ) {
    return null;
  }
  return {
    documentId,
    documentVersionId,
    docType: text(docType),
    displayName,
    sha256: text(sha256),
    safetyStatus,
    processingStatus,
    eligible: eligible === true,
    // An older copy may not carry the date: then there is none to show, never a made-up one.
    documentDate: text(documentDate),
  };
}

/**
 * The stored mapping (which answers and files each requirement considered) joined to the stored
 * list of files (their type, safety, processing state and date). A file in the mapping that the
 * stored list does not describe is left out.
 */
export function readStoredCaseEvidence(
  requirementMapping: unknown,
  storedDocuments: unknown,
): StoredCaseEvidence | null {
  if (!Array.isArray(requirementMapping)) return null;
  const documentByVersion = new Map<string, DocumentInstance>();
  for (const raw of Array.isArray(storedDocuments) ? storedDocuments : []) {
    const doc = readDocument(raw);
    if (doc) documentByVersion.set(doc.documentVersionId, doc);
  }
  const byRequirement = new Map<string, StoredRequirementEvidence>();
  for (const entry of requirementMapping) {
    if (!isObject(entry)) continue;
    const { packRequirementId, facts: storedFacts, documents: mappedDocuments } = entry;
    if (typeof packRequirementId !== 'string') continue;
    const facts = (Array.isArray(storedFacts) ? storedFacts : [])
      .map(readFact)
      .filter((f): f is FactInstance => f !== null);
    const documents = (Array.isArray(mappedDocuments) ? mappedDocuments : []).flatMap((raw) => {
      if (!isObject(raw)) return [];
      const { documentVersionId } = raw;
      const doc =
        typeof documentVersionId === 'string'
          ? documentByVersion.get(documentVersionId)
          : undefined;
      return doc ? [doc] : [];
    });
    byRequirement.set(packRequirementId, { facts, documents });
  }
  return { byRequirement };
}
