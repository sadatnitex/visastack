import { createHash, randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { GuestCollectionSessionProof } from './access/guest-collection';
import { guestUploadsPresent } from './access/guest-submission-access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import type { ContentLimitsPort, MalwareScannerPort } from './intake';
import { enqueueNotificationBothChannels } from './notifications';
import { OPEN_ORGANIZATION_STATUSES } from './organization-admission';
import { RATE_LIMITS, checkRateLimits } from './rate-limit';
import type { BlobStore } from './storage';
import { registerStorageObject } from './storage-objects';
import {
  type CollectionItem,
  parseBrandSnapshot,
  parseItems,
  revisionContentSha256,
} from './umpe-collection-request-items';
import { sanitizeOriginalFileName } from './umpe-document-names';
import { isUploadId } from './umpe-document-receipts';
import {
  type GuestChecklistItem,
  type GuestRetentionDays,
  type VerifiedGuestDesk,
  isGuestRetentionDays,
  verifiedGuestDesk,
} from './umpe-guest-collection';

/**
 * Guest uploads and the exact submission (UMPE P9, ADR 0026 D5). A verified guest adds files to
 * one agency request with no account, applicant, document or case: every row here is scoped to
 * the request and to `recipient_key` (the SHA-256 of the address the guest proved). Nothing reads
 * or writes a person table.
 *
 * - Storing: the same byte checks the vault upload route runs happen in the web route first; here
 *   the bytes go to private storage under an opaque key, are read back and hashed, then pass the
 *   configured safety scanner and the content limits (page and pixel counts), synchronously,
 *   before the file may be mapped or sent. A file the structural check passed without a real virus
 *   scanner is stored as such (`virus_scanned` false) and the agency is told so: nothing claims a
 *   scan that did not happen. A refused file keeps no bytes.
 * - Repeats: each file carries the browser's upload id on every attempt (UMPE P3). A repeat of a
 *   stored file answers with it; one still being stored answers "not yet" (the queue waits and asks
 *   again); a claim left stale for two minutes is taken over. So a retry never stores a second copy.
 * - Mapping: the file name proposes one issued item when exactly one fits; the guest confirms or
 *   corrects it. No AI or other outside service is called.
 * - Submit Documents: freezes the exact files (by id and SHA-256), the issued revision, the
 *   retention choice and the consent wording into an immutable submission, with a Still Missing
 *   line for every item left empty. A correction is the next submission; earlier ones stay.
 *
 * Every refusal for a session that is not verified and live reads exactly like a missing request.
 */

/** At most this many files (not removed) per guest per request, and this many bytes in all. */
export const GUEST_MAX_FILES = 250;
export const GUEST_MAX_TOTAL_BYTES = 500 * 1024 * 1024;
/** A claim not finished within this long is taken over by the next attempt. */
export const GUEST_UPLOAD_CLAIM_STALE_MS = 2 * 60 * 1000;
/** The words the guest agrees to when they submit; stored with every submission. */
export const GUEST_CONSENT_VERSION = 'guest-submit-2026-11-02';
export const GUEST_CONSENT_TEXT =
  'I am sending these files to this agency for this request only. The agency may keep them for the period I chose after the request closes, unless the law requires them to keep them longer.';

const SAFETY = { receiving: 'RECEIVING', clean: 'CLEAN', rejected: 'REJECTED' } as const;

function missing(): ServiceError {
  return serviceError('not_found', 'no such document request');
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The checks a guest file passes before it may be mapped or sent. */
export interface GuestFileChecks {
  readonly scanner: MalwareScannerPort;
  readonly contentLimits: ContentLimitsPort;
  /** True only when `scanner` is a real virus scanner, not the structural check alone. */
  readonly virusScanner: boolean;
}

// --- Mapping proposals (pure) -------------------------------------------------------------------

/** Words a file name may use for common requested documents, by document kind. */
const KIND_WORDS: Readonly<Record<string, readonly string[]>> = {
  passport: ['passport', 'pp', 'biodata'],
  bank_statement: ['bank', 'statement', 'statements', 'solvency'],
  photo: ['photo', 'photograph', 'picture', 'selfie'],
  flight: ['flight', 'ticket', 'itinerary', 'airline'],
  hotel: ['hotel', 'booking', 'reservation', 'accommodation'],
  employment: ['employment', 'employer', 'noc', 'salary', 'payslip', 'leave'],
  tax: ['tax', 'itr', 'return', 'tin'],
  insurance: ['insurance', 'policy'],
  invitation: ['invitation', 'invite', 'sponsor'],
  national_id: ['nid', 'national', 'identity'],
};

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w));
}

function itemWords(item: Pick<CollectionItem, 'label' | 'docType'>): Set<string> {
  const found = new Set([...words(item.label), ...words(item.docType ?? '')]);
  for (const [kind, extra] of Object.entries(KIND_WORDS)) {
    const kindWords = kind.split('_');
    if (kindWords.every((w) => found.has(w)) || (item.docType ?? '').toLowerCase().includes(kind)) {
      for (const w of extra) found.add(w);
    }
  }
  // Words too common to tell items apart.
  for (const w of ['of', 'the', 'and', 'or', 'copy', 'document', 'documents', 'letter', 'your']) {
    found.delete(w);
  }
  return found;
}

