import { createHash, randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { fieldPolicyOf, resolveDocumentType } from '@visastack/core/catalogue';
import {
  REDACTION_LIMITS,
  type RedactionBox,
  padRedactionBox,
  parseRedactionBox,
} from '@visastack/core/redaction-boxes';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import {
  type DocumentProof,
  type DocumentPurposes,
  documentAuditActor,
  latestUsableVersion,
  writeDocumentAccessAudit,
} from './document-access';
import { isDocumentVersionUsable } from './documents';
import { activeOrVerifiedErasureStorageObjectIds, enqueueErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';
import type { KeyManagementPort } from './ports';
import type {
  PositionedText,
  SafeCopyFailureReason,
  SafeCopyPageImage,
  SafeCopyRendererPort,
  SafeCopySource,
} from './preview-rendering';
import { revealFactVersionValue } from './profile';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
import { redactionMasksTablePresent } from './redaction-table';
import type { BlobStore } from './storage';
import { discardStorageObject, registerStorageObject } from './storage-objects';

/**
 * Safe copies (ADR 0022, S23, with its 29 Oct amendment). The record owner hides parts of a
 * document with black boxes, page by page. Nothing unmasked is ever served as a safe copy:
 *
 * - Saving the boxes (or the explicit "Nothing to Hide on This Document") covers every page of
 *   the document's latest usable version and gives them a new mask revision. The copy is then
 *   PREPARING: the owner's editor asks for each page to be drawn once (`prepareSafeCopyPage`),
 *   with its boxes painted black, and each drawing is stored as a private derived file. The copy
 *   is ready only when every page has a drawing for the current revision; a download only puts
 *   stored drawings together (deviation 7: drawing at download took 27 s for 8 scanned pages).
 * - Every save or removal starts a new revision and queues the old drawings for verified erasure
 *   in the same transaction (deleted at once after commit when possible; the erasure worker is
 *   the fallback). An old revision is never served.
 * - Boxes belong to one version. A new version starts with none, and boxes can be saved only on
 *   the latest version that is safe to use.
 * - Only the record owner edits boxes and sees the editor (owner MANAGE or PREVIEW proofs). Page
 *   images for the editor show the page as stored, so they are the owner's alone.
 * - The copy needs a DOWNLOAD_REDACTED proof ("Download Safe Copies").
 * - Suggestions read the file's own text and the owner's own identity numbers in memory only and
 *   return box positions, never the values.
 * - Audit events hold counts only: never box positions, image data or identity numbers.
 * - Until migration 0102 runs, everything reads "Not Prepared Yet" and saving says safe copies are
 *   not ready yet.
 */

export const SAFE_COPY_TOO_LARGE_MESSAGE = 'This document is too large for a safe copy';

/** The safe copy is held to this many bytes so it stays inside the hosting response limit. */
export const SAFE_COPY_MAX_OUTPUT_BYTES = 4_000_000;

/** Room kept for the PDF's own structure when the byte limit is shared between pages. */
const PDF_STRUCTURE_BYTES = 64 * 1024;

/** Stored drawings are private derived files under this prefix in the private bucket. */
const DERIVED_KEY_PREFIX = 'safe-copy/';

/**
 * Where a document's safe copy stands. `NOT_PREPARED`: the owner has not marked every page yet.
 * `PREPARING`: every page is marked, and the pages are still being drawn. `MASKED`: ready, with
 * at least one box. `NOTHING_TO_HIDE`: ready, the owner chose "Nothing to Hide on This Document".
 * `UNSUPPORTED`: documents and text files. `TOO_LARGE`: past the page or size limit.
 */
export type SafeCopyState =
  | 'NOT_PREPARED'
  | 'PREPARING'
  | 'MASKED'
  | 'NOTHING_TO_HIDE'
  | 'UNSUPPORTED'
  | 'TOO_LARGE';

/** Whether a state means a safe copy can be downloaded. */
export function isSafeCopyReady(state: SafeCopyState): boolean {
  return state === 'MASKED' || state === 'NOTHING_TO_HIDE';
}

/** Why a request was refused, so the web layer can answer in plain words. */
export type SafeCopyRefusal =
  | 'not_prepared'
  | 'not_available'
  | 'too_large'
  | 'too_slow'
  | 'unsupported'
  | 'unreadable'
  | 'not_ready_yet'
  | 'out_of_date';

export interface SafeCopyError extends ServiceError {
  readonly refusal?: SafeCopyRefusal;
}

export interface RedactionDeps {
  readonly storage: Pick<BlobStore, 'getObject' | 'putObject' | 'deleteObject'>;
  readonly renderer: SafeCopyRendererPort;
  /** Decrypts the owner's protected identity numbers for suggestions; absent means none are read. */
  readonly encryption?: KeyManagementPort | undefined;
}

/** File types a safe copy is made from. Everything else is UNSUPPORTED. */
const SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

/** Stored names that can only be a document or text file (a hint for the list; the file decides). */
const UNSUPPORTED_EXTENSIONS: readonly string[] = ['.docx', '.doc', '.txt', '.md'];

/** Passport kinds whose machine-readable lines sit in a band at the bottom of the photo page. */
const PASSPORT_KEYS: ReadonlySet<string> = new Set([
  'PASSPORT',
  'SPOUSE_PASSPORT',
  'HOST_PASSPORT',
]);

/** The usual place of a passport's machine-readable lines on the first page, padded. */
const MRZ_BAND: RedactionBox = Object.freeze({ x: 0.02, y: 0.78, w: 0.96, h: 0.2 });

const MAX_LISTED_VERSIONS = 500;
/** Suggested boxes on one page at most: more than this is noise, not help. */
export const MAX_SUGGESTIONS_PER_PAGE = 30;

type DocumentRow = typeof schema.documents.$inferSelect;
type VersionRow = typeof schema.documentVersions.$inferSelect;
type MaskRow = typeof schema.redactionMasks.$inferSelect;
type AnyProof =
  | AuthorizedApplicant<'VIEW_METADATA'>
  | AuthorizedApplicant<'PREVIEW'>
  | AuthorizedApplicant<'MANAGE'>
  | AuthorizedApplicant<'DOWNLOAD_REDACTED'>;

const PURPOSES: DocumentPurposes = Object.freeze({
  owner: 'owner_safe_copy',
  shared: 'shared_safe_copy',
});
const EDITOR_PURPOSES: DocumentPurposes = Object.freeze({
  owner: 'owner_safe_copy_editor',
  shared: 'shared_safe_copy',
});

function budget() {
  return { timeLimitMs: REDACTION_LIMITS.renderBudgetMs, maxPages: REDACTION_LIMITS.maxPages };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// --- Proofs ---------------------------------------------------------------------------------

/** The document of a genuine owner proof for `action`, or undefined for anything else. */
function ownerDocument(proof: AnyProof, action: 'PREVIEW' | 'MANAGE'): DocumentRow | undefined {
  if (!AuthorizedApplicant.isGenuine(proof, action)) return undefined;
  if (proof.actor.kind !== 'applicant_owner') return undefined;
  if (proof.resource.kind !== 'document') return undefined;
  const document = proof.resource.document;
  if (document.applicantId !== proof.applicant.id) return undefined;
  return document;
}

async function audit(
  proof: DocumentProof,
  document: DocumentRow,
  event: {
    readonly allowed: boolean;
    readonly reason: string | null;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly purposes?: DocumentPurposes;
  },
): Promise<void> {
  await writeDocumentAccessAudit(proof, {
    documentId: document.id,
    applicantId: document.applicantId,
    allowed: event.allowed,
    reason: event.reason,
    metadata: event.metadata,
    purposes: event.purposes ?? PURPOSES,
  });
}

const BUCKETS = {
  SAFE_COPY: { action: 'safe_copy', label: 'safe copy' },
  REDACTION_PAGE: { action: 'redaction_page', label: 'page view' },
  REDACTION_SAVE: { action: 'redaction_save', label: 'save' },
  SAFE_COPY_PREPARE: { action: 'safe_copy_prepare', label: 'page preparation' },
} as const;

async function withinLimit(
  proof: DocumentProof,
  bucket: keyof typeof BUCKETS,
): Promise<Result<true, ServiceError>> {
  const who = documentAuditActor(proof);
  const { action, label } = BUCKETS[bucket];
  const limit = await checkRateLimit(
    proof.tx,
    { subjectId: who.subjectAccountId, action, label },
    RATE_LIMITS[bucket],
  );
  return limit.allowed ? ok(true) : err(serviceError('rate_limited', limit.reason));
}

// --- Bytes and masks ---------------------------------------------------------------------------

type LoadedSource =
  | { readonly ok: true; readonly source: SafeCopySource }
  | { readonly ok: false; readonly reason: 'stored_object_missing' | 'too_large' | 'unsupported' };

/** The stored bytes of a version, refused unread when the recorded size is already too large. */
async function loadSource(
  db: Db,
  deps: Pick<RedactionDeps, 'storage'>,
  version: VersionRow,
): Promise<LoadedSource> {
  if (version.sizeBytes !== null && version.sizeBytes > REDACTION_LIMITS.maxInputBytes) {
    return { ok: false, reason: 'too_large' };
  }
  const storageObject = first(
    await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.id, version.storageObjectId))
      .limit(1),
  );
  if (storageObject?.sizeBytes && storageObject.sizeBytes > REDACTION_LIMITS.maxInputBytes) {
    return { ok: false, reason: 'too_large' };
  }
  const stored = storageObject ? await deps.storage.getObject(storageObject.objectKey) : undefined;
  if (!stored) return { ok: false, reason: 'stored_object_missing' };
  if (stored.bytes.byteLength > REDACTION_LIMITS.maxInputBytes) {
    return { ok: false, reason: 'too_large' };
  }
  if (!SUPPORTED_TYPES.has(stored.contentType)) return { ok: false, reason: 'unsupported' };
  return { ok: true, source: { bytes: stored.bytes, contentType: stored.contentType } };
}

/** Every mask row of the listed versions, by page; `missing` before migration 0102 has run. */
async function readMasks(db: Db, versionIds: readonly string[]): Promise<MaskRow[] | 'missing'> {
  if (!(await redactionMasksTablePresent(db))) return 'missing';
  if (versionIds.length === 0) return [];
  return db
    .select()
    .from(schema.redactionMasks)
    .where(inArray(schema.redactionMasks.documentVersionId, [...versionIds]))
    .orderBy(asc(schema.redactionMasks.documentVersionId), asc(schema.redactionMasks.page));
}

interface MarkedPage {
  readonly row: MaskRow;
  readonly boxes: RedactionBox[];
  readonly drawn: boolean;
}

interface MarkedVersion {
  readonly revision: string;
  readonly pages: readonly MarkedPage[];
}

/**
 * A version's rows when they cover exactly pages 1 to N under one revision with valid boxes, or
 * undefined. A stored list that is not a list of valid boxes makes the whole version unprepared:
 * never serve a copy with a box quietly dropped.
 */
function markedVersion(rows: readonly MaskRow[]): MarkedVersion | undefined {
  if (rows.length === 0 || rows.length > REDACTION_LIMITS.maxPages) return undefined;
  const sorted = [...rows].sort((a, b) => a.page - b.page);
  const revision = sorted[0]?.maskRevision;
  if (!revision) return undefined;
  const pages: MarkedPage[] = [];
  for (const [index, row] of sorted.entries()) {
    if (row.page !== index + 1 || row.maskRevision !== revision) return undefined;
    const stored: unknown = row.boxes;
    if (!Array.isArray(stored) || stored.length > REDACTION_LIMITS.maxBoxesPerPage) {
      return undefined;
    }
    const boxes: RedactionBox[] = [];
    for (const value of stored) {
      const box = parseRedactionBox(value);
      if (!box) return undefined;
      boxes.push(box);
    }
    pages.push({ row, boxes, drawn: row.renderedStorageObjectId !== null });
  }
  return { revision, pages };
}

function stateOf(marked: MarkedVersion | undefined): SafeCopyState {
  if (!marked) return 'NOT_PREPARED';
  if (!marked.pages.every((page) => page.drawn)) return 'PREPARING';
  return marked.pages.every((page) => page.boxes.length === 0) ? 'NOTHING_TO_HIDE' : 'MASKED';
}

function failureRefusal(reason: SafeCopyFailureReason): SafeCopyRefusal {
  switch (reason) {
    case 'too_large':
      return 'too_large';
    case 'out_of_time':
      return 'too_slow';
    case 'unsupported':
      return 'unsupported';
    case 'unreadable':
      return 'unreadable';
  }
}

function refusalError(refusal: SafeCopyRefusal): SafeCopyError {
  switch (refusal) {
    case 'too_large':
      return { ...serviceError('invalid', SAFE_COPY_TOO_LARGE_MESSAGE), refusal };
    case 'too_slow':
      return { ...serviceError('upstream_error', 'this page took too long to prepare'), refusal };
    case 'unsupported':
      return {
        ...serviceError('invalid', 'safe copies are made from PDF files and photos only'),
        refusal,
      };
    case 'unreadable':
      return { ...serviceError('invalid', 'this file could not be read for a safe copy'), refusal };
    case 'not_prepared':
      return { ...serviceError('forbidden', 'the safe copy is not prepared yet'), refusal };
    case 'not_ready_yet':
      return { ...serviceError('upstream_error', 'safe copies are not ready yet'), refusal };
    case 'out_of_date':
      return {
        ...serviceError('stale', 'a newer version or newer boxes have been saved'),
        refusal,
      };
    case 'not_available':
      return { ...serviceError('forbidden', 'this document is not available yet'), refusal };
  }
}

interface DerivedObject {
  readonly storageObjectId: string;
  readonly bucket: 'QUARANTINE' | 'CLEAN';
  readonly objectKey: string;
  readonly contentHash: string | null;
}

/** The stored drawings of the given rows, with what erasure needs to find and check them. */
async function derivedObjectsOf(db: Db, rows: readonly MaskRow[]): Promise<DerivedObject[]> {
  const ids = rows.flatMap((row) =>
    row.renderedStorageObjectId ? [row.renderedStorageObjectId] : [],
  );
  if (ids.length === 0) return [];
  const objects = await db
    .select()
    .from(schema.storageObjects)
    .where(inArray(schema.storageObjects.id, ids));
  return objects.map((object) => ({
    storageObjectId: object.id,
    bucket: object.bucket,
    objectKey: object.objectKey,
    contentHash: object.contentHash,
  }));
}

/** Queues verified erasure of old drawings, inside the caller's transaction. */
async function queueDerivedRemoval(
  tx: Db,
  objects: readonly DerivedObject[],
  applicantId: string,
): Promise<void> {
  for (const object of objects) {
    await enqueueErasureJob(tx, {
      reason: 'SAFE_COPY_REMOVAL',
      bucket: object.bucket,
      objectKey: object.objectKey,
      expectedHash: object.contentHash,
      storageObjectId: object.storageObjectId,
      applicantId,
    });
  }
}

/** After commit: delete old drawings at once where possible; the queued erasure job verifies. */
async function deleteDerivedNow(
  deps: Pick<RedactionDeps, 'storage'>,
  objects: readonly DerivedObject[],
): Promise<void> {
  for (const object of objects) {
    await deps.storage.deleteObject(object.bucket, object.objectKey).catch(() => undefined);
  }
}

// --- States -----------------------------------------------------------------------------------

interface ListedVersion {
  readonly id: string;
  readonly pages: number | null;
  readonly sizeBytes: number | null;
  readonly originalName: string;
}

async function statesForVersions(
  db: Db,
  versions: readonly ListedVersion[],
): Promise<Map<string, SafeCopyState>> {
  const states = new Map<string, SafeCopyState>();
  const rows = await readMasks(
    db,
    versions.map((v) => v.id),
  );
  const byVersion = new Map<string, MaskRow[]>();
  if (rows !== 'missing') {
    for (const row of rows) {
      const list = byVersion.get(row.documentVersionId) ?? [];
      list.push(row);
      byVersion.set(row.documentVersionId, list);
    }
  }
  for (const version of versions) {
    const name = version.originalName.toLowerCase();
    if (UNSUPPORTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      states.set(version.id, 'UNSUPPORTED');
    } else if (
      (version.pages !== null && version.pages > REDACTION_LIMITS.maxPages) ||
      (version.sizeBytes !== null && version.sizeBytes > REDACTION_LIMITS.maxInputBytes)
    ) {
      states.set(version.id, 'TOO_LARGE');
    } else {
      states.set(version.id, stateOf(markedVersion(byVersion.get(version.id) ?? [])));
    }
  }
  return states;
}

const VERSION_FIELDS = {
  id: schema.documentVersions.id,
  documentId: schema.documentVersions.documentId,
  versionNumber: schema.documentVersions.versionNumber,
  storageObjectId: schema.documentVersions.storageObjectId,
  safetyStatus: schema.documentVersions.safetyStatus,
  processingStatus: schema.documentVersions.processingStatus,
  pages: schema.documentVersions.pages,
  sizeBytes: schema.documentVersions.sizeBytes,
  originalName: schema.documents.originalName,
};

/**
 * Where each listed version's safe copy stands, for versions of the proof's traveller (and of its
 * one document, for a document proof). Unknown or other people's versions are left out. Before
 * migration 0102 every version reads NOT_PREPARED.
 */
export async function listRedactionStates(
  proof: AuthorizedApplicant<'VIEW_METADATA'> | AuthorizedApplicant<'DOWNLOAD_REDACTED'>,
  versionIds: readonly string[],
): Promise<Result<ReadonlyMap<string, SafeCopyState>, ServiceError>> {
  const genuine =
    AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    AuthorizedApplicant.isGenuine(proof, 'DOWNLOAD_REDACTED');
  if (!genuine) return err(serviceError('forbidden', 'access denied'));
  if (proof.action === 'DOWNLOAD_REDACTED' && proof.resource.kind !== 'document') {
    return err(serviceError('forbidden', 'access denied'));
  }
  const ids = [...new Set(versionIds)].slice(0, MAX_LISTED_VERSIONS);
  if (ids.length === 0) return ok(new Map());
  const versions = await proof.tx
    .select(VERSION_FIELDS)
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(
      and(
        inArray(schema.documentVersions.id, ids),
        eq(schema.documents.applicantId, proof.applicant.id),
        ...(proof.resource.kind === 'document'
          ? [eq(schema.documents.id, proof.resource.document.id)]
          : []),
      ),
    );
  return ok(await statesForVersions(proof.tx, versions));
}

type StateProof = AuthorizedApplicant<'VIEW_METADATA'> | AuthorizedApplicant<'DOWNLOAD_REDACTED'>;

/**
 * Where the safe copy of each proof's one document stands, judged on its latest version that is
 * safe to use (a version not yet safe to use reads NOT_PREPARED): what a person or agency is shown
 * on a shared record. One read for every document, whatever the number of proofs. Each proof
 * must be a genuine document proof for viewing details or downloading safe copies; any other is
 * left out.
 */
export async function listSafeCopyStatesForDocuments(
  proof: StateProof,
  more: readonly StateProof[] = [],
): Promise<ReadonlyMap<string, SafeCopyState>> {
  const proofs = [proof, ...more];
  const documents = new Map<string, DocumentRow>();
  let db: Db | undefined;
  for (const proof of proofs) {
    const genuine =
      AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
      AuthorizedApplicant.isGenuine(proof, 'DOWNLOAD_REDACTED');
    if (!genuine || proof.resource.kind !== 'document') continue;
    if (proof.resource.document.applicantId !== proof.applicant.id) continue;
    documents.set(proof.resource.document.id, proof.resource.document);
    db ??= proof.tx;
  }
  const states = new Map<string, SafeCopyState>();
  if (!db || documents.size === 0) return states;
  const rows = await db
    .select(VERSION_FIELDS)
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(inArray(schema.documentVersions.documentId, [...documents.keys()]))
    .orderBy(desc(schema.documentVersions.versionNumber));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.documentId)) latest.set(row.documentId, row);
  const erased = await activeOrVerifiedErasureStorageObjectIds(
    db,
    [...latest.values()].map((row) => row.storageObjectId),
  );
  const usable = [...latest.values()].filter((row) =>
    isDocumentVersionUsable({
      safetyStatus: row.safetyStatus,
      processingStatus: row.processingStatus,
      erased: erased.has(row.storageObjectId),
    }),
  );
  const byVersion = await statesForVersions(db, usable);
  for (const documentId of documents.keys()) {
    const version = latest.get(documentId);
    states.set(documentId, (version && byVersion.get(version.id)) ?? 'NOT_PREPARED');
  }
  return states;
}

