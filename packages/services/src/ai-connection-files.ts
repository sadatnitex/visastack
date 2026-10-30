import { type Result, err, ok } from '@visastack/core';
import { CATALOGUE_DOCUMENT_GROUPS, type DocumentGroupKey } from '@visastack/core/catalogue';
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { AuthorizedApplicant, DEFAULT_DOCUMENT_PROTECTION } from './access/require-access';
import {
  documentTypeRestricted,
  loadDocumentProtectionSettings,
} from './access/restricted-documents';
import {
  AI_FILE_CHOICES_MAX,
  AI_FILE_DEFAULT_VARIANT,
  type AiFileChoice,
  type AiFileVariant,
  isAiFileVariant,
} from './ai-connection-scopes';
import { aiFilesAvailable } from './ai-files-ready';
import { type Db, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { type ServiceError, serviceError } from './errors';
import { isSafeCopyReady, listRedactionStates } from './redaction';
import { referenceCodesFor } from './reference-codes';

/**
 * "Original Files" for AI connections (S20, ADR 0021 amendment): which documents a person may
 * tick for an AI app, and the ones already ticked.
 *
 * - Only the record's owner, through the access gate, and only that record's own documents.
 * - Never a document type the document protection switches restrict (passports, identity, money,
 *   health, and any type not known yet): those are left out of the list, refused when stored, and
 *   refused again by the AI gate on every call, as admins change the switches.
 * - Never a replaced document, a document handed over for one case only, or one whose latest
 *   version is not yet safe to use.
 * - Before migration 0106 runs, nothing is listed and nothing can be ticked.
 */

export { aiFilesAvailable } from './ai-files-ready';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The ticked documents as submitted, cleaned: lower-case ids only, each once (the first choice
 * wins), a Safe Copy unless the Original was chosen, and at most `AI_FILE_CHOICES_MAX`.
 */
export function normaliseAiFileChoices(
  files: readonly AiFileChoice[] | undefined,
): readonly { readonly documentId: string; readonly variant: AiFileVariant }[] {
  const seen = new Map<string, AiFileVariant>();
  for (const file of files ?? []) {
    const id = typeof file.documentId === 'string' ? file.documentId.toLowerCase() : '';
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.set(id, isAiFileVariant(file.variant) ? file.variant : AI_FILE_DEFAULT_VARIANT);
    if (seen.size >= AI_FILE_CHOICES_MAX) break;
  }
  return [...seen].map(([documentId, variant]) => ({ documentId, variant }));
}

/** One document a person may tick, as the consent screen and Change Access list it. */
export interface AiFileCandidate {
  readonly documentId: string;
  /** `D-XXXXXX`, or null before the document has one. */
  readonly referenceCode: string | null;
  /** The document's kind in plain words ("Visa"). */
  readonly kind: string;
  readonly groupKey: DocumentGroupKey;
  /** The group heading ("Travel and Immigration"). */
  readonly group: string;
  /** Whether a Safe Copy of its latest version is ready now (prepared on the document's page). */
  readonly safeCopyReady: boolean;
}

export interface AiFileCandidates {
  /** False until migration 0106 has run: the screen then offers nothing to tick. */
  readonly available: boolean;
  readonly documents: readonly AiFileCandidate[];
}

/** A record has a few dozen documents; the list is bounded all the same. */
const MAX_CANDIDATES = 200;

const GROUP_LABELS: ReadonlyMap<DocumentGroupKey, string> = new Map(
  CATALOGUE_DOCUMENT_GROUPS.map((group) => [group.key, group.label] as const),
);
const GROUP_ORDER: ReadonlyMap<DocumentGroupKey, number> = new Map(
  CATALOGUE_DOCUMENT_GROUPS.map((group, index) => [group.key, index] as const),
);

function ownerProof(proof: AuthorizedApplicant<'VIEW_METADATA'>): boolean {
  return (
    AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') &&
    proof.actor.kind === 'applicant_owner' &&
    proof.resource.kind === 'applicant'
  );
}

interface EligibleDocument {
  readonly documentId: string;
  readonly docType: string | null;
  readonly versionId: string;
}

/**
 * The record's documents an AI app could be given: current (not replaced), kept in the person's
 * own documents (not handed over for one case only), latest version safe to use or still being
 * checked (never failed or rejected), and not of a type the document protection switches restrict
 * right now. `only` narrows to those ids. A file being erased is refused when it would be given
 * (`latestUsableVersion`), and erasing a document removes its ticks with it.
 */
async function eligibleDocuments(
  db: Db,
  applicantId: string,
  only?: readonly string[],
): Promise<EligibleDocument[]> {
  if (only !== undefined && only.length === 0) return [];
  const documents = await db
    .select({ id: schema.documents.id, docType: schema.documents.docType })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.applicantId, applicantId),
        isNull(schema.documents.supersededByDocumentId),
        eq(schema.documents.walletVisible, true),
        ...(only !== undefined ? [inArray(schema.documents.id, [...only])] : []),
      ),
    )
    .orderBy(desc(schema.documents.createdAt))
    .limit(only !== undefined ? only.length : MAX_CANDIDATES);
  if (documents.length === 0) return [];
  // The rule as platform admins have set it now; every document restricted if it cannot be read.
  const protection = await loadDocumentProtectionSettings(db, DEFAULT_DOCUMENT_PROTECTION);
  const open = documents.filter((row) => !documentTypeRestricted(row.docType, protection));
  if (open.length === 0) return [];
  const versions = await db
    .select({
      id: schema.documentVersions.id,
      documentId: schema.documentVersions.documentId,
      safetyStatus: schema.documentVersions.safetyStatus,
      processingStatus: schema.documentVersions.processingStatus,
    })
    .from(schema.documentVersions)
    .where(
      inArray(
        schema.documentVersions.documentId,
        open.map((row) => row.id),
      ),
    )
    .orderBy(desc(schema.documentVersions.versionNumber));
  const latest = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    if (!latest.has(version.documentId)) latest.set(version.documentId, version);
  }
  const eligible: EligibleDocument[] = [];
  for (const row of open) {
    const version = latest.get(row.id);
    if (!version) continue;
    // A new version still being checked keeps the document on the list, so saving Change Access
    // in the meantime never unticks it; nothing is given until that version is clean.
    const checking = version.safetyStatus === 'PENDING' || version.safetyStatus === 'SCANNING';
    if (
      !checking &&
      !isDocumentVersionUsable({
        safetyStatus: version.safetyStatus,
        processingStatus: version.processingStatus,
        erased: false,
      })
    ) {
      continue;
    }
    eligible.push({ documentId: row.id, docType: row.docType, versionId: version.id });
  }
  return eligible;
}

