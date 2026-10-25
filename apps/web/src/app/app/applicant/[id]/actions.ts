'use server';

import { createHash } from 'node:crypto';
import type { ApplicantId, Result } from '@visastack/core';
import type { Actor, Db, DocumentKindSuggestion, ServiceError } from '@visastack/services';
import type { AddDocumentVersionResult } from '@visastack/services';
import {
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
  isAiDispatchAllowed,
  isValidDocumentDateString,
  loadUploadQuotaConfig,
  mbLabel,
  prepareDocumentKind,
  previewDocument,
  registerDocumentWithVersion,
  registerFieldDefinition,
  rejectDocumentTypeProposal,
  rejectProposal,
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
import { triggerIntakeWorker } from '../../../../lib/jobs';
import { savableField } from '../../../../lib/master-profile';
import { createKeyManagementPort, createPreviewRenderer } from '../../../../lib/providers';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';
import { permitsPdfAdmission, validateUploadBytes } from '../../../../lib/upload-preflight';
import { describeClearAcceptance } from './ai-review-messages';
import { recordGroupOfDocType } from './record-groups';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
  /** The input a problem is about, when the action knows (the form marks it invalid and moves focus to it). */
  readonly field?: string;
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
    await registerFieldDefinition(db, {
      key: def.key,
      dataType: def.type === 'date' ? 'date' : 'string',
      sensitivity: def.sensitivity,
      repeating: def.repeating,
      packId: def.packId,
    });
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
    return { ok: true, message: `${def.label} saved.` } satisfies ActionState;
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

  const contentType = file.type || 'application/octet-stream';
  const originalName = file.name || 'document';

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
    const intent = reservation.value;
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
      { ok: true; version: AddDocumentVersionResult } | { ok: false; message: string }
    > => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength !== file.size) {
          // The browser's declared size didn't match what was actually read —
          // fail closed rather than trust a mismatched declaration.
          await failUpload(
            db,
            intent.id,
            `declared size ${file.size} did not match actual bytes read ${bytes.byteLength}`,
          );
          return { ok: false, message: 'Upload failed: the file changed while uploading.' };
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');

        if (
          !validateUploadBytes(
            bytes,
            contentType,
            permitsPdfAdmission(readEnv('MALWARE_SCANNER_PROVIDER')),
            quotaConfig.maxUploadBytes,
          )
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
          originalName,
          source: 'UPLOAD',
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
        return { ok: true, version: created.value };
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
    after(() => triggerIntakeWorker());

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
    const duplicateNote =
      duplicates.length > 0
        ? ` This looks identical to ${duplicates.map((d) => `"${d.displayName}"`).join(', ')}, already in the vault.`
        : '';

    return {
      ok: true,
      message: `${originalName} uploaded and queued for a safety scan.${duplicateNote}`,
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
      return { ok: false, message: 'AI extraction is not configured.' } satisfies ActionState;
    }
    const text = await getLatestExtractedText(db, documentVersionId);
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
      budgetLimitUnits: resolved.limits.budgetLimitUnits,
      perDocumentBudgetLimitUnits: resolved.limits.perDocumentBudgetLimitUnits,
      maxAttemptsPerDocument: resolved.limits.maxAttemptsPerDocument,
      maxPagesPerDocument: resolved.limits.maxPagesPerDocument,
      cacheMaxAgeDays: resolved.limits.cacheMaxAgeDays,
      maxConcurrentCalls: resolved.limits.maxConcurrentCalls,
      killSwitchCheck: () => isAiDispatchAllowed(db),
      ...(resolved.fallback ? { fallback: resolved.fallback } : {}),
    });
    // The same reading also says what kind of document this is and suggests a name (owner
    // request 2026-10-25). Its own failure never undoes or hides the details read above.
    let kind: Awaited<ReturnType<typeof suggestKindWithAi>>;
    try {
      kind = await suggestKindWithAi(db, accountId, applicantId, documentVersionId);
    } catch (error) {
      reportServerError('runAiExtractionAction', error, { step: 'kind suggestion' });
      kind = undefined;
    }
    if (!run.ok) return { ok: false, message: run.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `AI extraction proposed ${run.value.proposals.length} field(s) for review.${kindSentence(kind)}`,
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
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
      return { ok: false, message: 'AI OCR is not configured.' } satisfies ActionState;
    }
    const rendered = await renderOcrSourceImage(
      db,
      createStorage(db),
      createPreviewRenderer(),
      documentVersionId,
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
      budgetLimitUnits: resolved.limits.budgetLimitUnits,
      perDocumentBudgetLimitUnits: resolved.limits.perDocumentBudgetLimitUnits,
      maxAttemptsPerDocument: resolved.limits.maxAttemptsPerDocument,
      cacheMaxAgeDays: resolved.limits.cacheMaxAgeDays,
      maxConcurrentCalls: resolved.limits.maxConcurrentCalls,
      killSwitchCheck: () => isAiDispatchAllowed(db),
      ...(resolved.fallback ? { fallback: resolved.fallback } : {}),
    });
    if (!run.ok) return { ok: false, message: run.error.message } satisfies ActionState;
    const issueCount = run.value.ocrRun.reviewIssues?.length ?? 0;
    return {
      ok: true,
      message:
        issueCount > 0
          ? `OCR completed, but flagged ${issueCount} review issue(s) - check the extracted text below.`
          : 'OCR completed successfully.',
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
    return {
      ok: true,
      message:
        kindSentence(kind).trim() ||
        'We could not tell what kind of document this is. Choose the kind above.',
    } satisfies ActionState;
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

/** A service refusal as a sentence a person can read. */
function plainError(error: ServiceError): string {
  const text = error.message.trim();
  if (text.length === 0) return 'Something went wrong. Try again.';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
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
      message: 'Document type approved and saved.',
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
            : 'Saved to your profile.',
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
    const text = await getLatestExtractedText(db, documentVersionId);
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
  after(() => triggerIntakeWorker());
  redirect(`${base}&reading_queued=true`);
}
