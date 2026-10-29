import { type Result, err, ok } from '@visastack/core';
import { fieldPolicyOf, resolveDocumentType } from '@visastack/core/catalogue';
import {
  REDACTION_LIMITS,
  type RedactionBox,
  padRedactionBox,
  parseRedactionBox,
} from '@visastack/core/redaction-boxes';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { AuthorizedApplicant, EACH_GRANT } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { hasActiveOrVerifiedErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';
import type { KeyManagementPort } from './ports';
import type {
  PositionedText,
  SafeCopyBudget,
  SafeCopyFailure,
  SafeCopyFailureReason,
  SafeCopyRendererPort,
  SafeCopySource,
} from './preview-rendering';
import { buildFactVersionAad, revealValue } from './protected-fields';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
import { redactionMasksTablePresent } from './redaction-table';
import type { BlobStore } from './storage';

/**
 * Safe copies (ADR 0022, S23). The record owner hides parts of a document with black boxes, page
 * by page; a safe copy is then drawn fresh from the stored file with those boxes painted solid
 * black, as pixels only. Nothing unmasked is ever served as a safe copy:
 *
 * - A version is prepared only when the owner saved boxes (or the explicit "Nothing to Hide on
 *   This Document") for every one of its pages. Otherwise it is "Not Prepared Yet" and nothing is
 *   made: no fallback, no partial copy.
 * - Boxes belong to one version. A new version starts with none (they are never copied, because
 *   the layout may differ), and boxes can be saved only on the latest version that is safe to use.
 * - Only the record owner edits boxes and sees the editor (an owner MANAGE or PREVIEW proof from
 *   the access gate). Page images for the editor show the page as stored, so they are the owner's
 *   alone: anyone else only ever receives the masked copy.
 * - The copy needs a DOWNLOAD_REDACTED proof ("Download Safe Copies"), decided by the gate
 *   exactly as for any download, a restricted document's fresh identity check included.
 * - Suggestions read the file's own text and the owner's own identity numbers in memory only,
 *   and return box positions, never the values.
 * - Audit events hold counts only: never box positions, image data or identity numbers.
 * - Until migration 0102 runs, everything reads "Not Prepared Yet" and saving says safe copies
 *   are not ready yet.
 */

export const SAFE_COPY_TOO_LARGE_MESSAGE = 'This document is too large for a safe copy';

/**
 * The detail a renderer gives when the masks do not cover exactly the file's pages. The service
 * then answers "Not Prepared Yet" rather than "could not be read".
 */
export const MASKS_MISMATCH_DETAIL = 'masks do not cover exactly the pages of this file';

/** For tests and adapters: a failure with the mismatch detail. */
export function masksMismatch(): SafeCopyFailure {
  return { ok: false, reason: 'unreadable', detail: MASKS_MISMATCH_DETAIL };
}

/** The safe copy is held to this many bytes so it stays inside the hosting response limit. */
export const SAFE_COPY_MAX_OUTPUT_BYTES = 4_000_000;

/**
 * Where a document's safe copy stands. `NOT_PREPARED`: the owner has not marked every page yet.
 * `MASKED`: every page is marked and at least one box hides something. `NOTHING_TO_HIDE`: the
 * owner chose "Nothing to Hide on This Document". `UNSUPPORTED`: a kind of file a safe copy cannot
 * be made from (documents and text files). `TOO_LARGE`: past the page or size limit.
 */
export type SafeCopyState =
  | 'NOT_PREPARED'
  | 'MASKED'
  | 'NOTHING_TO_HIDE'
  | 'UNSUPPORTED'
  | 'TOO_LARGE';

/** Why a safe copy request was refused, so the web layer can answer in plain words. */
export type SafeCopyRefusal =
  | 'not_prepared'
  | 'not_available'
  | 'too_large'
  | 'unsupported'
  | 'unreadable'
  | 'not_ready_yet'
  | 'out_of_date';

export interface SafeCopyError extends ServiceError {
  readonly refusal?: SafeCopyRefusal;
}

export interface RedactionDeps {
  readonly storage: Pick<BlobStore, 'getObject'>;
  readonly renderer: SafeCopyRendererPort;
  /** Decrypts the owner's protected identity numbers for suggestions; absent means none are read. */
  readonly encryption?: KeyManagementPort | undefined;
  /** The clock the time budget is measured on; the renderer must use the same one. */
  readonly now?: () => number;
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

type DocumentRow = typeof schema.documents.$inferSelect;
type VersionRow = typeof schema.documentVersions.$inferSelect;
type MaskRow = typeof schema.redactionMasks.$inferSelect;
type AnyProof =
  | AuthorizedApplicant<'VIEW_METADATA'>
  | AuthorizedApplicant<'PREVIEW'>
  | AuthorizedApplicant<'MANAGE'>
  | AuthorizedApplicant<'DOWNLOAD_REDACTED'>;

function clock(deps: Pick<RedactionDeps, 'now'>): number {
  return deps.now ? deps.now() : Date.now();
}

function budget(deps: Pick<RedactionDeps, 'now'>): SafeCopyBudget {
  return {
    deadline: clock(deps) + REDACTION_LIMITS.renderBudgetMs,
    maxPages: REDACTION_LIMITS.maxPages,
  };
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

function auditActor(proof: AnyProof): {
  readonly actorAccountId: string | null;
  readonly actorRole: string;
  readonly subjectAccountId: string;
} {
  const actor = proof.actor;
  switch (actor.kind) {
    case 'applicant_owner':
      return {
        actorAccountId: null,
        actorRole: 'applicant_owner',
        subjectAccountId: proof.applicant.ownerAccountId,
      };
    case 'organization_member':
      return {
        actorAccountId: actor.accountId,
        actorRole: `org:${actor.membership.role}`,
        subjectAccountId: actor.accountId,
      };
    case 'individual_recipient':
      return {
        actorAccountId: actor.accountId,
        actorRole: 'individual_recipient',
        subjectAccountId: actor.accountId,
      };
    case 'support_admin':
      return {
        actorAccountId: actor.accountId,
        actorRole: 'support_admin',
        subjectAccountId: actor.accountId,
      };
    case 'contributor':
      return {
        actorAccountId: actor.accountId,
        actorRole: 'contributor',
        subjectAccountId: actor.accountId,
      };
  }
}

function purposeText(proof: AnyProof, ownerPurpose: string): string {
  if (proof.actor.kind === 'applicant_owner') return ownerPurpose;
  return proof.purpose === EACH_GRANT ? 'shared_safe_copy' : proof.purpose;
}

/** One DOCUMENT_ACCESS event: what was asked for and the outcome, never image data. */
async function writeAccessAudit(
  proof: AnyProof,
  document: DocumentRow,
  event: {
    readonly allowed: boolean;
    readonly reason: string | null;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly ownerPurpose: string;
  },
): Promise<void> {
  const who = auditActor(proof);
  await proof.tx.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_ACCESS',
      actorAccountId: who.actorAccountId,
      actorRole: who.actorRole,
      action: proof.action,
      result: event.allowed ? 'ALLOWED' : 'DENIED',
      method: 'API',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      reason: event.reason,
      metadata: { ...event.metadata, purpose: purposeText(proof, event.ownerPurpose) },
    });
  });
}