/** Where the safe copy of the proof's one document stands (see listSafeCopyStatesForDocuments). */
export async function getSafeCopyState(
  proof: AuthorizedApplicant<'DOWNLOAD_REDACTED'>,
): Promise<Result<SafeCopyState, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'DOWNLOAD_REDACTED') ||
    proof.resource.kind !== 'document'
  ) {
    return err(serviceError('forbidden', 'access denied'));
  }
  const states = await listSafeCopyStatesForDocuments(proof);
  return ok(states.get(proof.resource.document.id) ?? 'NOT_PREPARED');
}

// --- The owner's editor -----------------------------------------------------------------------

export interface RedactionEditorView {
  readonly documentId: string;
  readonly versionId: string;
  readonly pageCount: number;
  readonly state: SafeCopyState;
  /** Saved boxes, one list per page, only when they still cover every page of this version. */
  readonly savedPages: readonly (readonly RedactionBox[])[] | null;
  /** The revision of the saved boxes, which the preparing steps name; null when none is saved. */
  readonly maskRevision: string | null;
  /** Pages already drawn for that revision, so preparing resumes where it stopped. */
  readonly preparedPages: readonly number[];
  /** False before migration 0102: the editor can be looked at but nothing can be saved yet. */
  readonly canSave: boolean;
}

