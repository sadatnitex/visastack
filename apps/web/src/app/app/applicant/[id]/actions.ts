'use server';

import { createHash } from 'node:crypto';
import type { ApplicantId, Result } from '@visastack/core';
import type { Actor, Db, DocumentKindSuggestion, ServiceError } from '@visastack/services';
import type { RegisteredDocumentWithVersion } from '@visastack/services';
import {
  CONVERTED_FROM_HEIC_SOURCE,
  accountPrincipal,
  acknowledgeInconsistencyFlag,
  approveClearProposals,
  approveDocumentTypeProposal,
  approveProposal,
  decideDocumentName,
  decideDocumentSuggestion,
  dismissInconsistencyFlag,
  editFact,
  enqueueIntakeJob,
  failUpload,
  finalizeUpload,
  findDuplicateVersions,
  getApplicant,
  getLatestExtractedText,
  growUploadReservation,
  isAiDispatchAllowed,
  isAiFeatureRefusal,
  isValidDocumentDateString,
  loadUploadQuotaConfig,
  mbLabel,
  prepareDocumentKind,
  previewDocument,
  registerDocumentWithVersion,
  registerFieldDefinition,
  rejectDocumentTypeProposal,
  rejectProposal,
  renameDocument,
  renderOcrSourceImage,
  requestDocumentReExtraction,
  requireAccess,
  reserveUpload,
  runExtraction,
  runInconsistencyCheck,
  runOcr,
  setDocumentDate,
  setDocumentType,
  suggestDocumentKind,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import {
  resolveAiClassifier,
  resolveAiExtractor,
  resolveAiInconsistencyChecker,
  resolveOcrAdapter,
} from '../../../../lib/ai';
import { ensureDocumentFieldsRegistered } from '../../../../lib/field-registry';
import { documentTypeLabel } from '../../../../lib/labels';
import { fieldRegistryInputOf, savableField } from '../../../../lib/master-profile';
import { createKeyManagementPort, createPreviewRenderer } from '../../../../lib/providers';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';
import {
  HEIC_CONVERTED_NOTE,
  SUGGESTION_SAVED_LINE,
  detailSavedLine,
  documentAddedLine,
  documentTypeSavedLine,
} from '../../../../lib/success-lines';
import {
  pdfUploadsAccepted,
  prepareUploadBytes,
  validateUploadBytes,
} from '../../../../lib/upload-preflight';
import { storedFileName } from '../../../../lib/upload-rules';
import { triggerIntakeAndReading } from '../../../api/jobs/process-ai-reading/run';
import { describeClearAcceptance } from './ai-review-messages';
import { recordGroupOfDocType } from './record-groups';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
  /** The input a problem is about, when the action knows (the form marks it invalid and moves focus to it). */
  readonly field?: string;
  /** An added document's title ("Passport, Nazmus"), for an upload list to show. */
  readonly title?: string;
}

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/** Guard: the applicant must be owned by the signed-in account. */
async function assertOwned(db: Db, accountId: string, applicantId: string): Promise<boolean> {
  const applicant = await getApplicant(db, applicantId);
  return applicant?.ownerAccountId === accountId;
}

