import {
  type AuthorizedApplicant,
  type Db,
  type DocumentSummary,
  type VersionScanEvidence,
  evidenceSubmissionsPresent,
  getDocumentLifecycles,
  loadVersionScanEvidence,
} from '@visastack/services';

/** What the copy lists need beyond the documents themselves. */
export interface ChoiceBasis {
  /** False when the lifecycle of the documents could not be read: no copy is then offered. */
  readonly read: boolean;
  /** Documents (lower case ids) that are still the person's everyday copy. */
  readonly everyday: ReadonlySet<string>;
  /** How each candidate's latest file was checked, by version id. */
  readonly scan: ReadonlyMap<string, VersionScanEvidence>;
  /** The service keeps the exact copy that is sent (migration 0132 has run). */
  readonly exactCopies: boolean;
}

/**
 * The facts the copy pickers share, read once for the page: which documents are still the everyday
 * copy, how each one's latest file was checked (through the owner's own access proof), and whether
 * exact copies are kept at all. A failure to read says "not read", never "no copies".
 */
export async function choiceBasisFor(input: {
  readonly db: Db;
  readonly access: AuthorizedApplicant<'VIEW_METADATA'> | null;
  readonly documents: readonly DocumentSummary[];
  readonly docTypes: ReadonlySet<string>;
}): Promise<ChoiceBasis> {
  const exactCopies = await evidenceSubmissionsPresent(input.db).catch(() => false);
  const none: ChoiceBasis = {
    read: input.docTypes.size === 0,
    everyday: new Set(),
    scan: new Map(),
    exactCopies,
  };
  if (input.docTypes.size === 0 || !input.access) return none;
  try {
    const candidates = input.documents.filter(
      (doc) => doc.docType !== null && input.docTypes.has(doc.docType),
    );
    const lifecycles = await getDocumentLifecycles(
      input.db,
      candidates.map((doc) => doc.id),
      input.access,
    );
    const everyday = new Set<string>();
    for (const doc of candidates) {
      const lifecycle = lifecycles.get(doc.id.toLowerCase());
      if (lifecycle?.state === 'CURRENT' && !lifecycle.replaced) everyday.add(doc.id.toLowerCase());
    }
    const scan = await loadVersionScanEvidence(
      input.access,
      candidates.flatMap((doc) =>
        everyday.has(doc.id.toLowerCase()) && doc.latestVersionId && doc.safetyStatus
          ? [{ id: doc.latestVersionId, safetyStatus: doc.safetyStatus }]
          : [],
      ),
    );
    return { read: true, everyday, scan, exactCopies };
  } catch {
    return none;
  }
}