async function withinLimit(
  proof: AnyProof,
  bucket: 'SAFE_COPY' | 'REDACTION_PAGE' | 'REDACTION_SAVE',
): Promise<Result<true, ServiceError>> {
  const who = auditActor(proof);
  const labels = {
    SAFE_COPY: { action: 'safe_copy', label: 'safe copy' },
    REDACTION_PAGE: { action: 'redaction_page', label: 'page view' },
    REDACTION_SAVE: { action: 'redaction_save', label: 'save' },
  } as const;
  const { action, label } = labels[bucket];
  const limit = await checkRateLimit(
    proof.tx,
    { subjectId: who.subjectAccountId, action, label },
    RATE_LIMITS[bucket],
  );
  return limit.allowed ? ok(true) : err(serviceError('rate_limited', limit.reason));
}

// --- Versions, bytes and masks ----------------------------------------------------------------

type LatestVersion =
  | { readonly kind: 'usable'; readonly version: VersionRow }
  | { readonly kind: 'refused'; readonly reason: string };

/** The document's latest version, only when it is safe to use (scanned clean, not erased). */
async function latestUsableVersion(db: Db, documentId: string): Promise<LatestVersion> {
  const version = first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId))
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1),
  );
  if (!version) return { kind: 'refused', reason: 'no_stored_version' };
  const erased = await hasActiveOrVerifiedErasureJob(db, version.storageObjectId);
  if (erased) return { kind: 'refused', reason: 'bytes_already_erased' };
  const usable = isDocumentVersionUsable({
    safetyStatus: version.safetyStatus,
    processingStatus: version.processingStatus,
    erased,
  });
  return usable
    ? { kind: 'usable', version }
    : { kind: 'refused', reason: 'not_yet_safe_to_serve' };
}

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