interface OwnerLoaded {
  readonly document: DocumentRow;
  readonly version: VersionRow;
  readonly source: SafeCopySource;
  readonly pageCount: number;
}

/**
 * Shared checks for the editor's reads and the preparing step: a genuine owner proof, within the
 * given bucket, on the latest usable version (and the one the editor asked about, when it names
 * one), whose file is a PDF or image within the limits. Refusals after the gate are audited DENIED,
 * without image data.
 */
async function loadForOwner(
  proof: AuthorizedApplicant<'PREVIEW'> | AuthorizedApplicant<'MANAGE'>,
  document: DocumentRow,
  deps: RedactionDeps,
  bucket: 'REDACTION_PAGE' | 'SAFE_COPY_PREPARE',
  metadata: Readonly<Record<string, unknown>>,
  expectedVersionId: string | undefined,
): Promise<Result<OwnerLoaded, SafeCopyError>> {
  const limited = await withinLimit(proof, bucket);
  if (!limited.ok) return limited;
  const refuse = async (reason: string, refusal: SafeCopyRefusal) => {
    await audit(proof, document, {
      allowed: false,
      reason,
      metadata,
      purposes: EDITOR_PURPOSES,
    });
    return err(refusalError(refusal));
  };
  const latest = await latestUsableVersion(proof);
  if (latest.kind !== 'usable') return refuse(latest.reason, 'not_available');
  if (expectedVersionId !== undefined && expectedVersionId !== latest.version.id) {
    return refuse('version_out_of_date', 'out_of_date');
  }
  const loaded = await loadSource(proof.tx, deps, latest.version);
  if (!loaded.ok) {
    return refuse(
      loaded.reason,
      loaded.reason === 'stored_object_missing' ? 'not_available' : loaded.reason,
    );
  }
  const counted = await deps.renderer.pageCount(loaded.source, budget());
  if (!counted.ok) return refuse(`render_${counted.reason}`, failureRefusal(counted.reason));
  return ok({
    document,
    version: latest.version,
    source: loaded.source,
    pageCount: counted.pageCount,
  });
}