/**
 * The one issued item a file name fits, or null when none fits or more than one fits equally (the
 * guest then chooses). Deterministic: the same name and checklist always give the same answer.
 */
export function proposeGuestItem(
  fileName: string,
  items: readonly Pick<CollectionItem, 'id' | 'label' | 'docType'>[],
): string | null {
  const nameWords = new Set(words(fileName.replace(/\.[a-z0-9]{1,5}$/i, '')));
  if (nameWords.size === 0) return null;
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  for (const item of items) {
    let score = 0;
    for (const w of itemWords(item)) if (nameWords.has(w)) score++;
    if (score > bestScore) {
      best = item.id;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) {
      tie = true;
    }
  }
  return bestScore > 0 && !tie ? best : null;
}

// --- The issued checklist of a verified desk -----------------------------------------------------

/** The items the desk's revision issued, or null when the stored revision is not intact. */
async function issuedItems(db: Db, desk: VerifiedGuestDesk): Promise<CollectionItem[] | null> {
  const revision = first(
    await db
      .select()
      .from(schema.agencyCollectionRequestRevisions)
      .where(
        and(
          eq(schema.agencyCollectionRequestRevisions.id, desk.revisionId),
          eq(schema.agencyCollectionRequestRevisions.requestId, desk.requestId),
        ),
      )
      .limit(1),
  );
  if (!revision) return null;
  const items = parseItems(revision.items);
  const brand = parseBrandSnapshot(revision.brandSnapshot);
  if (!items || brand === 'invalid') return null;
  const intact =
    revisionContentSha256({
      requestId: revision.requestId,
      revisionNo: revision.revisionNo,
      packVersionId: revision.packVersionId,
      packChecksum: revision.packChecksum,
      items,
      brandSnapshot: brand,
    }) === revision.contentSha256;
  return intact ? [...items].sort((a, b) => a.order - b.order) : null;
}

/** A verified desk whose P9 tables exist, or null. */
async function uploadDesk(
  db: Db,
  proof: GuestCollectionSessionProof,
  now: Date,
): Promise<VerifiedGuestDesk | null> {
  if (!(await guestUploadsPresent(db))) return null;
  return verifiedGuestDesk(db, proof, now);
}

function guestAudit(
  tx: Db,
  desk: VerifiedGuestDesk,
  eventType: string,
  metadata: Record<string, string | number | boolean> = {},
  result: 'ALLOWED' | 'DENIED' = 'ALLOWED',
) {
  return appendAuditEvent(tx, {
    eventType,
    actorAccountId: null,
    method: 'MANUAL',
    result,
    resourceType: 'agency_collection_request',
    resourceId: desk.requestId,
    metadata: { organizationId: desk.organizationId, ...metadata },
  });
}

/** This guest's own files of this request: the WHERE every file query starts from. */
function ownFiles(desk: VerifiedGuestDesk) {
  return and(
    eq(schema.agencyCollectionGuestFiles.requestId, desk.requestId),
    eq(schema.agencyCollectionGuestFiles.organizationId, desk.organizationId),
    eq(schema.agencyCollectionGuestFiles.recipientKey, desk.recipientKey),
  );
}

// --- Adding a file -------------------------------------------------------------------------------

/** `stalled`: an upload that stopped before its checks finished; the guest removes it and adds it again. */
export type GuestFileStatus = 'checking' | 'ready' | 'refused' | 'stalled';

export interface GuestFileView {
  readonly id: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly status: GuestFileStatus;
  /** Whether a real virus scanner checked it (false: the file structure was checked only). */
  readonly virusScanned: boolean;
  readonly itemId: string | null;
  /** 'proposed': suggested from the file name and not yet confirmed by the guest. */
  readonly mapping: 'proposed' | 'chosen' | null;
  /** Held by a submission already sent, so removing it only hides it from the next one. */
  readonly sent: boolean;
}

/** Whether a row still being received was left by an attempt that stopped (past the claim window). */
function stalled(row: Pick<FileRow, 'safetyStatus' | 'updatedAt'>, now: Date): boolean {
  return (
    row.safetyStatus === SAFETY.receiving &&
    now.getTime() - row.updatedAt.getTime() >= GUEST_UPLOAD_CLAIM_STALE_MS
  );
}

function statusOf(row: Pick<FileRow, 'safetyStatus' | 'updatedAt'>, now: Date): GuestFileStatus {
  if (row.safetyStatus === SAFETY.clean) return 'ready';
  if (row.safetyStatus === SAFETY.rejected) return 'refused';
  return stalled(row, now) ? 'stalled' : 'checking';
}