/**
 * The documents the owner may tick under "Original Files", grouped as the Documents screen groups
 * them, with whether a Safe Copy is ready for each. Owner only.
 */
export async function listAiFileCandidates(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<AiFileCandidates, ServiceError>> {
  if (!ownerProof(proof)) return err(serviceError('forbidden', 'access denied'));
  const db = proof.tx;
  if (!(await aiFilesAvailable(db))) return ok({ available: false, documents: [] });
  const eligible = await eligibleDocuments(db, proof.applicant.id);
  if (eligible.length === 0) return ok({ available: true, documents: [] });
  const states = await listRedactionStates(
    proof,
    eligible.map((row) => row.versionId),
  );
  const codes = await referenceCodesFor(
    db,
    'D',
    eligible.map((row) => row.documentId),
  );
  const documents = eligible.flatMap((row): AiFileCandidate[] => {
    const known = row.docType ? resolveDocumentType(row.docType) : undefined;
    const groupKey: DocumentGroupKey = known?.group ?? 'other_documents';
    const state = states.ok ? states.value.get(row.versionId) : undefined;
    // Word files and text, and files past the Safe Copy limits, can never be given (decision O4).
    if (state === 'UNSUPPORTED' || state === 'TOO_LARGE') return [];
    return [
      {
        documentId: row.documentId,
        referenceCode: codes.get(row.documentId) ?? null,
        kind: known?.label ?? 'Other Document',
        groupKey,
        group: GROUP_LABELS.get(groupKey) ?? 'Other Documents',
        safeCopyReady: state !== undefined && isSafeCopyReady(state),
      },
    ];
  });
  documents.sort(
    (a, b) =>
      (GROUP_ORDER.get(a.groupKey) ?? 999) - (GROUP_ORDER.get(b.groupKey) ?? 999) ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      ((a.referenceCode ?? '') < (b.referenceCode ?? '') ? -1 : 1),
  );
  return ok({ available: true, documents });
}

/**
 * The documents already ticked for each of the record's own connections, by connection id. Owner
 * only; a connection of another record is simply absent. Empty before migration 0106 has run.
 */
export async function listAiConnectionFiles(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  connectionIds: readonly string[],
): Promise<ReadonlyMap<string, readonly AiFileChoice[]>> {
  const result = new Map<string, AiFileChoice[]>();
  if (!ownerProof(proof)) return result;
  const ids = connectionIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0 || !(await aiFilesAvailable(proof.tx))) return result;
  const rows = await proof.tx
    .select({
      connectionId: schema.aiConnectionDocuments.connectionId,
      documentId: schema.aiConnectionDocuments.documentId,
      variant: schema.aiConnectionDocuments.variant,
    })
    .from(schema.aiConnectionDocuments)
    .innerJoin(
      schema.aiConnections,
      eq(schema.aiConnections.id, schema.aiConnectionDocuments.connectionId),
    )
    .where(
      and(
        inArray(schema.aiConnectionDocuments.connectionId, ids),
        eq(schema.aiConnections.applicantId, proof.applicant.id),
      ),
    )
    .orderBy(schema.aiConnectionDocuments.createdAt);
  for (const row of rows) {
    if (!isAiFileVariant(row.variant)) continue;
    const list = result.get(row.connectionId) ?? [];
    list.push({ documentId: row.documentId, variant: row.variant });
    result.set(row.connectionId, list);
  }
  return result;
}