/** What the owner's editor needs: the version, its pages and the boxes saved for it. */
export async function openRedactionEditor(
  proof: AuthorizedApplicant<'PREVIEW'>,
  deps: RedactionDeps,
): Promise<Result<RedactionEditorView, SafeCopyError>> {
  const document = ownerDocument(proof, 'PREVIEW');
  if (!document) return err(serviceError('forbidden', 'only the owner can prepare a safe copy'));
  const metadata = { variant: 'redaction_editor', disposition: 'preview' };
  const loaded = await loadForOwner(proof, document, deps, 'REDACTION_PAGE', metadata, undefined);
  if (!loaded.ok) return loaded;
  const { version, pageCount } = loaded.value;
  const rows = await readMasks(proof.tx, [version.id]);
  const marked = rows === 'missing' ? undefined : markedVersion(rows);
  const current = marked && marked.pages.length === pageCount ? marked : undefined;
  await audit(proof, document, {
    allowed: true,
    reason: null,
    metadata: { ...metadata, pageCount },
    purposes: EDITOR_PURPOSES,
  });
  return ok({
    documentId: document.id,
    versionId: version.id,
    pageCount,
    state: stateOf(current),
    savedPages: current ? current.pages.map((page) => page.boxes) : null,
    maskRevision: current?.revision ?? null,
    preparedPages: current ? current.pages.filter((p) => p.drawn).map((p) => p.row.page) : [],
    canSave: rows !== 'missing',
  });
}

export interface RenderedRedactionPage {
  readonly bytes: Uint8Array;
  readonly contentType: 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

/** One page of the owner's latest version, drawn for the editor with nothing hidden. */
export async function renderRedactionPage(
  proof: AuthorizedApplicant<'PREVIEW'>,
  deps: RedactionDeps,
  input: { readonly versionId: string; readonly page: number },
): Promise<Result<RenderedRedactionPage, SafeCopyError>> {
  const document = ownerDocument(proof, 'PREVIEW');
  if (!document) return err(serviceError('forbidden', 'only the owner can prepare a safe copy'));
  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    input.page > REDACTION_LIMITS.maxPages
  ) {
    return err(serviceError('invalid', 'choose a page of this document'));
  }
  const metadata = { variant: 'redaction_page', disposition: 'preview', page: input.page };
  const loaded = await loadForOwner(
    proof,
    document,
    deps,
    'REDACTION_PAGE',
    metadata,
    input.versionId,
  );
  if (!loaded.ok) return loaded;
  const { source, pageCount } = loaded.value;
  if (input.page > pageCount) return err(serviceError('invalid', 'choose a page of this document'));
  const rendered = await deps.renderer.renderPage(source, input.page, budget());
  if (!rendered.ok) {
    await audit(proof, document, {
      allowed: false,
      reason: `render_${rendered.reason}`,
      metadata,
      purposes: EDITOR_PURPOSES,
    });
    return err(refusalError(failureRefusal(rendered.reason)));
  }
  await audit(proof, document, {
    allowed: true,
    reason: null,
    metadata,
    purposes: EDITOR_PURPOSES,
  });
  return ok({
    bytes: rendered.bytes,
    contentType: rendered.contentType,
    width: rendered.width,
    height: rendered.height,
  });
}

