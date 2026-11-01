import { type DocumentLifecycle, documentLifecycleLabel } from '@visastack/services';

/** The parts of one evidence candidate entry this needs (`getEvidenceCandidates`). */
interface EvidenceEntry {
  readonly packRequirementId: string;
  readonly documentCandidates: ReadonlyArray<{ readonly documentId: string }>;
  readonly selectedDocumentIds: readonly string[];
}

export interface EvidenceLifecycleLabels {
  /**
   * "Archived", "Replaced" or "Removed by the traveller on 3 Nov", by document id. A replaced
   * document reads plain "Replaced": its replacement time is not on the lifecycle read.
   */
  readonly byDocument: Readonly<Record<string, string>>;
  /** The labels of the documents a case chose for each requirement, by requirement id. */
  readonly chosenByRequirement: Readonly<Record<string, readonly string[]>>;
}

/** Every document id a case's evidence list names: each candidate and each chosen document. */
export function evidenceDocumentIds(entries: readonly EvidenceEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap((e) => [
        ...e.documentCandidates.map((d) => d.documentId),
        ...e.selectedDocumentIds,
      ]),
    ),
  ];
}

/**
 * The resource lifecycle labels a case shows on its evidence (PROGRAMME 5.3, lane Z): a document
 * the case chose that is archived, replaced or removed says so where it was chosen (D6). A
 * current document has no label. A removed document is never named: the label carries no title.
 */
export function evidenceLifecycleLabels(
  entries: readonly EvidenceEntry[],
  lifecycles: ReadonlyMap<string, DocumentLifecycle>,
  now: Date,
): EvidenceLifecycleLabels {
  const byDocument: Record<string, string> = {};
  for (const id of evidenceDocumentIds(entries)) {
    const lifecycle = lifecycles.get(id.toLowerCase());
    const label = lifecycle ? documentLifecycleLabel(lifecycle, now) : null;
    if (label) byDocument[id] = label;
  }
  const chosenByRequirement: Record<string, readonly string[]> = {};
  for (const entry of entries) {
    const labels = entry.selectedDocumentIds.flatMap((id) => {
      const label = byDocument[id];
      return label ? [label] : [];
    });
    if (labels.length > 0) chosenByRequirement[entry.packRequirementId] = labels;
  }
  return { byDocument, chosenByRequirement };
}