/**
 * Remove stored bytes, then their registration once the bytes are gone, so a failed delete stays
 * findable by the orphan sweep (the rule `storage-objects.ts` follows). True when both went.
 */
async function discardGuestObject(
  db: Db,
  storage: Pick<BlobStore, 'deleteObject'>,
  objectKey: string,
): Promise<boolean> {
  try {
    await storage.deleteObject('QUARANTINE', objectKey);
    await db.delete(schema.storageObjects).where(eq(schema.storageObjects.objectKey, objectKey));
    return true;
  } catch {
    return false;
  }
}

type FileRow = typeof schema.agencyCollectionGuestFiles.$inferSelect;

function fileView(row: FileRow, sent: boolean, now: Date): GuestFileView {
  return {
    id: row.id,
    name: row.originalName,
    sizeBytes: row.sizeBytes,
    status: statusOf(row, now),
    virusScanned: row.virusScanned,
    itemId: row.itemId,
    mapping: row.itemId === null ? null : row.mappingSource === 'GUEST' ? 'chosen' : 'proposed',
    sent,
  };
}

export interface AddGuestFileInput {
  readonly uploadId: unknown;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly originalName: unknown;
  readonly checks: GuestFileChecks;
}

export type AddGuestFileOutcome =
  | { readonly kind: 'stored'; readonly file: GuestFileView; readonly replay: boolean }
  | { readonly kind: 'refused'; readonly file: GuestFileView; readonly message: string };

export type AddGuestFileRefusal =
  | ServiceError
  | { readonly code: 'in_progress'; readonly message: string; readonly retryAfterSeconds: number };

const IN_PROGRESS = (retryAfterSeconds: number) =>
  ({
    code: 'in_progress' as const,
    message: 'This file is still being added. It will be checked again in a moment.',
    retryAfterSeconds,
  }) as const;

/**
 * Store one file for a verified guest, check it, and propose the item it fits. Idempotent on the
 * browser's upload id (see the module note). Counted per link.
 */