// --- Suggestions ------------------------------------------------------------------------------

/** Why a box is suggested, shown to the owner in plain words by the editor. */
export type RedactionSuggestionReason = 'mrz' | 'identifier' | 'account_number';

export interface RedactionSuggestion {
  readonly page: number;
  readonly box: RedactionBox;
  readonly reason: RedactionSuggestionReason;
}

/** Letters and digits only, upper case: "AB 12-34" and "ab1234" compare equal. */
function compact(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** A machine-readable passport line: 28 to 44 of A to Z, 0 to 9 and "<", with filler. */
const MRZ_LINE = /^[A-Z0-9<]{28,44}$/;
const MIN_IDENTIFIER_LENGTH = 4;
const MAX_TEXT_ITEM_LENGTH = 500;

/** IBAN lengths by country (the IBAN registry), so a look-alike code is never taken for one. */
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
};

/** Whether a compact candidate is a real IBAN: known country, its length, and mod-97 equal to 1. */
export function isValidIban(candidate: string): boolean {
  const country = candidate.slice(0, 2);
  if (IBAN_LENGTHS[country] !== candidate.length) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(candidate)) return false;
  const rearranged = candidate.slice(4) + candidate.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 ? String(code - 55) : ch;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * IBANs written as one token or in groups of up to four separated by single spaces, the way they
 * are printed. Spaces between other words are never removed to make one up.
 */
const IBAN_WRITTEN =
  /\b[A-Z]{2}\d{2}(?:[A-Z0-9]{11,30}|(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,4})?)\b/g;

function hasIban(text: string): boolean {
  for (const match of text.toUpperCase().matchAll(IBAN_WRITTEN)) {
    if (isValidIban(match[0].replace(/ /g, ''))) return true;
  }
  return false;
}

/** Words that label an account or card number on the same line. */
const ACCOUNT_LABEL = /\b(account(?:\s+(?:no|number|num))?|a\/c|acct|iban|card)\b/i;
/** A run of 8 to 20 digits, possibly split by single spaces or hyphens. */
const ACCOUNT_DIGITS = /(?<![\d.,])\d(?:[ -]?\d){7,19}(?![\d.,])/g;
const DATE_LIKE = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/;
const PHONE_LABEL = /\b(tel|phone|mobile|fax|cell)\b/i;
const MONEY_LIKE = /([$£€৳₹]|\b(usd|eur|gbp|bdt|inr|tk|taka)\b|\d,\d{3}|\.\d{2}\b)/i;

/** An account or card number: digits on a labelled line, not a date, a phone number or an amount. */
export function looksLikeAccountNumber(text: string, lineText: string): boolean {
  if (!ACCOUNT_LABEL.test(lineText) || PHONE_LABEL.test(lineText)) return false;
  for (const match of text.matchAll(ACCOUNT_DIGITS)) {
    const digits = match[0];
    if (DATE_LIKE.test(digits) || /^\+/.test(text.trim())) continue;
    if (MONEY_LIKE.test(text)) continue;
    if (digits.replace(/\D/g, '').length >= 8) return true;
  }
  return false;
}

function isPassportKind(docType: string | null): boolean {
  if (!docType) return false;
  const key = resolveDocumentType(docType)?.key ?? docType.trim().toUpperCase();
  return PASSPORT_KEYS.has(key);
}

function isFinancialKind(docType: string | null): boolean {
  if (!docType) return false;
  const resolved = resolveDocumentType(docType);
  return resolved?.group === 'financial' || resolved?.key === 'BANK_STATEMENT';
}

/**
 * The owner's own identity numbers (passport, national ID and the like), compacted, decrypted in
 * memory for this one request through the profile's own reader, and never logged, returned or
 * stored.
 */
async function ownIdentifiers(
  db: Db,
  applicantId: string,
  encryption: KeyManagementPort | undefined,
): Promise<string[]> {
  const rows = await db
    .select({ fieldKey: schema.fieldDefinitions.key, version: schema.factVersions })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
    .where(eq(schema.facts.applicantId, applicantId));
  const values = new Set<string>();
  for (const row of rows) {
    const kind = fieldPolicyOf(row.fieldKey)?.kind;
    if (kind !== 'identifier' && kind !== 'national_identifier') continue;
    let text: string | null = row.version.value;
    if (row.version.protectedKeyVersion !== null) {
      if (!encryption) continue;
      const revealed = await revealFactVersionValue(db, encryption, row.version);
      // A value that cannot be read gives no suggestion; nothing about it is reported.
      if (!revealed.ok) continue;
      text = revealed.value;
    }
    const value = text ? compact(text) : '';
    if (value.length >= MIN_IDENTIFIER_LENGTH) values.add(value);
  }
  return [...values];
}

/** Whether a piece of text on the page is, or is a large part of, one of the owner's numbers. */
function matchesIdentifier(text: string, identifiers: readonly string[]): boolean {
  if (text.length < MIN_IDENTIFIER_LENGTH) return false;
  return identifiers.some(
    (id) => text.includes(id) || (id.includes(text) && text.length * 2 >= id.length),
  );
}

/** The text of every piece on the same line as `item` (its vertical middle within half a line). */
function lineOf(item: PositionedText, items: readonly PositionedText[]): string {
  const middle = item.box.y + item.box.h / 2;
  return items
    .filter((other) => Math.abs(other.box.y + other.box.h / 2 - middle) <= item.box.h / 2)
    .sort((a, b) => a.box.x - b.box.x)
    .map((other) => other.text.slice(0, MAX_TEXT_ITEM_LENGTH))
    .join(' ');
}

function textReason(
  item: PositionedText,
  items: readonly PositionedText[],
  identifiers: readonly string[],
  financial: boolean,
): RedactionSuggestionReason | undefined {
  const raw = item.text.slice(0, MAX_TEXT_ITEM_LENGTH);
  const tight = raw.toUpperCase().replace(/\s/g, '');
  if (MRZ_LINE.test(tight) && tight.includes('<<')) return 'mrz';
  if (matchesIdentifier(compact(raw), identifiers)) return 'identifier';
  if (financial && (hasIban(raw) || looksLikeAccountNumber(raw, lineOf(item, items)))) {
    return 'account_number';
  }
  return undefined;
}