/** Save a Master Profile fact (append-only immutable version). */
export async function saveFactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const fieldKey = String(formData.get('fieldKey') ?? '');
  const value = String(formData.get('value') ?? '').trim();
  const repeatingRecordKeyRaw = formData.get('repeatingRecordKey');
  const repeatingRecordKey =
    typeof repeatingRecordKeyRaw === 'string' && repeatingRecordKeyRaw.length > 0
      ? repeatingRecordKeyRaw
      : null;
  const def = savableField(fieldKey);
  if (!def) return { ok: false, message: 'Unknown field.' };
  if (value.length === 0) return { ok: false, message: 'Enter a value first.', field: 'value' };

  const effectiveFromRaw = String(formData.get('effectiveFrom') ?? '').trim();
  let effectiveFrom: Date | undefined;
  if (effectiveFromRaw.length > 0) {
    const parsed = new Date(effectiveFromRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, message: 'Invalid effective date.', field: 'effectiveFrom' };
    }
    effectiveFrom = parsed;
  }

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    await registerFieldDefinition(db, fieldRegistryInputOf(def));
    const encryption = createKeyManagementPort();
    const edit = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: def.key,
      value,
      ...(repeatingRecordKey !== null ? { repeatingRecordKey } : {}),
      ...(effectiveFrom ? { effectiveFrom } : {}),
      ...(encryption ? { encryption } : {}),
    });
    if (!edit.ok) return { ok: false, message: edit.error.message } satisfies ActionState;
    return { ok: true, message: detailSavedLine(def.label) } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * Upload a document: reserve → store bytes → verify → register → version →
 * queue intake processing → finalize the reservation.
 *
 * Upload consistency (master directive §7 "PR 6"): a server-created upload
 * intent atomically reserves this upload's quota and mints its opaque
 * object key BEFORE any bytes are written, closing a real TOCTOU race
 * (two concurrent uploads for the same applicant/account could otherwise
 * each individually pass a read-only quota check and jointly exceed it —
 * see `reserveUpload`, packages/services/src/uploads.ts). On any failure
 * after the reservation: `failUpload` releases it immediately (it stops
 * counting toward every quota tier at once) and, if bytes were already
 * written, the partial blob is deleted — never an invisible orphan (a
 * document row nobody can complete, or bytes nobody's metadata points to).
 */
export async function uploadDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a file to upload.', field: 'file' };
  }

  // Cheap, upfront rejection using the File's declared size — before reading
  // any bytes. The app's own quota can be tighter than the framework-level
  // body-size ceiling (next.config.mjs's experimental.serverActions.
  // bodySizeLimit), and there is no reason to pay for hashing/DB work on a
  // file already known to be oversized.
  const quotaConfig = loadUploadQuotaConfig();
  if (file.size > quotaConfig.maxUploadBytes) {
    return {
      ok: false,
      message: `File exceeds the ${mbLabel(quotaConfig.maxUploadBytes)} upload limit.`,
      field: 'file',
    };
  }

  // The kind of document is optional here and can be set any time later. When it is chosen, it is
  // checked the same way as the per-document setting, so both store the same standard key.
  const kind = prepareDocumentKind(
    String(formData.get('docType') ?? ''),
    String(formData.get('subject') ?? ''),
  );
  if (!kind.ok) return { ok: false, message: kind.error.message, field: 'docType' };

  const declaredType = file.type || 'application/octet-stream';

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }

    const reservation = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: file.size },
      quotaConfig,
    );
    if (!reservation.ok) {
      return { ok: false, message: reservation.error.message } satisfies ActionState;
    }
    let intent = reservation.value;
    // Opaque key only — never the applicant id, email, or filename (§10).
    // The bucket/applicant association lives solely in the domain tables
    // (documents/document_versions/storage_objects), never in the object
    // path. Minted by the reservation itself, not here, so a failure after
    // this point always has a key to clean up by.
    const storage = createStorage(db);

    // Everything from the first byte read through document registration is
    // wrapped in one try/catch so a genuinely unexpected exception — not
    // just a modeled failure each branch below already handles — still
    // releases the reservation and best-effort deletes any bytes already
    // written, rather than leaking the reservation for its full TTL and
    // abandoning an orphaned blob. `registerDocumentWithVersion` itself
    // creates the document and its first version atomically (a savepoint
    // transaction), so a failure partway through never leaves a
    // versionless document behind either. Deliberately scoped to end here:
    // once this returns `ok`, the document version durably exists and
    // references this object key, so a later failure enqueueing the intake
    // job must never delete the blob out from under it.
    const outcome = await (async (): Promise<
      | { ok: true; version: RegisteredDocumentWithVersion; convertedFrom: 'HEIC' | null }
      | { ok: false; message: string }
    > => {
      try {
        const sent = new Uint8Array(await file.arrayBuffer());
        if (sent.byteLength !== file.size) {
          // The browser's declared size didn't match what was actually read —
          // fail closed rather than trust a mismatched declaration.
          await failUpload(
            db,
            intent.id,
            `declared size ${file.size} did not match actual bytes read ${sent.byteLength}`,
          );
          return { ok: false, message: 'Upload failed: the file changed while uploading.' };
        }

        // An iPhone photo (HEIC or HEIF) becomes a new JPEG here, before anything is stored, so
        // every later step meets a format it handles. The HEIC bytes stay in this request's
        // memory only and are never written anywhere.
        const prepared = await prepareUploadBytes(
          sent,
          declaredType,
          quotaConfig.maxImageMegapixels,
        );
        if (!prepared.ok) {
          await failUpload(db, intent.id, prepared.reason);
          return { ok: false, message: prepared.message };
        }
        const { bytes, contentType, convertedFrom } = prepared;
        if (bytes.byteLength > intent.reservedBytes) {
          // A converted copy can be larger than the photo that was sent: this upload's own
          // reservation grows to what will actually be stored, in one step under the same quota
          // rules, so no quota is ever exceeded and the reservation is never let go in between.
          const access = await requireAccess(
            db,
            accountPrincipal(accountId),
            'MANAGE',
            { applicantId },
            { purpose: 'owner_document_upload' },
          );
          if (!access.ok) {
            await failUpload(db, intent.id, 'converted copy: access refused when growing space');
            return { ok: false, message: 'Not authorized.' };
          }
          const grown = await growUploadReservation(
            access.value,
            { intentId: intent.id, sizeBytes: bytes.byteLength },
            quotaConfig,
          );
          if (!grown.ok) {
            const refusal = convertedCopyRefusal(grown.error, quotaConfig.maxUploadBytes);
            await failUpload(db, intent.id, refusal.reason);
            return { ok: false, message: refusal.message };
          }
          intent = grown.value;
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');

        if (
          !validateUploadBytes(bytes, contentType, pdfUploadsAccepted(), quotaConfig.maxUploadBytes)
        ) {
          await failUpload(db, intent.id, 'upload rejected by structural preflight');
          return {
            ok: false,
            message: 'This file type cannot be safely processed. Choose a supported document.',
          };
        }

        try {
          await storage.putObject({
            objectKey: intent.objectKey,
            bucket: 'QUARANTINE',
            contentType,
            bytes,
          });
        } catch (error) {
          await failUpload(db, intent.id, error instanceof Error ? error.message : String(error));
          return { ok: false, message: 'Upload failed while storing the file. Please try again.' };
        }

        // Server-side verification: a fresh read confirms the bytes are
        // actually there and the right size — never report success on the
        // strength of "the write call didn't throw" alone (same round-trip
        // discipline as the erasure worker's delete-then-verify, master
        // directive §7 "PR 4").
        const verification = storage.getPendingUpload
          ? await storage.getPendingUpload(intent.objectKey)
          : await storage.getObject(intent.objectKey);
        if (
          !verification ||
          verification.bytes.byteLength !== bytes.byteLength ||
          createHash('sha256').update(verification.bytes).digest('hex') !== sha256
        ) {
          await storage.deleteObject('QUARANTINE', intent.objectKey).catch(() => undefined);
          await failUpload(
            db,
            intent.id,
            'stored object failed verification immediately after write',
          );
          return { ok: false, message: 'Upload failed verification. Please try again.' };
        }

        const created = await registerDocumentWithVersion(db, {
          actorAccountId: accountId,
          applicantId,
          // The file's name only with the extension of what is stored; the document itself is
          // listed under its automatic title ("Passport, Nazmus"), never this name.
          originalName: storedFileName(file.name || 'document', contentType),
          automaticTitle: true,
          source: convertedFrom === 'HEIC' ? CONVERTED_FROM_HEIC_SOURCE : 'UPLOAD',
          ...(kind.value.docType !== null ? { docType: kind.value.docType } : {}),
          ...(kind.value.subject !== null ? { subject: kind.value.subject } : {}),
          bucket: 'QUARANTINE',
          objectKey: intent.objectKey,
          sizeBytes: bytes.byteLength,
          sha256,
        });
        if (!created.ok) {
          await storage.deleteObject('QUARANTINE', intent.objectKey).catch(() => undefined);
          await failUpload(db, intent.id, created.error.message);
          return { ok: false, message: created.error.message };
        }
        return { ok: true, version: created.value, convertedFrom };
      } catch (error) {
        await storage.deleteObject('QUARANTINE', intent.objectKey).catch(() => undefined);
        await failUpload(db, intent.id, error instanceof Error ? error.message : String(error));
        return { ok: false, message: 'Upload failed unexpectedly. Please try again.' };
      }
    })();

    if (!outcome.ok) return { ok: false, message: outcome.message } satisfies ActionState;

    // Processing runs off the request path (master directive §5 — DB-backed
    // low-volume jobs, not a synchronous in-request scan): the job row is the
    // durable record of work to do, so a crash here loses no work. `after()`
    // fires the worker once the response has been sent for near-instant
    // processing in the common case; the periodic sweep at
    // /api/jobs/process-intake is the durability backstop if that doesn't run.
    await enqueueIntakeJob(db, { documentVersionId: outcome.version.version.id });
    await finalizeUpload(db, intent.id, outcome.version.version.id);
    after(() => triggerIntakeAndReading());

    // EVI-03: informational only, never blocks the upload that already
    // succeeded above, scoped to this SAME applicant's own other
    // documents, never a cross-customer comparison.
    const uploadedDocumentId = outcome.version.version.documentId;
    const duplicateHash = outcome.version.version.sha256;
    const duplicates = duplicateHash
      ? await findDuplicateVersions(db, {
          applicantId,
          sha256: duplicateHash,
          excludeDocumentId: uploadedDocumentId,
        })
      : [];
    // Never the other document's name: it can hold a first name, and this message can end up in
    // a log. The vault list on the page shows every document by its name.
    const duplicateNote =
      duplicates.length > 0 ? ' This looks identical to a document already in the vault.' : '';

    return {
      ok: true,
      message: documentAddedLine(
        kind.value.docType ? documentTypeLabel(kind.value.docType) : null,
        `${outcome.convertedFrom === 'HEIC' ? HEIC_CONVERTED_NOTE : ''}${duplicateNote}`,
      ),
      // The name the document is listed under, for the upload list on screen. Kept out of the
      // message, which can end up in a log.
      ...(outcome.version.document.approvedName
        ? { title: outcome.version.document.approvedName }
        : {}),
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * Decide an automatic filename proposal (master directive §11). The reviewer
 * may accept the proposed text unchanged, accept an edited version, or
 * reject it outright — never applied silently.
 */
export async function decideDocumentNameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const nameVersionId = String(formData.get('nameVersionId') ?? '');
  const originalProposal = String(formData.get('originalProposal') ?? '');
  const action = String(formData.get('nameAction') ?? '');
  const finalName = String(formData.get('finalName') ?? '').trim();

  if (action !== 'accept' && action !== 'reject') {
    return { ok: false, message: 'Unknown action.' };
  }
  if (action === 'accept' && finalName.length === 0) {
    return { ok: false, message: 'Enter a filename before approving.', field: 'finalName' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    const decided = await decideDocumentName(db, {
      actorAccountId: accountId,
      nameVersionId,
      decision:
        action === 'reject'
          ? 'REJECTED'
          : finalName === originalProposal
            ? 'ACCEPTED_UNCHANGED'
            : 'ACCEPTED_EDITED',
      ...(action === 'accept' ? { finalName } : {}),
    });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    return {
      ok: true,
      message: action === 'reject' ? 'Naming proposal rejected.' : 'Filename approved.',
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/** Issue a short-lived signed preview URL and redirect the browser to it. */
export async function previewDocumentAction(formData: FormData): Promise<void> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');

  const accessTokenSecret = readEnv('BLOB_SIGNING_SECRET');
  const url = await withSession(async ({ db, accountId }) => {
    if (!accessTokenSecret) return null;
    const applicant = await getApplicant(db, applicantId);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const actor: Actor = {
      kind: 'applicant_owner',
      applicantId: applicantId as ApplicantId,
    };
    const storage = createStorage(db);
    const ref = await previewDocument(db, storage, {
      actor,
      documentId,
      purpose: 'owner_preview',
      accessTokenSecret,
    });
    return ref.ok ? ref.value.url : null;
  });

  if (url) redirect(url);
  redirect(`/app/applicant/${applicantId}/documents?preview_error=1`);
}

/**
 * NTF-01 (Part 5 §1): record a document's own "as of" date - the input
 * `classifyStaleness` needs to judge case-specific freshness. Nothing
 * extracts this automatically today, so it stays unknown until set here.
 * An empty submitted value clears a mistaken entry back to unknown.
 */
export async function setDocumentDateAction(formData: FormData): Promise<void> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const documentDateRaw = String(formData.get('documentDate') ?? '').trim();

  const result = await withSession(async ({ db, accountId }) => {
    return setDocumentDate(db, {
      actorAccountId: accountId,
      documentId,
      documentDate: documentDateRaw.length > 0 ? documentDateRaw : null,
    });
  });

  revalidatePath(`/app/applicant/${applicantId}/documents`);
  if (!result.ok) redirect(`/app/applicant/${applicantId}/documents?date_error=1`);
  redirect(`/app/applicant/${applicantId}/documents`);
}

/**
 * Say what kind of document a file is. The name is checked against the catalogue and stored in its one
 * standard form; an "Other" type can carry a short name for what the document is. An empty choice clears
 * the type back to "not set".
 */
export async function setDocumentTypeAction(formData: FormData): Promise<void> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const docTypeRaw = String(formData.get('docType') ?? '').trim();
  const subjectRaw = String(formData.get('subject') ?? '').trim();

  const result = await withSession(async ({ db, accountId }) => {
    return setDocumentType(db, {
      actorAccountId: accountId,
      documentId,
      docType: docTypeRaw.length > 0 ? docTypeRaw : null,
      subject: subjectRaw,
    });
  });

  revalidatePath(`/app/applicant/${applicantId}/documents`);
  if (!result.ok) redirect(`/app/applicant/${applicantId}/documents?type_error=1`);
  redirect(`/app/applicant/${applicantId}/documents`);
}

/**
 * Run AI extraction over a document's already deterministically-extracted
 * text (AI Gateway — master directive §8/§26 item 4). Produces PENDING
 * proposals only; nothing is written to the profile here.
 */
export async function runAiExtractionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentVersionId = String(formData.get('documentVersionId') ?? '');

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    const resolved = await resolveAiExtractor(db, createKeyManagementPort());
    if (!resolved) {
      return { ok: false, message: 'Reading with AI is not set up yet.' } satisfies ActionState;
    }
    const text = await getLatestExtractedText(db, documentVersionId, applicantId);
    if (!text) {
      return {
        ok: false,
        message: 'No extracted text available yet for this document.',
      } satisfies ActionState;
    }
    await ensureDocumentFieldsRegistered(db, documentVersionId);
    const run = await runExtraction(db, resolved.ai, {
      actorAccountId: accountId,
      applicantId,
      documentVersionId,
      text,
      // The person asked (S28): Read with AI, not Automatic Reading.
      feature: 'ai_document_reading',
      budgetLimitUnits: resolved.limits.budgetLimitUnits,
      perDocumentBudgetLimitUnits: resolved.limits.perDocumentBudgetLimitUnits,
      maxAttemptsPerDocument: resolved.limits.maxAttemptsPerDocument,
      maxPagesPerDocument: resolved.limits.maxPagesPerDocument,
      cacheMaxAgeDays: resolved.limits.cacheMaxAgeDays,
      maxConcurrentCalls: resolved.limits.maxConcurrentCalls,
      killSwitchCheck: () => isAiDispatchAllowed(db),
      ...(resolved.fallback ? { fallback: resolved.fallback } : {}),
    });
    if (!run.ok) return { ok: false, message: readingRefusal(run.error) } satisfies ActionState;
    // Only after a reading that worked, so a failing provider is never asked twice against this
    // document's budget: the same reading also says what kind of document this is and suggests
    // a name (owner request 2026-10-25). Its own failure never hides the details read above.
    let kind: Awaited<ReturnType<typeof suggestKindWithAi>>;
    try {
      kind = await suggestKindWithAi(db, accountId, applicantId, documentVersionId);
    } catch (error) {
      reportServerError('runAiExtractionAction', error, { step: 'kind suggestion' });
      kind = undefined;
    }
    return {
      ok: true,
      message: `${readingFinished(run.value.proposals.length)}${kindSentence(kind)}`,
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * A refusal from a reading step as a sentence a person can act on. The service's own wording is for
 * logs; it can name providers and limits, so it is never shown as it is.
 */
function readingRefusal(error: ServiceError): string {
  // The feature is off or used up for today (S28): its own plain sentence, already for people.
  if (isAiFeatureRefusal(error)) return error.message;
  switch (error.code) {
    case 'consent_required':
      return 'Reading with AI is off. You can turn it on from Home.';
    case 'rate_limited':
      return 'Reading is busy right now. Try again in a minute.';
    case 'invalid':
      return 'We reached a reading limit for this file, or reading with AI is switched off for now. You can add the details yourself.';
    case 'not_found':
      return 'We could not find this file.';
    default:
      return 'The reading did not work this time. Try again later, or add the details yourself.';
  }
}

/** What a finished reading says: how many details are waiting, in plain words. */
function readingFinished(count: number): string {
  if (count === 0) return 'Reading finished. We did not find details to suggest.';
  return `Reading finished. ${count === 1 ? 'One detail is' : `${count} details are`} ready for you to check.`;
}

/**
 * Read a file again (S6, ADR 0019), on the person's request: the same two steps the automatic
 * reading takes, in the same order. A file with no text of its own is read as a picture first
 * (needs the scans switch), then details are read from the best text there is (needs the details
 * switch). Each step is the existing action, so every consent, limit, kill switch and ownership
 * check applies exactly as it does for the automatic reading, and it only ever adds suggestions.
 * Unlike the automatic reading it also works for kinds of document on the protected list, because
 * the person asked for it.
 */
export async function readAgainAction(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentVersionId = String(formData.get('documentVersionId') ?? '');
  const hasText = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) return undefined;
    return (await getLatestExtractedText(db, documentVersionId, applicantId)) !== undefined;
  });
  if (hasText === undefined) return { ok: false, message: 'Not authorized.' };
  if (!hasText) {
    const scan = await runOcrAction(previous, formData);
    if (!scan.ok) return scan;
  }
  return runAiExtractionAction(previous, formData);
}