/** Why the ticked documents were not stored. */
export type AiFileStoreRefusal = 'step_up_required';

export interface StoreAiConnectionFilesInput {
  readonly connectionId: string;
  /** The ticked documents; `undefined` keeps what is stored, an empty list unticks every one. */
  readonly files: readonly AiFileChoice[] | undefined;
  /** "Original Files" can only be used with List of My Documents (the app finds references there). */
  readonly documentList: boolean;
  /** Whether AI App Original Files works for this person now. Off: kept or removed, never added. */
  readonly featureAvailable: boolean;
  /** Whether the person passed a fresh identity check for this record just now. */
  readonly stepUpSatisfied: boolean;
}

export interface StoredAiConnectionFiles {
  readonly files: number;
  readonly originals: number;
}

/**
 * Replaces the ticked documents of one connection, in the caller's transaction (the same one that
 * stores the other choices). Owner only, for the proof's own record and connection.
 *
 * - Only eligible documents of this record are kept (see `eligibleDocuments`); anything else
 *   submitted is dropped, never stored.
 * - Nothing is kept without List of My Documents.
 * - While the feature is off, a stored choice can be kept or removed, and an Original can become a
 *   Safe Copy, but nothing new is added.
 * - A new Original (a document not stored as an Original before) needs a fresh identity check;
 *   without one nothing is changed and `step_up_required` is returned. Keeping an Original, or
 *   turning it into a Safe Copy, does not.
 * - Before migration 0106 runs, nothing is stored.
 */
export async function storeAiConnectionFiles(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  db: Db,
  input: StoreAiConnectionFilesInput,
): Promise<Result<StoredAiConnectionFiles, AiFileStoreRefusal | 'not_owner'>> {
  if (!ownerProof(proof)) return err('not_owner');
  if (!(await aiFilesAvailable(db))) return ok({ files: 0, originals: 0 });
  const connection = await db
    .select({ id: schema.aiConnections.id })
    .from(schema.aiConnections)
    .where(
      and(
        eq(schema.aiConnections.id, input.connectionId),
        eq(schema.aiConnections.applicantId, proof.applicant.id),
      ),
    )
    .limit(1);
  if (connection.length === 0) return err('not_owner');
  const stored = new Map(
    (
      await db
        .select({
          documentId: schema.aiConnectionDocuments.documentId,
          variant: schema.aiConnectionDocuments.variant,
        })
        .from(schema.aiConnectionDocuments)
        .where(eq(schema.aiConnectionDocuments.connectionId, input.connectionId))
    ).map((row) => [row.documentId, row.variant] as const),
  );
  // No list submitted: keep what is stored. Without List of My Documents: nothing.
  const submitted = !input.documentList
    ? []
    : input.files === undefined
      ? [...stored].flatMap(([documentId, variant]) =>
          isAiFileVariant(variant) ? [{ documentId, variant }] : [],
        )
      : normaliseAiFileChoices(input.files);
  const wanted = submitted.flatMap((file) => {
    const before = stored.get(file.documentId);
    if (!input.featureAvailable) {
      // Off: only what is stored, and an Original only where one was stored.
      if (before === undefined) return [];
      return [{ ...file, variant: before === 'ORIGINAL' ? file.variant : 'SAFE_COPY' }];
    }
    return [file];
  });
  const eligible = new Set(
    (
      await eligibleDocuments(
        db,
        proof.applicant.id,
        wanted.map((file) => file.documentId),
      )
    ).map((row) => row.documentId),
  );
  const kept = wanted.filter((file) => eligible.has(file.documentId));
  const newOriginal = kept.some(
    (file) => file.variant === 'ORIGINAL' && stored.get(file.documentId) !== 'ORIGINAL',
  );
  if (newOriginal && !input.stepUpSatisfied) return err('step_up_required');

  const keptIds = kept.map((file) => file.documentId);
  await db
    .delete(schema.aiConnectionDocuments)
    .where(
      and(
        eq(schema.aiConnectionDocuments.connectionId, input.connectionId),
        ...(keptIds.length > 0
          ? [notInArray(schema.aiConnectionDocuments.documentId, keptIds)]
          : []),
      ),
    );
  for (const file of kept) {
    if (stored.get(file.documentId) === file.variant) continue;
    await db
      .insert(schema.aiConnectionDocuments)
      .values({
        connectionId: input.connectionId,
        documentId: file.documentId,
        variant: file.variant,
      })
      .onConflictDoUpdate({
        target: [
          schema.aiConnectionDocuments.connectionId,
          schema.aiConnectionDocuments.documentId,
        ],
        set: { variant: file.variant },
      });
  }
  return ok({
    files: kept.length,
    originals: kept.filter((file) => file.variant === 'ORIGINAL').length,
  });
}