/**
 * Suggested boxes for the owner's latest version: the passport's machine-readable lines (from
 * the file's own text, and the usual band on the first page of a passport), the owner's own
 * identity numbers, and account numbers on financial documents (a valid IBAN, or 8 to 20 digits
 * on a line labelled as an account or card, never a date, phone number or amount). At most
 * `MAX_SUGGESTIONS_PER_PAGE` a page. Suggestions only: nothing is saved, and the owner accepts,
 * moves or removes each one. Positions come from the PDF's own text layer, read on request and
 * never stored; a scanned image has none, so only the passport band is offered there.
 */
export async function suggestRedactions(
  proof: AuthorizedApplicant<'PREVIEW'>,
  deps: RedactionDeps,
  input: { readonly versionId: string },
): Promise<Result<readonly RedactionSuggestion[], SafeCopyError>> {
  const document = ownerDocument(proof, 'PREVIEW');
  if (!document) return err(serviceError('forbidden', 'only the owner can prepare a safe copy'));
  const metadata = { variant: 'redaction_suggestions', disposition: 'preview' };
  const loaded = await loadForOwner(
    proof,
    document,
    deps,
    'REDACTION_PAGE',
    metadata,
    input.versionId,
  );
  if (!loaded.ok) return loaded;
  const { source, pageCount } = loaded.value;
  const suggestions: RedactionSuggestion[] = [];
  const perPage = new Map<number, number>();
  const add = (page: number, box: RedactionBox, reason: RedactionSuggestionReason) => {
    const count = perPage.get(page) ?? 0;
    if (count >= MAX_SUGGESTIONS_PER_PAGE) return;
    perPage.set(page, count + 1);
    suggestions.push({ page, box, reason });
  };
  if (isPassportKind(document.docType)) add(1, MRZ_BAND, 'mrz');

  if (source.contentType === 'application/pdf') {
    const text = await deps.renderer.textPositions(source, budget());
    if (text.ok) {
      const identifiers = await ownIdentifiers(proof.tx, document.applicantId, deps.encryption);
      const financial = isFinancialKind(document.docType);
      for (const [index, items] of text.pages.entries()) {
        const page = index + 1;
        if (page > pageCount) break;
        for (const item of items) {
          const reason = textReason(item, items, identifiers, financial);
          if (!reason) continue;
          const box = parseRedactionBox(padRedactionBox(item.box, 0.006, 0.004));
          if (box) add(page, box, reason);
        }
      }
    }
  }
  await audit(proof, document, {
    allowed: true,
    reason: null,
    metadata: { ...metadata, suggestionCount: suggestions.length },
    purposes: EDITOR_PURPOSES,
  });
  return ok(suggestions);
}

// --- Saving and clearing ----------------------------------------------------------------------

export interface SaveRedactionPageInput {
  /** Boxes as sent by the editor, checked here; anything invalid refuses the whole save. */
  readonly boxes: readonly unknown[];
  /** How many of this page's boxes came from an accepted suggestion. */
  readonly acceptedSuggestions: number;
}

export interface SaveRedactionMasksInput {
  readonly versionId: string;
  /** One entry per page, in page order, covering every page of the version. */
  readonly pages: readonly SaveRedactionPageInput[];
  /** The owner's explicit "Nothing to Hide on This Document": every page then has no boxes. */
  readonly nothingToHide: boolean;
}

export interface SavedRedaction {
  readonly versionId: string;
  readonly pageCount: number;
  readonly boxCount: number;
  /** Always PREPARING: each page is drawn next, through `prepareSafeCopyPage`. */
  readonly state: 'PREPARING';
  /** The revision every preparing step names. */
  readonly maskRevision: string;
}

/**
 * Saves the owner's boxes for every page of the latest usable version under a new revision,
 * replacing what was saved before and queuing the old drawings for erasure, in one transaction
 * with its audit event (counts only). Refused unless the pages sent cover exactly the pages of
 * the file: a partial save would leave a page nobody looked at.
 */
export async function saveRedactionMasks(
  proof: AuthorizedApplicant<'MANAGE'>,
  deps: RedactionDeps,
  input: SaveRedactionMasksInput,
): Promise<Result<SavedRedaction, SafeCopyError>> {
  const document = ownerDocument(proof, 'MANAGE');
  if (!document) return err(serviceError('forbidden', 'only the owner can prepare a safe copy'));
  if (input.pages.length < 1 || input.pages.length > REDACTION_LIMITS.maxPages) {
    return err(serviceError('invalid', 'mark every page of the document'));
  }
  const pages: RedactionBox[][] = [];
  let acceptedSuggestions = 0;
  for (const page of input.pages) {
    if (page.boxes.length > REDACTION_LIMITS.maxBoxesPerPage) {
      return err(serviceError('invalid', 'a page can have at most 200 boxes'));
    }
    const boxes: RedactionBox[] = [];
    for (const value of page.boxes) {
      const box = parseRedactionBox(value);
      if (!box) return err(serviceError('invalid', 'a box is not on the page'));
      boxes.push(box);
    }
    if (
      !Number.isSafeInteger(page.acceptedSuggestions) ||
      page.acceptedSuggestions < 0 ||
      page.acceptedSuggestions > boxes.length
    ) {
      return err(serviceError('invalid', 'the suggestion count does not match the boxes'));
    }
    acceptedSuggestions += page.acceptedSuggestions;
    pages.push(boxes);
  }
  const boxCount = pages.reduce((sum, boxes) => sum + boxes.length, 0);
  if (input.nothingToHide && boxCount > 0) {
    return err(serviceError('invalid', 'remove the boxes, or do not choose nothing to hide'));
  }
  if (!input.nothingToHide && boxCount === 0) {
    return err(serviceError('invalid', 'add a box, or choose Nothing to Hide on This Document'));
  }

  const db = proof.tx;
  if (!(await redactionMasksTablePresent(db))) return err(refusalError('not_ready_yet'));
  const limited = await withinLimit(proof, 'REDACTION_SAVE');
  if (!limited.ok) return limited;
  const latest = await latestUsableVersion(proof);
  if (latest.kind !== 'usable') return err(refusalError('not_available'));
  if (latest.version.id !== input.versionId) return err(refusalError('out_of_date'));
  const loaded = await loadSource(db, deps, latest.version);
  if (!loaded.ok) {
    return err(
      refusalError(loaded.reason === 'stored_object_missing' ? 'not_available' : loaded.reason),
    );
  }
  const counted = await deps.renderer.pageCount(loaded.source, budget());
  if (!counted.ok) return err(refusalError(failureRefusal(counted.reason)));
  if (counted.pageCount !== pages.length) {
    return err(serviceError('invalid', 'mark every page of the document'));
  }

  const versionId = latest.version.id;
  const accountId = proof.applicant.ownerAccountId;
  const maskRevision = randomUUID();
  const now = new Date();
  const outcome = await db.transaction(
    async (tx): Promise<{ kind: 'saved'; old: DerivedObject[] } | { kind: 'stale' }> => {
      // One save at a time per version, and only while it is still the latest one.
      await tx
        .select({ id: schema.documentVersions.id })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, versionId))
        .for('update');
      const newest = first(
        await tx
          .select({ id: schema.documentVersions.id })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, document.id))
          .orderBy(desc(schema.documentVersions.versionNumber))
          .limit(1),
      );
      if (newest?.id !== versionId) return { kind: 'stale' };
      const previous = await tx
        .delete(schema.redactionMasks)
        .where(eq(schema.redactionMasks.documentVersionId, versionId))
        .returning();
      const old = await derivedObjectsOf(tx, previous);
      await queueDerivedRemoval(tx, old, document.applicantId);
      await tx.insert(schema.redactionMasks).values(
        pages.map((boxes, index) => ({
          documentVersionId: versionId,
          page: index + 1,
          boxes,
          source:
            (input.pages[index]?.acceptedSuggestions ?? 0) > 0 ? 'SUGGESTED_ACCEPTED' : 'OWNER',
          createdByAccountId: accountId,
          maskRevision,
          createdAt: now,
          updatedAt: now,
        })),
      );
      await appendAuditEvent(tx, {
        eventType: 'DOCUMENT_REDACTION_SAVED',
        actorAccountId: null,
        actorRole: 'applicant_owner',
        action: 'MANAGE',
        result: 'ALLOWED',
        method: 'API',
        applicantId: document.applicantId,
        resourceType: 'document',
        resourceId: document.id,
        metadata: {
          documentVersionId: versionId,
          pageCount: pages.length,
          boxCount,
          nothingToHide: input.nothingToHide,
          acceptedSuggestions,
        },
      });
      return { kind: 'saved', old };
    },
  );
  if (outcome.kind === 'stale') return err(refusalError('out_of_date'));
  await deleteDerivedNow(deps, outcome.old);
  return ok({ versionId, pageCount: pages.length, boxCount, state: 'PREPARING', maskRevision });
}