/**
 * Run AI OCR over a document (Part 8 §9). Consent-gated on AI_OCR
 * (distinct from AI_EXTRACTION - mirrors runAiExtractionAction's own shape
 * exactly, but renders the source image first, since runOcr takes bytes as
 * an input rather than fetching them itself). The extracted text and any
 * review issues are persisted on the run row and shown on the page via
 * getLatestOcrRun, not returned through this action directly.
 */
export async function runOcrAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentVersionId = String(formData.get('documentVersionId') ?? '');

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    const resolved = await resolveOcrAdapter(db, createKeyManagementPort());
    if (!resolved) {
      return {
        ok: false,
        message: 'Reading scans with AI is not set up yet.',
      } satisfies ActionState;
    }
    const rendered = await renderOcrSourceImage(
      db,
      createStorage(db),
      createPreviewRenderer(),
      documentVersionId,
      applicantId,
    );
    if (!rendered.ok) {
      return { ok: false, message: rendered.message } satisfies ActionState;
    }
    const run = await runOcr(db, resolved.ai, {
      actorAccountId: accountId,
      applicantId,
      documentVersionId,
      imageBytes: rendered.imageBytes,
      contentType: rendered.contentType,
      feature: 'ai_document_reading',
      budgetLimitUnits: resolved.limits.budgetLimitUnits,
      perDocumentBudgetLimitUnits: resolved.limits.perDocumentBudgetLimitUnits,
      maxAttemptsPerDocument: resolved.limits.maxAttemptsPerDocument,
      cacheMaxAgeDays: resolved.limits.cacheMaxAgeDays,
      maxConcurrentCalls: resolved.limits.maxConcurrentCalls,
      killSwitchCheck: () => isAiDispatchAllowed(db),
      ...(resolved.fallback ? { fallback: resolved.fallback } : {}),
    });
    if (!run.ok) return { ok: false, message: readingRefusal(run.error) } satisfies ActionState;
    const issueCount = run.value.ocrRun.reviewIssues?.length ?? 0;
    return {
      ok: true,
      message:
        issueCount > 0
          ? `We read the text from this scan, but ${issueCount === 1 ? 'one thing needs' : `${issueCount} things need`} a look. Check the text below.`
          : 'We read the text from this scan. Check it below.',
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * Run AI document-type classification (Part 8 AI-01 item 2). Reuses the same
 * deterministically-extracted text `runAiExtractionAction` reads
 * (`getLatestExtractedText`) -- `runClassification` itself refuses to run at
 * all unless the deterministic classifier (`classification.ts`) left a
 * genuine gap, so this action never needs to check that here.
 */
export async function runClassificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentVersionId = String(formData.get('documentVersionId') ?? '');

  const result = await withSession(async ({ db, accountId }) => {
    const kind = await suggestKindWithAi(db, accountId, applicantId, documentVersionId);
    if (!kind) {
      return { ok: false, message: 'AI classification is not configured.' } satisfies ActionState;
    }
    if (!kind.ok) return { ok: false, message: plainError(kind.error) } satisfies ActionState;
    return { ok: true, message: KIND_ANSWERS[kind.value.status] } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * Ask the AI what kind of document a file is and suggest a name for it (owner request
 * 2026-10-25), through the access gate as the applicant's owner. Undefined when no AI provider
 * is set up for this, so the caller can say so; the rules' own suggestion is untouched either way.
 */
async function suggestKindWithAi(
  db: Db,
  accountId: string,
  applicantId: string,
  documentVersionId: string,
): Promise<Result<DocumentKindSuggestion, ServiceError> | undefined> {
  const resolved = await resolveAiClassifier(db, createKeyManagementPort());
  if (!resolved) return undefined;
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId },
    { purpose: 'owner_document_suggestion' },
  );
  if (!access.ok) return access;
  return suggestDocumentKind(access.value, resolved.ai, {
    documentVersionId,
    budgetLimitUnits: resolved.limits.budgetLimitUnits,
    perDocumentBudgetLimitUnits: resolved.limits.perDocumentBudgetLimitUnits,
    maxAttemptsPerDocument: resolved.limits.maxAttemptsPerDocument,
    maxPagesPerDocument: resolved.limits.maxPagesPerDocument,
    cacheMaxAgeDays: resolved.limits.cacheMaxAgeDays,
    maxConcurrentCalls: resolved.limits.maxConcurrentCalls,
    killSwitchCheck: () => isAiDispatchAllowed(db),
  });
}

/** One plain sentence on what the AI said about the kind, or nothing when it had nothing new to say. */
function kindSentence(kind: Result<DocumentKindSuggestion, ServiceError> | undefined): string {
  if (!kind?.ok) return '';
  if (kind.value.status === 'suggested') {
    return ' It also suggested what kind of document this is and a name for it. Check them below.';
  }
  return '';
}

/** What the kind button says for each answer. */
const KIND_ANSWERS: Readonly<Record<DocumentKindSuggestion['status'], string>> = {
  suggested: 'We suggested what kind of document this is and a name for it. Check them below.',
  no_suggestion: 'We could not tell what kind of document this is. Choose the kind above.',
  kind_already_set: 'You already chose what kind of document this is. Nothing was changed.',
  already_suggested: 'A suggestion for this document is already waiting below.',
  rules_confident: 'We already know what kind of document this is. Check the suggestion below.',
};

/**
 * Why there was no room for a converted iPhone photo that came out larger than the photo sent: a
 * plain sentence for the person, and an accurate reason for the upload record (counts and causes,
 * never a name).
 */
function convertedCopyRefusal(
  error: ServiceError,
  maxUploadBytes: number,
): { readonly message: string; readonly reason: string } {
  const text = error.message;
  if (error.code === 'invalid' && text.includes('upload limit')) {
    return {
      message: `The converted copy is larger than the ${mbLabel(maxUploadBytes)} limit. Choose a smaller photo, or a JPG or PNG copy.`,
      reason: 'converted copy: larger than the per-file limit',
    };
  }
  // An agency's plan or billing refusal is typed (S30): the traveller's sentence never names the
  // agency's billing, and the upload record keeps the accurate cause.
  if (error.reason === 'billing_suspended' || error.reason === 'limit_reached') {
    return {
      message: plainError(error),
      reason:
        error.reason === 'billing_suspended'
          ? 'converted copy: organization billing suspended'
          : 'converted copy: organization plan storage limit',
    };
  }
  const quota = (
    [
      ['applicant has reached', 'applicant evidence limit', true],
      ['account has reached', 'account evidence limit', true],
      ['platform storage capacity', 'platform capacity', true],
    ] as const
  ).find(([phrase]) => text.includes(phrase));
  if (error.code === 'invalid' && quota) {
    return {
      message: quota[2]
        ? `The converted copy does not fit in the storage space left. ${plainError(error)}`
        : plainError(error),
      reason: `converted copy: ${quota[1]}`,
    };
  }
  if (error.code === 'not_found') {
    return {
      message: 'This upload took too long and was stopped. Try again.',
      reason: 'converted copy: reservation no longer active',
    };
  }
  return {
    message: plainError(error),
    reason: `converted copy: reservation could not grow (${error.code})`,
  };
}

/** A service refusal as a sentence a person can read. */
function plainError(error: ServiceError): string {
  const text = error.message.trim();
  if (text.length === 0) return 'Something went wrong. Try again.';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}

/**
 * Give a document a name of the person's own (UX-B). The owner only, through the access gate
 * with a proof for this one document; the name is cleaned and saved with its history.
 */
export async function renameDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const name = String(formData.get('name') ?? '');
  if (name.trim().length === 0) {
    return { ok: false, message: 'Enter a name for this document.', field: 'name' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { documentId },
      { purpose: 'owner_document_rename' },
    );
    if (!access.ok || access.value.applicant.id !== applicantId) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    const renamed = await renameDocument(access.value, { name });
    if (!renamed.ok) {
      return {
        ok: false,
        message: plainError(renamed.error),
        ...(renamed.error.code === 'invalid' ? { field: 'name' } : {}),
      } satisfies ActionState;
    }
    return {
      ok: true,
      message: 'Name saved. It shows everywhere this document is listed.',
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * Accept, edit or skip what we think a document is and what to call it (owner request
 * 2026-10-25). Accepting saves the kind and the name together; skipping changes nothing. The
 * owner only, through the access gate.
 */
export async function decideDocumentSuggestionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const optionalId = (key: string): string | null => {
    const value = String(formData.get(key) ?? '').trim();
    return value.length > 0 ? value : null;
  };
  const nameVersionId = optionalId('nameVersionId');
  const typeProposalId = optionalId('typeProposalId');
  const decision = String(formData.get('suggestionAction') ?? '');
  const docType = String(formData.get('docType') ?? '').trim();
  const subject = String(formData.get('subject') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();

  if (decision !== 'accept' && decision !== 'skip') {
    return { ok: false, message: 'Unknown action.' };
  }
  if (decision === 'accept' && docType.length === 0) {
    return { ok: false, message: 'Choose what kind of document this is.', field: 'docType' };
  }
  if (decision === 'accept' && name.length === 0) {
    return { ok: false, message: 'Enter a name for this document.', field: 'name' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { documentId },
      { purpose: 'owner_document_suggestion' },
    );
    if (!access.ok || access.value.applicant.id !== applicantId) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    const decided = await decideDocumentSuggestion(
      access.value,
      decision === 'accept'
        ? { decision, nameVersionId, typeProposalId, docType, subject, name }
        : { decision, nameVersionId, typeProposalId },
    );
    if (!decided.ok) return { ok: false, message: plainError(decided.error) } satisfies ActionState;
    return {
      ok: true,
      message:
        decided.value.decision === 'accept'
          ? `Saved. It is listed under ${recordGroupOfDocType(decided.value.docType)} on your Record.`
          : 'Skipped. Nothing was changed.',
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * Decide a PENDING AI document-type suggestion (Part 8 AI-01 item 2):
 * approve or reject. Never applied silently -- approving reuses the exact
 * same downstream effects (`documents.docType`, naming proposal) the
 * deterministic classification path already has (see
 * `approveDocumentTypeProposal`'s own doc comment).
 */
export async function decideClassificationProposalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');
  const decision = String(formData.get('proposalAction') ?? '');

  if (decision !== 'approve' && decision !== 'reject') {
    return { ok: false, message: 'Unknown action.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    if (decision === 'reject') {
      const rejected = await rejectDocumentTypeProposal(db, {
        actorAccountId: accountId,
        proposalId,
      });
      if (!rejected.ok) return { ok: false, message: rejected.error.message } satisfies ActionState;
      return { ok: true, message: 'Suggestion rejected.' } satisfies ActionState;
    }
    const approved = await approveDocumentTypeProposal(db, {
      actorAccountId: accountId,
      proposalId,
    });
    if (!approved.ok) return { ok: false, message: approved.error.message } satisfies ActionState;
    return {
      ok: true,
      message: documentTypeSavedLine(documentTypeLabel(approved.value.suggestedType)),
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * Decide a PENDING AI field proposal (Build Spec §8): approve — optionally
 * with a human-edited value — or reject. Never applied silently.
 */
export async function decideProposalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');
  const decision = String(formData.get('proposalAction') ?? '');
  const correctedValue = String(formData.get('correctedValue') ?? '').trim();
  const resolutionRaw = String(formData.get('resolution') ?? '');
  const effectiveFromRaw = String(formData.get('effectiveFrom') ?? '').trim();

  if (decision !== 'approve' && decision !== 'reject') {
    return { ok: false, message: 'Unknown action.' };
  }
  if (resolutionRaw && !['use_document', 'changed', 'keep'].includes(resolutionRaw)) {
    return { ok: false, message: 'Choose which value is right.', field: 'resolution' };
  }
  let effectiveFrom: Date | undefined;
  if (decision === 'approve' && resolutionRaw === 'changed') {
    // A real calendar day (no 31 February rolling into March), and not in the future.
    const parsed = new Date(`${effectiveFromRaw}T00:00:00Z`);
    if (
      !isValidDocumentDateString(effectiveFromRaw) ||
      parsed.toISOString().slice(0, 10) !== effectiveFromRaw
    ) {
      return {
        ok: false,
        message: 'Enter the date it changed. It cannot be in the future.',
        field: 'effectiveFrom',
      };
    }
    effectiveFrom = parsed;
  }

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    // "Keep my current value" changes nothing: the reading is set aside like a skip.
    if (decision === 'reject' || resolutionRaw === 'keep') {
      const rejected = await rejectProposal(db, {
        actorAccountId: accountId,
        proposalId,
        ...(resolutionRaw === 'keep' ? { reason: 'kept_existing' } : {}),
      });
      if (!rejected.ok) return { ok: false, message: rejected.error.message } satisfies ActionState;
      return {
        ok: true,
        message:
          resolutionRaw === 'keep'
            ? 'Kept your current value. Nothing was changed.'
            : 'Skipped. Nothing was saved.',
      } satisfies ActionState;
    }
    const encryption = createKeyManagementPort();
    const approved = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId,
      ...(correctedValue ? { correctedValue } : {}),
      ...(resolutionRaw === 'use_document' || resolutionRaw === 'changed'
        ? { resolution: resolutionRaw }
        : {}),
      ...(effectiveFrom ? { effectiveFrom } : {}),
      ...(encryption ? { encryption } : {}),
    });
    if (!approved.ok) return { ok: false, message: approved.error.message } satisfies ActionState;
    return {
      ok: true,
      message:
        approved.value.version.status === 'CONFLICTED'
          ? 'Saved, and marked to check: it differs from a detail you had confirmed.'
          : resolutionRaw === 'changed'
            ? 'Saved as the new value. The earlier one stays in your history.'
            : SUGGESTION_SAVED_LINE,
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/** "Accept all clear details" for one document; the service checks every rule again. */
export async function acceptClearDetailsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const proposalIds = formData
    .getAll('proposalId')
    .map((id) => String(id))
    .filter((id) => id.length > 0)
    .slice(0, 100);
  if (proposalIds.length === 0) return { ok: false, message: 'Nothing to accept.' };

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    const encryption = createKeyManagementPort();
    const accepted = await approveClearProposals(db, {
      actorAccountId: accountId,
      applicantId,
      proposalIds,
      ...(encryption ? { encryption } : {}),
    });
    if (!accepted.ok) return { ok: false, message: accepted.error.message } satisfies ActionState;
    return { ok: true, message: describeClearAcceptance(accepted.value) } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * Run an AI possible-inconsistency check (Part 8 AI-01 item 4). Reuses the
 * same deterministically-extracted text the extraction/classification
 * actions read (`getLatestExtractedText`) -- `runInconsistencyCheck` itself
 * fetches the applicant's own TRUSTED profile facts and never a second
 * document, so this action passes only the document text.
 */
export async function runInconsistencyCheckAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentVersionId = String(formData.get('documentVersionId') ?? '');

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    const resolved = await resolveAiInconsistencyChecker(db, createKeyManagementPort());
    if (!resolved) {
      return {
        ok: false,
        message: 'AI inconsistency checking is not configured.',
      } satisfies ActionState;
    }
    const text = await getLatestExtractedText(db, documentVersionId, applicantId);
    if (!text) {
      return {
        ok: false,
        message: 'No extracted text available yet for this document.',
      } satisfies ActionState;
    }
    const run = await runInconsistencyCheck(db, resolved.ai, {
      actorAccountId: accountId,
      applicantId,
      documentVersionId,
      text,
      budgetLimitUnits: resolved.limits.budgetLimitUnits,
      perDocumentBudgetLimitUnits: resolved.limits.perDocumentBudgetLimitUnits,
      maxAttemptsPerDocument: resolved.limits.maxAttemptsPerDocument,
      maxPagesPerDocument: resolved.limits.maxPagesPerDocument,
      cacheMaxAgeDays: resolved.limits.cacheMaxAgeDays,
      maxConcurrentCalls: resolved.limits.maxConcurrentCalls,
      killSwitchCheck: () => isAiDispatchAllowed(db),
    });
    if (!run.ok) return { ok: false, message: run.error.message } satisfies ActionState;
    return {
      ok: true,
      message:
        run.value.flags.length > 0
          ? `AI found ${run.value.flags.length} possible inconsistency(ies) to review.`
          : 'AI inconsistency check ran and found nothing to flag.',
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * Decide a PENDING AI inconsistency flag (Part 8 AI-01 item 4): acknowledge
 * or dismiss. Purely advisory -- neither decision ever writes to the
 * Master Profile (see `acknowledgeInconsistencyFlag`'s own doc comment).
 */
export async function decideInconsistencyFlagAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const flagId = String(formData.get('flagId') ?? '');
  const decision = String(formData.get('flagAction') ?? '');

  if (decision !== 'acknowledge' && decision !== 'dismiss') {
    return { ok: false, message: 'Unknown action.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    const decided = await (decision === 'acknowledge'
      ? acknowledgeInconsistencyFlag(db, { actorAccountId: accountId, flagId })
      : dismissInconsistencyFlag(db, { actorAccountId: accountId, flagId }));
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    return {
      ok: true,
      message: decision === 'acknowledge' ? 'Flag acknowledged.' : 'Flag dismissed.',
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/** Existing scan and normalization approval are prerequisites, never bypassed. */
export async function requestDocumentReadingAction(formData: FormData): Promise<void> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const result = await withSession(({ db, accountId }) =>
    requestDocumentReExtraction(db, {
      actorAccountId: accountId,
      documentId,
      expectedVersionId: String(formData.get('versionId') ?? ''),
    }),
  );
  const base = `/app/applicant/${encodeURIComponent(applicantId)}/documents?document=${encodeURIComponent(documentId)}`;
  if (!result.ok) redirect(`${base}&reading_error=${encodeURIComponent(result.error.message)}`);
  revalidatePath(`/app/applicant/${applicantId}/documents`);
  after(() => triggerIntakeAndReading());
  redirect(`${base}&reading_queued=true`);
}