/** Every mask row of one version, by page; `missing` before migration 0102 has run. */
async function readMasks(db: Db, versionIds: readonly string[]): Promise<MaskRow[] | 'missing'> {
  if (!(await redactionMasksTablePresent(db))) return 'missing';
  if (versionIds.length === 0) return [];
  return db
    .select()
    .from(schema.redactionMasks)
    .where(inArray(schema.redactionMasks.documentVersionId, [...versionIds]))
    .orderBy(asc(schema.redactionMasks.documentVersionId), asc(schema.redactionMasks.page));
}

/**
 * The boxes of a fully prepared version, one list per page, or undefined when the rows do not
 * cover exactly pages 1 to N (N is checked against the file itself before anything is served).
 * A stored list that is not a list of valid boxes makes the whole version unprepared: never
 * serve a copy with a box quietly dropped.
 */
function preparedPages(rows: readonly MaskRow[]): RedactionBox[][] | undefined {
  if (rows.length === 0 || rows.length > REDACTION_LIMITS.maxPages) return undefined;
  const sorted = [...rows].sort((a, b) => a.page - b.page);
  const pages: RedactionBox[][] = [];
  for (const [index, row] of sorted.entries()) {
    if (row.page !== index + 1) return undefined;
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
    pages.push(boxes);
  }
  return pages;
}

function stateOfRows(rows: readonly MaskRow[]): SafeCopyState {
  const pages = preparedPages(rows);
  if (!pages) return 'NOT_PREPARED';
  return pages.every((boxes) => boxes.length === 0) ? 'NOTHING_TO_HIDE' : 'MASKED';
}

function failureRefusal(reason: SafeCopyFailureReason): SafeCopyRefusal {
  switch (reason) {
    case 'too_large':
    case 'out_of_time':
      return 'too_large';
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
        ...serviceError('stale', 'a newer version of this document has been added'),
        refusal,
      };
    case 'not_available':
      return { ...serviceError('forbidden', 'this document is not available yet'), refusal };
  }
}

// --- States -----------------------------------------------------------------------------------

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
  const states = new Map<string, SafeCopyState>();
  if (ids.length === 0) return ok(states);
  const db = proof.tx;
  const owned = and(
    inArray(schema.documentVersions.id, ids),
    eq(schema.documents.applicantId, proof.applicant.id),
    ...(proof.resource.kind === 'document'
      ? [eq(schema.documents.id, proof.resource.document.id)]
      : []),
  );
  const versions = await db
    .select({
      id: schema.documentVersions.id,
      pages: schema.documentVersions.pages,
      sizeBytes: schema.documentVersions.sizeBytes,
      originalName: schema.documents.originalName,
    })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(owned);
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
      states.set(version.id, stateOfRows(byVersion.get(version.id) ?? []));
    }
  }
  return ok(states);
}

/**
 * Where the safe copy of the proof's one document stands, judged on its latest version that is
 * safe to use: what a person with "Download Safe Copies" is offered. A version not yet safe to
 * use reads NOT_PREPARED.
 */
export async function getSafeCopyState(
  proof: AuthorizedApplicant<'DOWNLOAD_REDACTED'>,
): Promise<Result<SafeCopyState, ServiceError>> {
  if (!AuthorizedApplicant.isGenuine(proof, 'DOWNLOAD_REDACTED')) {
    return err(serviceError('forbidden', 'access denied'));
  }
  if (proof.resource.kind !== 'document') return err(serviceError('forbidden', 'access denied'));
  const latest = await latestUsableVersion(proof.tx, proof.resource.document.id);
  if (latest.kind !== 'usable') return ok('NOT_PREPARED');
  const listed = await listRedactionStates(proof, [latest.version.id]);
  if (!listed.ok) return listed;
  return ok(listed.value.get(latest.version.id) ?? 'NOT_PREPARED');
}

// --- The owner's editor -----------------------------------------------------------------------