/**
 * Removes every saved box and stored drawing from one version of the owner's document, so its
 * safe copy is "Not Prepared Yet" again. Needs only the owner's MANAGE proof and the version: the
 * file is not read, so it works even when the file can no longer be drawn. Audited with counts.
 */
export async function clearRedactionMasks(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: { readonly versionId: string },
  deps?: Pick<RedactionDeps, 'storage'>,
): Promise<Result<{ readonly pagesCleared: number }, SafeCopyError>> {
  const document = ownerDocument(proof, 'MANAGE');
  if (!document) return err(serviceError('forbidden', 'only the owner can change a safe copy'));
  const db = proof.tx;
  if (!(await redactionMasksTablePresent(db))) return err(refusalError('not_ready_yet'));
  const version = first(
    await db
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.id, input.versionId),
          eq(schema.documentVersions.documentId, document.id),
        ),
      )
      .limit(1),
  );
  if (!version) return err(serviceError('not_found', 'record not found'));
  const outcome = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.redactionMasks)
      .where(eq(schema.redactionMasks.documentVersionId, version.id))
      .returning();
    const old = await derivedObjectsOf(tx, removed);
    await queueDerivedRemoval(tx, old, document.applicantId);
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_REDACTION_CLEARED',
      actorAccountId: null,
      actorRole: 'applicant_owner',
      action: 'MANAGE',
      result: 'ALLOWED',
      method: 'API',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      metadata: {
        documentVersionId: version.id,
        pageCount: removed.length,
        boxCount: 0,
        nothingToHide: false,
        acceptedSuggestions: 0,
      },
    });
    return { pagesCleared: removed.length, old };
  });
  if (deps) await deleteDerivedNow(deps, outcome.old);
  return ok({ pagesCleared: outcome.pagesCleared });
}

// --- Preparing: each page drawn once ------------------------------------------------------------

export interface PreparedSafeCopyPage {
  readonly page: number;
  readonly pageCount: number;
  /** Pages drawn so far for this revision. */
  readonly preparedPages: number;
  readonly state: SafeCopyState;
}

/** The byte limit of one page, so all pages together fit the safe copy's output limit. */
function pageByteLimit(pageCount: number): number {
  return Math.floor((SAFE_COPY_MAX_OUTPUT_BYTES - PDF_STRUCTURE_BYTES) / Math.max(1, pageCount));
}

/**
 * Draws one page of the owner's saved boxes (the latest usable version, the named revision) with
 * the boxes painted black, and stores it as a private derived file. A page already drawn for this
 * revision is skipped, so the editor can resume. Refused as out of date when newer boxes or a
 * newer version have been saved. Owner only, with the MANAGE proof that saved the boxes.
 */