export async function addGuestFile(
  db: Db,
  storage: BlobStore,
  proof: GuestCollectionSessionProof,
  input: AddGuestFileInput,
  now: Date = new Date(),
): Promise<Result<AddGuestFileOutcome, AddGuestFileRefusal>> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return err(missing());
  const desk = await uploadDesk(db, proof, now);
  if (!desk) return err(missing());
  if (!isUploadId(input.uploadId)) return err(serviceError('invalid', 'Choose the file again.'));
  const uploadId = input.uploadId.toLowerCase();
  const size = input.bytes.byteLength;
  if (size < 1) return err(serviceError('invalid', 'This file is empty.'));
  const name = sanitizeOriginalFileName(
    typeof input.originalName === 'string' ? input.originalName : null,
  );
  const decision = await checkRateLimits(
    db,
    [
      {
        input: { subjectId: desk.linkId, action: 'collect.guest_upload_link', label: 'file' },
        config: RATE_LIMITS.COLLECTION_GUEST_UPLOAD_LINK,
      },
    ],
    now,
  );
  if (!decision.allowed) return err(serviceError('rate_limited', decision.reason));

  const files = schema.agencyCollectionGuestFiles;
  const inputSha256 = sha256Hex(input.bytes);
  type Claim =
    | { kind: 'replay'; row: FileRow }
    | { kind: 'busy'; retryAfterSeconds: number }
    | { kind: 'full'; message: string }
    | { kind: 'claimed'; id: string; objectKey: string; abandonedKey: string | null };
  const claim: Claim = await db.transaction(async (tx) => {
    const existing = first(
      await tx
        .select()
        .from(files)
        .where(and(ownFiles(desk), eq(files.uploadId, uploadId)))
        .limit(1)
        .for('update'),
    );
    if (existing) {
      if (existing.safetyStatus !== SAFETY.receiving) return { kind: 'replay', row: existing };
      const age = now.getTime() - existing.updatedAt.getTime();
      if (age < GUEST_UPLOAD_CLAIM_STALE_MS) {
        return {
          kind: 'busy',
          retryAfterSeconds: Math.max(1, Math.ceil((GUEST_UPLOAD_CLAIM_STALE_MS - age) / 1000)),
        };
      }
      // A stale claim (its request died): this attempt takes it over with a fresh key, and
      // whatever the abandoned attempt stored under the old key is removed below.
      const objectKey = `guest-${randomUUID()}`;
      await registerStorageObject(tx, 'QUARANTINE', objectKey, input.bytes, inputSha256);
      await tx
        .update(files)
        .set({ objectKey, contentType: input.contentType, sizeBytes: size, updatedAt: now })
        .where(and(eq(files.id, existing.id), ownFiles(desk)));
      return { kind: 'claimed', id: existing.id, objectKey, abandonedKey: existing.objectKey };
    }
    const usage = first(
      await tx
        .select({
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint`,
        })
        .from(files)
        .where(and(ownFiles(desk), isNull(files.removedAt))),
    );
    if (Number(usage?.count ?? 0) >= GUEST_MAX_FILES) {
      return {
        kind: 'full',
        message: `You can add up to ${GUEST_MAX_FILES} files to one request. Remove some first.`,
      };
    }
    if (Number(usage?.bytes ?? 0) + size > GUEST_MAX_TOTAL_BYTES) {
      return {
        kind: 'full',
        message: 'This request has no room left for more files. Remove some first.',
      };
    }
    const objectKey = `guest-${randomUUID()}`;
    // Registered before any byte is written, so bytes with no registration never exist.
    await registerStorageObject(tx, 'QUARANTINE', objectKey, input.bytes, inputSha256);
    const created = first(
      await tx
        .insert(files)
        .values({
          organizationId: desk.organizationId,
          requestId: desk.requestId,
          linkId: desk.linkId,
          recipientKey: desk.recipientKey,
          uploadId,
          objectKey,
          contentType: input.contentType.slice(0, 100),
          sizeBytes: size,
          originalName: name ?? 'Document',
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: files.id }),
    );
    if (!created) throw new Error('guest file insert returned nothing');
    return { kind: 'claimed', id: created.id, objectKey, abandonedKey: null };
  });
  if (claim.kind === 'busy') return err(IN_PROGRESS(claim.retryAfterSeconds));
  if (claim.kind === 'full') return err(serviceError('invalid', claim.message));
  if (claim.kind === 'replay') {
    const sent = await sentFileIds(db, [claim.row.id]);
    const file = fileView(claim.row, sent.has(claim.row.id), now);
    return ok(
      file.status === 'refused'
        ? { kind: 'refused', file, message: REFUSED_MESSAGE }
        : { kind: 'stored', file, replay: true },
    );
  }

  if (claim.abandonedKey) await discardGuestObject(db, storage, claim.abandonedKey);
  // Store, read back, hash, check. Nothing is mapped or sendable until every check passed.
  let verdict: { safe: boolean; sha256: string | null };
  let row: FileRow | null;
  try {
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: claim.objectKey,
      contentType: input.contentType,
      bytes: input.bytes,
    });
    const stored = await storage.getObject(claim.objectKey);
    if (!stored || stored.bytes.byteLength !== size) {
      throw new Error('guest file failed read-back verification');
    }
    const sha256 = sha256Hex(stored.bytes);
    if (sha256 !== inputSha256) throw new Error('guest file changed in storage');
    const scan = await input.checks.scanner.scan({
      bucket: 'QUARANTINE',
      objectKey: claim.objectKey,
    });
    const limits = scan.safe
      ? await input.checks.contentLimits.check({
          bucket: 'QUARANTINE',
          objectKey: claim.objectKey,
        })
      : null;
    verdict = { safe: scan.safe && limits?.withinLimits === true, sha256 };
    if (!verdict.safe) await discardGuestObject(db, storage, claim.objectKey);
    const items = verdict.safe ? await issuedItems(db, desk) : null;
    const proposal = verdict.safe && items ? proposeGuestItem(name ?? '', items) : null;
    row = await finishGuestFile(db, desk, claim, verdict, proposal, input.checks, now);
  } catch (error) {
    // Nothing usable was kept: free this attempt's claim (only while it is still this attempt's
    // key) so the guest's retry starts clean, and remove what this attempt stored.
    await discardGuestObject(db, storage, claim.objectKey);
    await db
      .delete(files)
      .where(
        and(
          eq(files.id, claim.id),
          eq(files.objectKey, claim.objectKey),
          ownFiles(desk),
          eq(files.safetyStatus, SAFETY.receiving),
        ),
      )
      .catch(() => undefined);
    throw error;
  }
  if (!row) {
    // Another attempt took the claim over meanwhile: this attempt's bytes are not referenced.
    await discardGuestObject(db, storage, claim.objectKey);
    return err(IN_PROGRESS(5));
  }
  const file = fileView(row, false, now);
  return ok(
    verdict.safe
      ? { kind: 'stored', file, replay: false }
      : { kind: 'refused', file, message: REFUSED_MESSAGE },
  );
}

/** Record the checks' verdict on this attempt's claim, or null when the claim is no longer its own. */
async function finishGuestFile(
  db: Db,
  desk: VerifiedGuestDesk,
  claim: { readonly id: string; readonly objectKey: string },
  verdict: { readonly safe: boolean; readonly sha256: string | null },
  proposal: string | null,
  checks: GuestFileChecks,
  now: Date,
): Promise<FileRow | null> {
  const files = schema.agencyCollectionGuestFiles;
  return db.transaction(async (tx) => {
    const updated = first(
      await tx
        .update(files)
        .set({
          safetyStatus: verdict.safe ? SAFETY.clean : SAFETY.rejected,
          sha256: verdict.safe ? verdict.sha256 : null,
          scannerName: checks.scanner.name,
          scannerVersion: checks.scanner.version,
          virusScanned: verdict.safe && checks.virusScanner,
          checkedAt: now,
          itemId: proposal,
          mappingSource: proposal ? 'PROPOSED' : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(files.id, claim.id),
            eq(files.objectKey, claim.objectKey),
            ownFiles(desk),
            eq(files.safetyStatus, SAFETY.receiving),
          ),
        )
        .returning(),
    );
    if (!updated) return null;
    await guestAudit(tx, desk, 'AGENCY_COLLECTION_GUEST_FILE_ADDED', {
      outcome: verdict.safe ? 'clean' : 'refused',
      virusScanned: updated.virusScanned,
      proposed: proposal !== null,
    });
    return updated;
  });
}

const REFUSED_MESSAGE =
  'This file did not pass the safety checks and was not kept. Try a PDF or a photo saved again.';

/** Which of these files a sent submission holds. */
async function sentFileIds(db: Db, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ fileId: schema.agencyCollectionGuestSubmissionItems.fileId })
    .from(schema.agencyCollectionGuestSubmissionItems)
    .where(inArray(schema.agencyCollectionGuestSubmissionItems.fileId, [...ids]));
  return new Set(rows.flatMap((r) => (r.fileId ? [r.fileId] : [])));
}

// --- Mapping and removing ------------------------------------------------------------------------

/** Put one file under an issued item (or under none). The guest's choice replaces any proposal. */
export async function setGuestFileItem(
  db: Db,
  proof: GuestCollectionSessionProof,
  input: { readonly fileId: unknown; readonly itemId: unknown },
  now: Date = new Date(),
): Promise<Result<{ readonly itemId: string | null }, ServiceError>> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return err(missing());
  const desk = await uploadDesk(db, proof, now);
  if (!desk || typeof input.fileId !== 'string' || !isUploadId(input.fileId)) return err(missing());
  const items = await issuedItems(db, desk);
  if (!items) return err(missing());
  const itemId =
    input.itemId === '' || input.itemId === null || input.itemId === undefined
      ? null
      : typeof input.itemId === 'string' && items.some((item) => item.id === input.itemId)
        ? input.itemId
        : undefined;
  if (itemId === undefined) return err(serviceError('invalid', 'Choose an item from the list.'));
  const files = schema.agencyCollectionGuestFiles;
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(files)
      .set({ itemId, mappingSource: itemId ? 'GUEST' : null, updatedAt: now })
      .where(
        and(
          eq(files.id, input.fileId as string),
          ownFiles(desk),
          eq(files.safetyStatus, SAFETY.clean),
          isNull(files.removedAt),
        ),
      )
      .returning({ id: files.id });
    if (updated.length === 0) return err(missing());
    await guestAudit(tx, desk, 'AGENCY_COLLECTION_GUEST_FILE_MAPPED', { mapped: itemId !== null });
    return ok({ itemId });
  });
}

/**
 * Remove a file from the guest's list. A file no submission holds is deleted with its bytes (bytes
 * first; if that fails the row stays hidden and the retention purge finishes it); one a sent
 * submission holds stays exactly as sent (the agency keeps that submission) and only leaves the
 * list for the next submission. An upload that stopped before its checks finished can be removed.
 */
export async function removeGuestFile(
  db: Db,
  storage: Pick<BlobStore, 'deleteObject'>,
  proof: GuestCollectionSessionProof,
  fileId: unknown,
  now: Date = new Date(),
): Promise<Result<{ readonly kept: boolean }, ServiceError>> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return err(missing());
  const desk = await uploadDesk(db, proof, now);
  if (!desk || typeof fileId !== 'string' || !isUploadId(fileId)) return err(missing());
  const files = schema.agencyCollectionGuestFiles;
  const outcome = await db.transaction(async (tx) => {
    const row = first(
      await tx
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), ownFiles(desk), isNull(files.removedAt)))
        .limit(1)
        .for('update'),
    );
    if (!row || (row.safetyStatus === SAFETY.receiving && !stalled(row, now))) return null;
    const sent = (await sentFileIds(tx, [row.id])).has(row.id);
    await tx
      .update(files)
      .set({ removedAt: now, updatedAt: now })
      .where(and(eq(files.id, row.id), ownFiles(desk)));
    await guestAudit(tx, desk, 'AGENCY_COLLECTION_GUEST_FILE_REMOVED', { kept: sent });
    return { kept: sent, id: row.id, objectKey: row.objectKey };
  });
  if (!outcome) return err(missing());
  if (!outcome.kept && (await discardGuestObject(db, storage, outcome.objectKey))) {
    await db.delete(files).where(and(eq(files.id, outcome.id), ownFiles(desk)));
  }
  return ok({ kept: outcome.kept });
}

// --- The desk with files -------------------------------------------------------------------------

export type CollectionReviewDecision = 'RECEIVED' | 'NEEDS_CORRECTION' | 'ACCEPTED';

export interface GuestSubmissionLine {
  readonly itemId: string;
  readonly label: string;
  readonly files: readonly string[];
  readonly missing: boolean;
  /** The agency's note for this item in its latest review, if any. */
  readonly note: string | null;
}

export interface GuestSubmissionSummary {
  readonly id: string;
  readonly submissionNo: number;
  readonly revisionNo: number;
  readonly submittedAt: Date;
  readonly retentionDays: number;
  /** The agency's latest decision, or null when it has made none yet. */
  readonly decision: CollectionReviewDecision | null;
  readonly decisionNote: string | null;
  readonly lines: readonly GuestSubmissionLine[];
}

export interface GuestUploadDesk {
  readonly files: readonly GuestFileView[];
  /** Issued items with no ready file under them, in issue order. */
  readonly stillMissing: readonly string[];
  /** Newest first. */
  readonly submissions: readonly GuestSubmissionSummary[];
}

/**
 * The guest's files, what is still missing, and every submission they sent (with the agency's
 * latest decision and its notes), or null for anything that is not a verified live desk. Null too
 * before the P9 migration runs, so the page offers no upload that would be refused.
 */
export async function readGuestUploadDesk(
  db: Db,
  proof: GuestCollectionSessionProof,
  items: readonly GuestChecklistItem[],
  now: Date = new Date(),
): Promise<GuestUploadDesk | null> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return null;
  if (!(await guestUploadsPresent(db))) return null;
  const desk = await verifiedGuestDesk(db, proof, now);
  if (!desk) return null;
  const files = schema.agencyCollectionGuestFiles;
  const rows = await db
    .select()
    .from(files)
    .where(and(ownFiles(desk), isNull(files.removedAt)))
    .orderBy(asc(files.createdAt), asc(files.id))
    .limit(GUEST_MAX_FILES);
  const sent = await sentFileIds(
    db,
    rows.map((r) => r.id),
  );
  const views = rows.map((row) => fileView(row, sent.has(row.id), now));
  const covered = new Set(
    views.flatMap((v) => (v.status === 'ready' && v.itemId ? [v.itemId] : [])),
  );
  const submissions = await ownSubmissions(db, desk, items);
  return {
    files: views,
    stillMissing: items.filter((item) => !covered.has(item.id)).map((item) => item.id),
    submissions,
  };
}

/** The newest submissions one guest sees at once. */
const OWN_SUBMISSION_LIMIT = 20;

async function ownSubmissions(
  db: Db,
  desk: VerifiedGuestDesk,
  items: readonly GuestChecklistItem[],
): Promise<GuestSubmissionSummary[]> {
  const submissions = schema.agencyCollectionGuestSubmissions;
  const rows = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.requestId, desk.requestId),
        eq(submissions.organizationId, desk.organizationId),
        eq(submissions.recipientKey, desk.recipientKey),
      ),
    )
    .orderBy(desc(submissions.submissionNo))
    .limit(OWN_SUBMISSION_LIMIT);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const lines = await db
    .select()
    .from(schema.agencyCollectionGuestSubmissionItems)
    .where(inArray(schema.agencyCollectionGuestSubmissionItems.submissionId, ids));
  const reviews = await db
    .select()
    .from(schema.agencyCollectionReviews)
    .where(
      and(
        eq(schema.agencyCollectionReviews.organizationId, desk.organizationId),
        eq(schema.agencyCollectionReviews.requestId, desk.requestId),
        inArray(schema.agencyCollectionReviews.guestSubmissionId, ids),
      ),
    )
    .orderBy(
      desc(schema.agencyCollectionReviews.decidedAt),
      desc(schema.agencyCollectionReviews.id),
    );
  const labels = new Map(items.map((item) => [item.id, item.label] as const));
  return rows.map((row) => {
    const latest = reviews.find((r) => r.guestSubmissionId === row.id) ?? null;
    const notes = new Map(
      parseItemNotes(latest?.itemNotes).map((n) => [n.itemId, n.note] as const),
    );
    const own = lines.filter((l) => l.submissionId === row.id);
    const itemIds = [...new Set(own.map((l) => l.itemId))];
    return {
      id: row.id,
      submissionNo: row.submissionNo,
      revisionNo: row.revisionNo,
      submittedAt: row.submittedAt,
      retentionDays: row.retentionDays,
      decision: (latest?.decision as CollectionReviewDecision | undefined) ?? null,
      decisionNote: latest?.note ?? null,
      lines: itemIds.map((itemId) => {
        const mine = own.filter((l) => l.itemId === itemId);
        return {
          itemId,
          label: labels.get(itemId) ?? 'An Earlier Item',
          files: mine.flatMap((l) => (l.kind === 'FILE' && l.title ? [l.title] : [])),
          missing: mine.every((l) => l.kind === 'MISSING'),
          note: notes.get(itemId) ?? null,
        };
      }),
    };
  });
}

/** Per-item notes as stored, or none for anything malformed. */
export function parseItemNotes(
  value: unknown,
): readonly { readonly itemId: string; readonly note: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    entry &&
    typeof entry === 'object' &&
    typeof (entry as { itemId?: unknown }).itemId === 'string' &&
    typeof (entry as { note?: unknown }).note === 'string'
      ? [{ itemId: (entry as { itemId: string }).itemId, note: (entry as { note: string }).note }]
      : [],
  );
}

// --- Submit Documents ----------------------------------------------------------------------------

/** One line of a guest submission, as its content fingerprint reads it. */
export interface GuestSubmissionContentLine {
  readonly itemId: string;
  readonly kind: 'FILE' | 'MISSING';
  readonly fileId: string | null;
  readonly fileSha256: string | null;
}

/** The SHA-256 of what a guest submission holds, in a fixed order. Pure. */
export function guestSubmissionContentSha256(input: {
  readonly requestId: string;
  readonly revisionId: string;
  readonly recipientKey: string;
  readonly submissionNo: number;
  readonly retentionDays: number;
  readonly consentVersion: string;
  readonly lines: readonly GuestSubmissionContentLine[];
}): string {
  const lines = [...input.lines]
    .map((l) => [l.itemId, l.kind, l.fileId ?? '', l.fileSha256 ?? ''] as const)
    .sort((a, b) => {
      const left = a.join('\u0000');
      const right = b.join('\u0000');
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return createHash('sha256')
    .update(
      JSON.stringify({
        format: 1,
        requestId: input.requestId,
        revisionId: input.revisionId,
        recipientKey: input.recipientKey,
        submissionNo: input.submissionNo,
        retentionDays: input.retentionDays,
        consentVersion: input.consentVersion,
        lines,
      }),
      'utf8',
    )
    .digest('hex');
}

export interface SubmittedGuestDocuments {
  readonly submissionId: string;
  readonly submissionNo: number;
  readonly files: number;
  readonly stillMissing: number;
}

/**
 * Submit Documents: freeze every ready file the guest placed under an issued item, a Still Missing
 * line for every other item, the issued revision, the retention choice and the consent wording.
 * Refused while a file is still being checked, without a retention choice or consent, or with no
 * file placed. The agency's owners and admins get "Submitted to Agency" (agency name only).
 */
export async function submitGuestDocuments(
  db: Db,
  proof: GuestCollectionSessionProof,
  input: { readonly consent: unknown },
  now: Date = new Date(),
): Promise<Result<SubmittedGuestDocuments, ServiceError>> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return err(missing());
  const desk = await uploadDesk(db, proof, now);
  if (!desk) return err(missing());
  if (input.consent !== true) {
    return err(serviceError('invalid', 'Tick the box to confirm what you are sending.'));
  }
  const items = await issuedItems(db, desk);
  if (!items) {
    return err(serviceError('invalid', 'This checklist cannot be used right now. Ask the agency.'));
  }
  const draft = first(
    await db
      .select({ retentionDays: schema.agencyCollectionGuestDrafts.retentionDays })
      .from(schema.agencyCollectionGuestDrafts)
      .where(
        and(
          eq(schema.agencyCollectionGuestDrafts.linkId, desk.linkId),
          eq(schema.agencyCollectionGuestDrafts.requestId, desk.requestId),
          eq(schema.agencyCollectionGuestDrafts.revisionId, desk.revisionId),
        ),
      )
      .limit(1),
  );
  const retention = draft?.retentionDays ?? null;
  if (!isGuestRetentionDays(retention)) {
    return err(
      serviceError('invalid', 'Choose how long the agency may keep your files, then submit.'),
    );
  }
  const decision = await checkRateLimits(
    db,
    [
      {
        input: { subjectId: desk.linkId, action: 'collect.guest_submit_link', label: 'send' },
        config: RATE_LIMITS.COLLECTION_GUEST_SUBMIT_LINK,
      },
    ],
    now,
  );
  if (!decision.allowed) return err(serviceError('rate_limited', decision.reason));
  try {
    return await db.transaction(async (tx) => submitInTransaction(tx, desk, items, retention, now));
  } catch (error) {
    // Two submits at once: the second loses the number race and asks to try again.
    if ((error as { code?: unknown })?.code === '23505' || /duplicate key/i.test(String(error))) {
      return err(serviceError('stale', 'Your documents were just sent. Reload to see them.'));
    }
    throw error;
  }
}

async function submitInTransaction(
  tx: Db,
  desk: VerifiedGuestDesk,
  items: readonly CollectionItem[],
  retentionDays: GuestRetentionDays,
  now: Date,
): Promise<Result<SubmittedGuestDocuments, ServiceError>> {
  const files = schema.agencyCollectionGuestFiles;
  const current = await tx
    .select()
    .from(files)
    .where(and(ownFiles(desk), isNull(files.removedAt)))
    .orderBy(asc(files.createdAt), asc(files.id))
    .for('update');
  // A file still being checked holds the submission; one whose upload stopped is left out.
  if (current.some((f) => f.safetyStatus === SAFETY.receiving && !stalled(f, now))) {
    return err(serviceError('invalid', 'Wait until every file has been checked, then submit.'));
  }
  const byItem = new Map<string, FileRow[]>();
  for (const file of current) {
    if (file.safetyStatus !== SAFETY.clean || !file.itemId || !file.sha256) continue;
    byItem.set(file.itemId, [...(byItem.get(file.itemId) ?? []), file]);
  }
  type SubmitLine = GuestSubmissionContentLine & { readonly title: string | null };
  const lines = items.flatMap((item): SubmitLine[] => {
    const placed = byItem.get(item.id) ?? [];
    return placed.length === 0
      ? [{ itemId: item.id, kind: 'MISSING' as const, fileId: null, fileSha256: null, title: null }]
      : placed.map((file) => ({
          itemId: item.id,
          kind: 'FILE' as const,
          fileId: file.id,
          fileSha256: file.sha256,
          title: file.originalName,
        }));
  });
  const fileCount = lines.filter((l) => l.kind === 'FILE').length;
  if (fileCount === 0) {
    return err(serviceError('invalid', 'Place at least one file under an item, then submit.'));
  }
  const submissions = schema.agencyCollectionGuestSubmissions;
  const previous = first(
    await tx
      .select({ last: sql<number>`coalesce(max(${submissions.submissionNo}), 0)::int` })
      .from(submissions)
      .where(
        and(
          eq(submissions.requestId, desk.requestId),
          eq(submissions.recipientKey, desk.recipientKey),
        ),
      ),
  );
  const submissionNo = Number(previous?.last ?? 0) + 1;
  const revision = first(
    await tx
      .select({ revisionNo: schema.agencyCollectionRequestRevisions.revisionNo })
      .from(schema.agencyCollectionRequestRevisions)
      .where(eq(schema.agencyCollectionRequestRevisions.id, desk.revisionId))
      .limit(1),
  );
  if (!revision) return err(missing());
  const contentSha256 = guestSubmissionContentSha256({
    requestId: desk.requestId,
    revisionId: desk.revisionId,
    recipientKey: desk.recipientKey,
    submissionNo,
    retentionDays,
    consentVersion: GUEST_CONSENT_VERSION,
    lines,
  });
  const created = first(
    await tx
      .insert(submissions)
      .values({
        organizationId: desk.organizationId,
        requestId: desk.requestId,
        revisionId: desk.revisionId,
        linkId: desk.linkId,
        recipientKey: desk.recipientKey,
        revisionNo: revision.revisionNo,
        submissionNo,
        retentionDays,
        consentVersion: GUEST_CONSENT_VERSION,
        contentSha256,
        submittedAt: now,
      })
      .returning({ id: submissions.id }),
  );
  if (!created) throw new Error('guest submission insert returned nothing');
  await tx.insert(schema.agencyCollectionGuestSubmissionItems).values(
    lines.map((line) => ({
      submissionId: created.id,
      itemId: line.itemId,
      kind: line.kind,
      fileId: line.fileId,
      fileSha256: line.fileSha256,
      title: line.title,
    })),
  );
  const stillMissing = lines.filter((l) => l.kind === 'MISSING').length;
  await guestAudit(tx, desk, 'AGENCY_COLLECTION_GUEST_SUBMITTED', {
    submissionNo,
    files: fileCount,
    stillMissing,
    retentionDays,
  });
  await noticeAgencyAdmins(tx, desk, created.id);
  return ok({ submissionId: created.id, submissionNo, files: fileCount, stillMissing });
}

/**
 * "Submitted to Agency" for the agency's active owners and admins, in the app and by email, the
 * same notice a signed-in answer sends. Names the agency only. The worker sends it only while the
 * submission is still live and the agency still reviewed.
 */
async function noticeAgencyAdmins(
  tx: Db,
  desk: VerifiedGuestDesk,
  submissionId: string,
): Promise<void> {
  const org = first(
    await tx
      .select({ name: schema.organizations.name, status: schema.organizations.status })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, desk.organizationId))
      .limit(1),
  );
  if (!org || !OPEN_ORGANIZATION_STATUSES.includes(org.status)) return;
  const admins = await tx
    .select({ accountId: schema.memberships.accountId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, desk.organizationId),
        eq(schema.memberships.active, true),
        inArray(schema.memberships.role, ['OWNER', 'ADMIN']),
      ),
    );
  const agencyName = org.status === 'ACTIVE' ? org.name : null;
  for (const admin of admins) {
    await enqueueNotificationBothChannels(tx, {
      eventType: 'AGENCY_COLLECTION_RESPONSE_SUBMITTED',
      resourceId: submissionId,
      recipientAccountId: admin.accountId,
      organizationId: desk.organizationId,
      payload: {
        subject: 'Submitted to Agency',
        summary: agencyName
          ? `An answer to one of your document requests was submitted to ${agencyName}.`
          : 'An answer to one of your document requests was submitted to your agency.',
        deepLinkPath: `/app/agency/${desk.organizationId}/collection/request?id=${desk.requestId}#collection-responses`,
      },
    });
  }
}