export interface RedactionEditorView {
  readonly documentId: string;
  readonly versionId: string;
  readonly pageCount: number;
  readonly state: SafeCopyState;
  /** Saved boxes, one list per page, only when they still cover every page of this version. */
  readonly savedPages: readonly (readonly RedactionBox[])[] | null;
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
 * Shared checks for the editor's reads: a genuine owner proof, within the page bucket, on the
 * latest usable version (and the one the editor asked about, when it names one), whose file is a
 * PDF or image within the limits. Refusals after the gate are audited DENIED, without image data.
 */
async function loadForOwner(
  proof: AuthorizedApplicant<'PREVIEW'>,
  deps: RedactionDeps,
  metadata: Readonly<Record<string, unknown>>,
  expectedVersionId: string | undefined,
): Promise<Result<OwnerLoaded, SafeCopyError>> {
  const document = ownerDocument(proof, 'PREVIEW');
  if (!document) return err(serviceError('forbidden', 'only the owner can prepare a safe copy'));
  const limited = await withinLimit(proof, 'REDACTION_PAGE');
  if (!limited.ok) return limited;
  const audit = (reason: string) =>
    writeAccessAudit(proof, document, {
      allowed: false,
      reason,
      metadata,
      ownerPurpose: 'owner_safe_copy_editor',
    });
  const latest = await latestUsableVersion(proof.tx, document.id);
  if (latest.kind !== 'usable') {
    await audit(latest.reason);
    return err(refusalError('not_available'));
  }
  if (expectedVersionId !== undefined && expectedVersionId !== latest.version.id) {
    await audit('version_out_of_date');
    return err(refusalError('out_of_date'));
  }
  const loaded = await loadSource(proof.tx, deps, latest.version);
  if (!loaded.ok) {
    await audit(loaded.reason);
    return err(
      refusalError(loaded.reason === 'stored_object_missing' ? 'not_available' : loaded.reason),
    );
  }
  const counted = await deps.renderer.pageCount(loaded.source, budget(deps));
  if (!counted.ok) {
    await audit(`render_${counted.reason}`);
    return err(refusalError(failureRefusal(counted.reason)));
  }
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
  const metadata = { variant: 'redaction_editor', disposition: 'preview' };
  const loaded = await loadForOwner(proof, deps, metadata, undefined);
  if (!loaded.ok) return loaded;
  const { document, version, pageCount } = loaded.value;
  const rows = await readMasks(proof.tx, [version.id]);
  const pages = rows === 'missing' ? undefined : preparedPages(rows);
  const savedPages = pages && pages.length === pageCount ? pages : null;
  const state: SafeCopyState = savedPages
    ? savedPages.every((boxes) => boxes.length === 0)
      ? 'NOTHING_TO_HIDE'
      : 'MASKED'
    : 'NOT_PREPARED';
  await writeAccessAudit(proof, document, {
    allowed: true,
    reason: null,
    metadata: { ...metadata, pageCount },
    ownerPurpose: 'owner_safe_copy_editor',
  });
  return ok({
    documentId: document.id,
    versionId: version.id,
    pageCount,
    state,
    savedPages,
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
  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    input.page > REDACTION_LIMITS.maxPages
  ) {
    return err(serviceError('invalid', 'choose a page of this document'));
  }
  const metadata = { variant: 'redaction_page', disposition: 'preview', page: input.page };
  const loaded = await loadForOwner(proof, deps, metadata, input.versionId);
  if (!loaded.ok) return loaded;
  const { document, source, pageCount } = loaded.value;
  if (input.page > pageCount) return err(serviceError('invalid', 'choose a page of this document'));
  const rendered = await deps.renderer.renderPage(source, input.page, budget(deps));
  if (!rendered.ok) {
    await writeAccessAudit(proof, document, {
      allowed: false,
      reason: `render_${rendered.reason}`,
      metadata,
      ownerPurpose: 'owner_safe_copy_editor',
    });
    return err(refusalError(failureRefusal(rendered.reason)));
  }
  await writeAccessAudit(proof, document, {
    allowed: true,
    reason: null,
    metadata,
    ownerPurpose: 'owner_safe_copy_editor',
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

/** A machine-readable passport line: 30 to 44 of A to Z, 0 to 9 and "<", with filler. */
const MRZ_LINE = /^[A-Z0-9<]{28,44}$/;
/** An IBAN: country, check digits, then 11 to 30 letters or digits. */
const IBAN = /[A-Z]{2}\d{2}[A-Z0-9]{11,30}/;
/** An account number: 8 to 20 digits, possibly split by spaces or hyphens. */
const ACCOUNT_NUMBER = /\d(?:[\s-]?\d){7,19}/;
const MIN_IDENTIFIER_LENGTH = 4;
const MAX_TEXT_ITEM_LENGTH = 500;

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
 * memory for this one request and never logged, returned or stored.
 */
async function ownIdentifiers(
  db: Db,
  applicantId: string,
  encryption: KeyManagementPort | undefined,
): Promise<string[]> {
  const rows = await db
    .select({
      factId: schema.facts.id,
      fieldKey: schema.fieldDefinitions.key,
      factVersionId: schema.factVersions.id,
      value: schema.factVersions.value,
      valueCiphertext: schema.factVersions.valueCiphertext,
      valueNonce: schema.factVersions.valueNonce,
      protectedKeyVersion: schema.factVersions.protectedKeyVersion,
    })
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
    let text: string | null = row.value;
    if (row.protectedKeyVersion !== null) {
      if (!encryption || !row.valueCiphertext || !row.valueNonce) continue;
      try {
        text = await revealValue(db, encryption, {
          ciphertext: row.valueCiphertext,
          nonce: row.valueNonce,
          keyVersion: row.protectedKeyVersion,
          aad: buildFactVersionAad({
            applicantId,
            factId: row.factId,
            fieldKey: row.fieldKey,
            factVersionId: row.factVersionId,
          }),
        });
      } catch {
        // A value that cannot be read gives no suggestion; nothing about it is reported.
        continue;
      }
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

function textReason(
  item: PositionedText,
  identifiers: readonly string[],
  financial: boolean,
): RedactionSuggestionReason | undefined {
  const raw = item.text.slice(0, MAX_TEXT_ITEM_LENGTH);
  const tight = raw.toUpperCase().replace(/\s/g, '');
  if (MRZ_LINE.test(tight) && tight.includes('<<')) return 'mrz';
  const letters = compact(raw);
  if (matchesIdentifier(letters, identifiers)) return 'identifier';
  if (financial && (IBAN.test(letters) || ACCOUNT_NUMBER.test(raw))) return 'account_number';
  return undefined;
}

/**
 * Suggested boxes for the owner's latest version: the passport's machine-readable lines (from
 * the file's own text, and the usual band on the first page of a passport), the owner's own
 * identity numbers, and account numbers on financial documents. Suggestions only: nothing is
 * saved, and the owner accepts, moves or removes each one. Positions come from the PDF's own text
 * layer, read on request and never stored; a scanned image has none, so only the passport band is
 * offered there.
 */
export async function suggestRedactions(
  proof: AuthorizedApplicant<'PREVIEW'>,
  deps: RedactionDeps,
  input: { readonly versionId: string },
): Promise<Result<readonly RedactionSuggestion[], SafeCopyError>> {
  const metadata = { variant: 'redaction_suggestions', disposition: 'preview' };
  const loaded = await loadForOwner(proof, deps, metadata, input.versionId);
  if (!loaded.ok) return loaded;
  const { document, source, pageCount } = loaded.value;
  const suggestions: RedactionSuggestion[] = [];
  const perPage = new Map<number, number>();
  const add = (page: number, box: RedactionBox, reason: RedactionSuggestionReason) => {
    const count = perPage.get(page) ?? 0;
    if (count >= REDACTION_LIMITS.maxBoxesPerPage) return;
    perPage.set(page, count + 1);
    suggestions.push({ page, box, reason });
  };
  if (isPassportKind(document.docType)) add(1, MRZ_BAND, 'mrz');

  if (source.contentType === 'application/pdf') {
    const text = await deps.renderer.textPositions(source, budget(deps));
    if (text.ok) {
      const identifiers = await ownIdentifiers(proof.tx, document.applicantId, deps.encryption);
      const financial = isFinancialKind(document.docType);
      for (const [index, items] of text.pages.entries()) {
        const page = index + 1;
        if (page > pageCount) break;
        for (const item of items) {
          const reason = textReason(item, identifiers, financial);
          if (!reason) continue;
          const box = parseRedactionBox(padRedactionBox(item.box, 0.006, 0.004));
          if (box) add(page, box, reason);
        }
      }
    }
  }
  await writeAccessAudit(proof, document, {
    allowed: true,
    reason: null,
    metadata: { ...metadata, suggestionCount: suggestions.length },
    ownerPurpose: 'owner_safe_copy_editor',
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
  readonly state: 'MASKED' | 'NOTHING_TO_HIDE';
}

/**
 * Saves the owner's boxes for every page of the latest usable version, replacing what was saved
 * before, in one transaction with its audit event (counts only). Refused unless the pages sent
 * cover exactly the pages of the file: a partial save would leave a page nobody looked at.
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
  const latest = await latestUsableVersion(db, document.id);
  if (latest.kind !== 'usable') return err(refusalError('not_available'));
  if (latest.version.id !== input.versionId) return err(refusalError('out_of_date'));
  const loaded = await loadSource(db, deps, latest.version);
  if (!loaded.ok) {
    return err(
      refusalError(loaded.reason === 'stored_object_missing' ? 'not_available' : loaded.reason),
    );
  }
  const counted = await deps.renderer.pageCount(loaded.source, budget(deps));
  if (!counted.ok) return err(refusalError(failureRefusal(counted.reason)));
  if (counted.pageCount !== pages.length) {
    return err(serviceError('invalid', 'mark every page of the document'));
  }

  const versionId = latest.version.id;
  const accountId = proof.applicant.ownerAccountId;
  const now = new Date();
  const outcome = await db.transaction(async (tx): Promise<'saved' | 'stale'> => {
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
    if (newest?.id !== versionId) return 'stale';
    await tx
      .delete(schema.redactionMasks)
      .where(eq(schema.redactionMasks.documentVersionId, versionId));
    await tx.insert(schema.redactionMasks).values(
      pages.map((boxes, index) => ({
        documentVersionId: versionId,
        page: index + 1,
        boxes,
        source: (input.pages[index]?.acceptedSuggestions ?? 0) > 0 ? 'SUGGESTED_ACCEPTED' : 'OWNER',
        createdByAccountId: accountId,
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
    return 'saved';
  });
  if (outcome === 'stale') return err(refusalError('out_of_date'));
  return ok({
    versionId,
    pageCount: pages.length,
    boxCount,
    state: input.nothingToHide ? 'NOTHING_TO_HIDE' : 'MASKED',
  });
}

/**
 * Removes every saved box from one version of the owner's document, so its safe copy is "Not
 * Prepared Yet" again. Audited with counts only.
 */
export async function clearRedactionMasks(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: { readonly versionId: string },
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
  const pagesCleared = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.redactionMasks)
      .where(eq(schema.redactionMasks.documentVersionId, version.id))
      .returning({ boxes: schema.redactionMasks.boxes });
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
    return removed.length;
  });
  return ok({ pagesCleared });
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
 * The safe copy of the proof's document: its latest usable version drawn fresh with the owner's
 * boxes painted solid black, as an image-only PDF (or one PNG for an image). Made on request and
 * never stored. Refused, and audited DENIED, unless the owner prepared every page of exactly this
 * version; any problem while drawing refuses too. Nothing unmasked is ever returned.
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
    await writeAccessAudit(proof, document, {
      allowed: false,
      reason,
      metadata: requested,
      ownerPurpose: 'owner_safe_copy',
    });
    return err(refusalError(refusal));
  };

  const db = proof.tx;
  const latest = await latestUsableVersion(db, document.id);
  if (latest.kind !== 'usable') return refuse(latest.reason, 'not_available');
  const rows = await readMasks(db, [latest.version.id]);
  if (rows === 'missing') return refuse('masks_not_ready', 'not_prepared');
  const pages = preparedPages(rows);
  if (!pages) return refuse('not_prepared', 'not_prepared');
  const loaded = await loadSource(db, deps, latest.version);
  if (!loaded.ok) {
    return refuse(
      loaded.reason,
      loaded.reason === 'stored_object_missing' ? 'not_available' : loaded.reason,
    );
  }
  const made = await deps.renderer.renderSafeCopy(loaded.source, pages, {
    ...budget(deps),
    maxOutputBytes: SAFE_COPY_MAX_OUTPUT_BYTES,
  });
  if (!made.ok) {
    return made.reason === 'unreadable' && made.detail === MASKS_MISMATCH_DETAIL
      ? refuse('masks_do_not_cover_pages', 'not_prepared')
      : refuse(`render_${made.reason}`, failureRefusal(made.reason));
  }
  if (made.pageCount !== pages.length || made.bytes.byteLength > SAFE_COPY_MAX_OUTPUT_BYTES) {
    return refuse('render_output_mismatch', 'unreadable');
  }
  const boxCount = pages.reduce((sum, boxes) => sum + boxes.length, 0);
  await writeAccessAudit(proof, document, {
    allowed: true,
    reason: null,
    metadata: {
      ...requested,
      pageCount: made.pageCount,
      boxCount,
      outputType: made.contentType === 'application/pdf' ? 'pdf' : 'png',
    },
    ownerPurpose: 'owner_safe_copy',
  });
  return ok({
    bytes: made.bytes,
    contentType: made.contentType,
    pageCount: made.pageCount,
    filename: made.contentType === 'application/pdf' ? 'safe-copy.pdf' : 'safe-copy.png',
  });
}