export async function prepareSafeCopyPage(
  proof: AuthorizedApplicant<'MANAGE'>,
  deps: RedactionDeps,
  input: { readonly versionId: string; readonly page: number; readonly maskRevision: string },
): Promise<Result<PreparedSafeCopyPage, SafeCopyError>> {
  const document = ownerDocument(proof, 'MANAGE');
  if (!document) return err(serviceError('forbidden', 'only the owner can prepare a safe copy'));
  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    input.page > REDACTION_LIMITS.maxPages
  ) {
    return err(serviceError('invalid', 'choose a page of this document'));
  }
  const db = proof.tx;
  if (!(await redactionMasksTablePresent(db))) return err(refusalError('not_ready_yet'));

  const progress = async (): Promise<Result<PreparedSafeCopyPage, SafeCopyError>> => {
    const rows = await readMasks(db, [input.versionId]);
    const marked = rows === 'missing' ? undefined : markedVersion(rows);
    if (!marked || marked.revision !== input.maskRevision) return err(refusalError('out_of_date'));
    return ok({
      page: input.page,
      pageCount: marked.pages.length,
      preparedPages: marked.pages.filter((page) => page.drawn).length,
      state: stateOf(marked),
    });
  };

  const rows = await readMasks(db, [input.versionId]);
  const marked = rows === 'missing' ? undefined : markedVersion(rows);
  if (!marked || marked.revision !== input.maskRevision) return err(refusalError('out_of_date'));
  const target = marked.pages[input.page - 1];
  if (!target) return err(serviceError('invalid', 'choose a page of this document'));
  if (target.drawn) return progress();

  const metadata = { variant: 'safe_copy_prepare', disposition: 'store', page: input.page };
  const loaded = await loadForOwner(
    proof,
    document,
    deps,
    'SAFE_COPY_PREPARE',
    metadata,
    input.versionId,
  );
  if (!loaded.ok) return loaded;
  if (loaded.value.pageCount !== marked.pages.length) return err(refusalError('out_of_date'));

  const drawn = await deps.renderer.renderMaskedPage(
    loaded.value.source,
    input.page,
    target.boxes,
    {
      ...budget(),
      maxBytes: pageByteLimit(marked.pages.length),
    },
  );
  if (!drawn.ok) {
    await audit(proof, document, {
      allowed: false,
      reason: `render_${drawn.reason}`,
      metadata,
      purposes: EDITOR_PURPOSES,
    });
    return err(refusalError(failureRefusal(drawn.reason)));
  }

  const objectKey = `${DERIVED_KEY_PREFIX}${randomUUID()}`;
  const sha256 = sha256Hex(drawn.bytes);
  const storageObjectId = await registerStorageObject(db, 'CLEAN', objectKey, drawn.bytes, sha256);
  const object = { storageObjectId, objectKey };
  try {
    await deps.storage.putObject({
      bucket: 'CLEAN',
      objectKey,
      contentType: drawn.contentType,
      bytes: drawn.bytes,
    });
    const stored = await deps.storage.getObject(objectKey);
    if (!stored || sha256Hex(stored.bytes) !== sha256) {
      await discardStorageObject(db, deps.storage, 'CLEAN', object);
      return err(refusalError('unreadable'));
    }
  } catch (error) {
    await discardStorageObject(db, deps.storage, 'CLEAN', object);
    throw error;
  }

  const recorded = await db
    .update(schema.redactionMasks)
    .set({
      renderedStorageObjectId: storageObjectId,
      renderedContentType: drawn.contentType,
      renderedByteSize: drawn.bytes.byteLength,
      renderedWidthPt: drawn.widthPt,
      renderedHeightPt: drawn.heightPt,
      renderedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.redactionMasks.id, target.row.id),
        eq(schema.redactionMasks.maskRevision, input.maskRevision),
        isNull(schema.redactionMasks.renderedStorageObjectId),
      ),
    )
    .returning({ id: schema.redactionMasks.id });
  if (recorded.length === 0) {
    // Newer boxes were saved, or another tab drew this page first: this drawing is not kept.
    await discardStorageObject(db, deps.storage, 'CLEAN', object);
    return progress();
  }
  const after = await progress();
  if (after.ok && isSafeCopyReady(after.value.state) && after.value.preparedPages > 0) {
    await audit(proof, document, {
      allowed: true,
      reason: null,
      metadata: { variant: 'safe_copy_prepared', pageCount: after.value.pageCount },
      purposes: EDITOR_PURPOSES,
    });
  }
  return after;
}

// --- The safe copy ----------------------------------------------------------------------------

export interface ProducedSafeCopy {
  readonly bytes: Uint8Array;
  readonly contentType: 'application/pdf' | 'image/png';
  readonly pageCount: number;
  /** A plain name that never carries the stored file name. */
  readonly filename: string;
}

/**
 * The safe copy of the proof's document: the stored drawings of every page of its latest usable
 * version, for the current revision, put together as an image-only PDF (or the one PNG of a
 * photo). Nothing is drawn here. Refused, and audited DENIED, unless every page is prepared, and
 * when any stored drawing is missing or does not match what was stored. Nothing unmasked is ever
 * returned.
 */
export async function produceSafeCopy(
  proof: AuthorizedApplicant<'DOWNLOAD_REDACTED'>,
  deps: RedactionDeps,
): Promise<Result<ProducedSafeCopy, SafeCopyError>> {
  if (!AuthorizedApplicant.isGenuine(proof, 'DOWNLOAD_REDACTED')) {
    return err(serviceError('forbidden', 'access denied'));
  }
  if (proof.resource.kind !== 'document') return err(serviceError('forbidden', 'access denied'));
  const document = proof.resource.document;
  if (document.applicantId !== proof.applicant.id) {
    return err(serviceError('forbidden', 'access denied'));
  }
  const limited = await withinLimit(proof, 'SAFE_COPY');
  if (!limited.ok) return limited;
  const requested = { variant: 'redacted', disposition: 'download' };
  const refuse = async (
    reason: string,
    refusal: SafeCopyRefusal,
  ): Promise<Result<never, SafeCopyError>> => {
    await audit(proof, document, { allowed: false, reason, metadata: requested });
    return err(refusalError(refusal));
  };

  const db = proof.tx;
  const latest = await latestUsableVersion(proof);
  if (latest.kind !== 'usable') return refuse(latest.reason, 'not_available');
  const rows = await readMasks(db, [latest.version.id]);
  if (rows === 'missing') return refuse('masks_not_ready', 'not_prepared');
  const marked = markedVersion(rows);
  const state = stateOf(marked);
  if (!marked || !isSafeCopyReady(state)) {
    return refuse(state === 'PREPARING' ? 'still_preparing' : 'not_prepared', 'not_prepared');
  }

  const ids = marked.pages.flatMap((page) =>
    page.row.renderedStorageObjectId ? [page.row.renderedStorageObjectId] : [],
  );
  const objects = new Map(
    (
      await db.select().from(schema.storageObjects).where(inArray(schema.storageObjects.id, ids))
    ).map((object) => [object.id, object]),
  );
  const images: SafeCopyPageImage[] = [];
  for (const page of marked.pages) {
    const row = page.row;
    const object = row.renderedStorageObjectId
      ? objects.get(row.renderedStorageObjectId)
      : undefined;
    const stored = object ? await deps.storage.getObject(object.objectKey) : undefined;
    const type = row.renderedContentType;
    if (
      !object ||
      !stored ||
      sha256Hex(stored.bytes) !== object.contentHash ||
      (type !== 'image/jpeg' && type !== 'image/png') ||
      row.renderedWidthPt === null ||
      row.renderedHeightPt === null
    ) {
      return refuse('stored_page_missing', 'not_prepared');
    }
    images.push({
      contentType: type,
      bytes: stored.bytes,
      widthPt: row.renderedWidthPt,
      heightPt: row.renderedHeightPt,
    });
  }
  const made = deps.renderer.assembleSafeCopy(images, SAFE_COPY_MAX_OUTPUT_BYTES);
  if (!made.ok) return refuse(`assemble_${made.reason}`, failureRefusal(made.reason));
  const boxCount = marked.pages.reduce((sum, page) => sum + page.boxes.length, 0);
  await audit(proof, document, {
    allowed: true,
    reason: null,
    metadata: {
      ...requested,
      pageCount: marked.pages.length,
      boxCount,
      outputType: made.contentType === 'application/pdf' ? 'pdf' : 'png',
    },
  });
  return ok({
    bytes: made.bytes,
    contentType: made.contentType,
    pageCount: marked.pages.length,
    filename: made.contentType === 'application/pdf' ? 'safe-copy.pdf' : 'safe-copy.png',
  });
}
