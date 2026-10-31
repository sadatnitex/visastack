import { createHash, randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { invoiceLedgerReader } from './billing';
import { type Db, first, required, schema } from './db';
import { type ServiceError, refusal, serviceError } from './errors';
import {
  type ImageSanitizerPort,
  isAcceptableSanitizedImage,
  isImageTooLargeError,
} from './image-sanitizer';
import type { MalwareScannerPort } from './intake';
import {
  type CollectionRefusal,
  REFUNDED_INVOICE_MESSAGE,
  applyInvoiceCollection,
  invoiceHasRefund,
  isValidMinorUnitAmount,
  normalizeCurrency,
  outstandingMinorUnits,
} from './invoice-ledger';
import { isMissingRelationError } from './missing-relation';
import { isOrgAdmin } from './organizations';
import { formatAmountForCurrency, parseAmountForCurrency } from './payment-amounts';
import { type PlatformAuthInput, isPlatformOwner } from './platform-roles';
import { RATE_LIMITS, checkRateLimits } from './rate-limit';
import type { PaymentReceipt } from './receipts';
import type { BlobStore } from './storage';
import {
  discardStorageObject as discardObject,
  registerStorageObject as registerObject,
} from './storage-objects';

/**
 * "I Paid Another Way" (Small Commercial V1 S12, ADR 0020): an agency owner or admin reports a
 * payment made outside VisaStack (a bank transfer, bKash, a cheque), and a platform owner confirms
 * or rejects it.
 *
 * The one rule: a report records no money. It is a claim, waiting. Money enters the ledger only
 * when a platform owner approves it, with a fresh sign-in check, and then only through
 * `applyInvoiceCollection` (kind MANUAL_CLAIM, the claim as the source), so an approval is
 * recorded once however many times it is clicked, a claim that no longer fits (the invoice was
 * paid another way meanwhile) is refused with a plain message, and the receipt is issued in the
 * same transaction. A rejection needs a reason the agency can read.
 *
 * The optional proof of payment (a bank slip, a screenshot) is an agency billing file: stored
 * only after the safety scanner the platform has configured passed it (the structural check
 * for photos, ClamAV when it is switched on; a PDF can only be cleared by ClamAV, so without it
 * the person is asked for a photo instead). A photo is then re-encoded server side (S27), so
 * only image data is ever kept. It lives in its own table and its own object-key prefix,
 * readable only by the agency's owners and admins and by platform staff. It is never attached to
 * a traveller record, never part of a share, pack or export.
 *
 * Only an owner or admin of the agency the invoice belongs to can report. Anyone else (another
 * agency, an ordinary member, a stranger) gets "invoice not found", the same as for an invoice
 * that does not exist. Audit records carry ids, the method, the amount and the currency; never
 * the reference, the note or the file.
 *
 * Every function tolerates migration 0097 not having run: it says "not available yet" and
 * writes nothing.
 */

export type ManualPaymentClaim = typeof schema.manualPaymentClaims.$inferSelect;
export type ManualClaimMethod = ManualPaymentClaim['method'];
export type ManualClaimStatus = ManualPaymentClaim['status'];

/** Pinned to the database enum by a test (the schema is never read at load). */
export const MANUAL_CLAIM_METHODS: readonly ManualClaimMethod[] = [
  'BANK_TRANSFER',
  'BKASH',
  'CHEQUE',
  'OTHER',
];
export const CLAIM_REFERENCE_MAX = 120;
export const CLAIM_NOTE_MAX = 500;
export const CLAIM_REASON_MAX = 500;
/** Below the 4.5 MB request size the hosting platform accepts, the same ceiling document uploads use. */
export const PROOF_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const PROOF_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
const PROOF_KEY_PREFIX = 'billing-receipt-';
const PROOF_UPLOAD_KEY_PREFIX = 'billing-receipt-upload-';
/** A payment cannot have been made later than this far ahead (clock and time zone slack). */
const FUTURE_SLACK_MS = 36 * 60 * 60 * 1000;

const CLAIMS_RELATION = 'manual_payment_claims';
const UNAVAILABLE = 'Reporting a payment is not available yet. Please try again later.';

/** Whether migration 0097 has created the claim tables. Never raises, so a surrounding transaction is never aborted. */
export async function manualClaimsPresent(db: Db): Promise<boolean> {
  const rows = await db
    .select({ present: sql<boolean>`to_regclass(${CLAIMS_RELATION}::text) is not null` })
    .from(sql`(select 1) as probe`);
  return rows[0]?.present === true;
}

export interface ProofFilePorts {
  readonly storage: BlobStore;
  readonly scanner: MalwareScannerPort;
  /** Re-encodes a JPEG or PNG proof so only image data is stored (S27). */
  readonly images: ImageSanitizerPort;
}

/** The longest side a stored proof photo may have (a bank slip stays readable) and the pixel ceiling. */
export const PROOF_IMAGE_MAX_DIMENSION = 4096;
export const PROOF_IMAGE_MAX_INPUT_PIXELS = 40_000_000;
/** The largest cleaned proof photo that may be stored; the upload limit people see stays 4 MB. */
export const PROOF_IMAGE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface ProofFileInput {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

const SIGNATURES: Readonly<Record<(typeof PROOF_FILE_TYPES)[number], readonly number[]>> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function proofFileProblem(file: ProofFileInput): ServiceError | undefined {
  const type = file.contentType as (typeof PROOF_FILE_TYPES)[number];
  if (!(PROOF_FILE_TYPES as readonly string[]).includes(file.contentType)) {
    return refusal('claim_proof_invalid', 'Attach a PDF, JPEG or PNG file.');
  }
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > PROOF_FILE_MAX_BYTES) {
    return refusal('claim_proof_invalid', 'Attach a file smaller than 4 MB.');
  }
  const signature = SIGNATURES[type];
  if (!signature.every((value, i) => file.bytes[i] === value)) {
    return refusal('claim_proof_invalid', 'This file is not the kind of file it says it is.');
  }
  return undefined;
}

interface StoredProof {
  readonly storageObjectId: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: string;
}

/**
 * Quarantine, read back, scan, then write to the clean bucket under a billing key and read back
 * again. Nothing is attached to a claim until every step passed. The quarantined copy is always
 * deleted. A photo is stored as its server re-encoded copy, never as uploaded; a PDF (only ever
 * cleared by the real ClamAV engine) is kept exactly as uploaded.
 */
async function scanAndStoreProof(
  db: Db,
  ports: ProofFilePorts,
  file: ProofFileInput,
): Promise<Result<StoredProof, ServiceError>> {
  const sha256 = sha256Hex(file.bytes);
  const quarantineKey = `${PROOF_UPLOAD_KEY_PREFIX}${randomUUID()}`;
  const quarantineId = await registerObject(db, 'QUARANTINE', quarantineKey, file.bytes, sha256);
  let clean: { storageObjectId: string; objectKey: string } | undefined;
  try {
    await ports.storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: quarantineKey,
      contentType: file.contentType,
      bytes: file.bytes,
    });
    const stored = await ports.storage.getObject(quarantineKey);
    if (!stored || sha256Hex(stored.bytes) !== sha256) {
      return err(serviceError('invalid', 'The file did not upload correctly. Please try again.'));
    }
    const scan = await ports.scanner.scan({ bucket: 'QUARANTINE', objectKey: quarantineKey });
    if (!scan.safe) {
      return err(
        refusal(
          'claim_proof_invalid',
          file.contentType === 'application/pdf'
            ? 'We could not check this PDF for safety here. Attach a photo or screenshot of it (JPEG or PNG) instead.'
            : 'This file did not pass the safety check.',
        ),
      );
    }
    let keep: { readonly bytes: Uint8Array; readonly contentType: string } = {
      bytes: stored.bytes,
      contentType: file.contentType,
    };
    if (file.contentType !== 'application/pdf') {
      const unreadable = err(
        refusal('claim_proof_invalid', 'This image could not be read. Try a JPEG or PNG file.'),
      );
      let image: Awaited<ReturnType<ImageSanitizerPort['sanitize']>>;
      try {
        image = await ports.images.sanitize({
          bytes: stored.bytes,
          maxInputPixels: PROOF_IMAGE_MAX_INPUT_PIXELS,
          maxDimension: PROOF_IMAGE_MAX_DIMENSION,
          maxOutputBytes: PROOF_IMAGE_MAX_OUTPUT_BYTES,
        });
      } catch (error) {
        return isImageTooLargeError(error)
          ? err(
              refusal(
                'claim_proof_invalid',
                'This image is too large after cleaning. Try a smaller photo or screenshot.',
              ),
            )
          : unreadable;
      }
      if (
        !isAcceptableSanitizedImage(image, {
          maxBytes: PROOF_IMAGE_MAX_OUTPUT_BYTES,
          maxDimension: PROOF_IMAGE_MAX_DIMENSION,
        })
      ) {
        return unreadable;
      }
      keep = { bytes: image.bytes, contentType: image.contentType };
    }
    const keptSha256 = sha256Hex(keep.bytes);
    const cleanKey = `${PROOF_KEY_PREFIX}${randomUUID()}`;
    const cleanId = await registerObject(db, 'CLEAN', cleanKey, keep.bytes, keptSha256);
    clean = { storageObjectId: cleanId, objectKey: cleanKey };
    await ports.storage.putObject({
      bucket: 'CLEAN',
      objectKey: cleanKey,
      contentType: keep.contentType,
      bytes: keep.bytes,
    });
    const copy = await ports.storage.getObject(cleanKey);
    if (!copy || sha256Hex(copy.bytes) !== keptSha256) {
      await discardObject(db, ports.storage, 'CLEAN', clean);
      return err(serviceError('invalid', 'The file did not save correctly. Please try again.'));
    }
    return ok({
      storageObjectId: cleanId,
      objectKey: cleanKey,
      sha256: keptSha256,
      sizeBytes: keep.bytes.byteLength,
      contentType: keep.contentType,
    });
  } catch (error) {
    if (clean) await discardObject(db, ports.storage, 'CLEAN', clean);
    throw error;
  } finally {
    await discardObject(db, ports.storage, 'QUARANTINE', {
      storageObjectId: quarantineId,
      objectKey: quarantineKey,
    });
  }
}

// --- Reading ----------------------------------------------------------------------------------

/** Who is asking: the agency's owners and admins, or platform staff. The same rule as the cash ledger. */
export interface ClaimReader {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly actorEmail?: string;
  readonly bootstrapEmails?: readonly string[];
}

export interface ManualClaimView {
  readonly id: string;
  readonly invoiceId: string;
  readonly invoiceRef: string;
  /** What the invoice still owes right now (not at the time of the report). */
  readonly invoiceOutstandingMinorUnits: number;
  readonly method: ManualClaimMethod;
  readonly reference: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly paidOn: Date;
  readonly note: string | null;
  readonly status: ManualClaimStatus;
  readonly decidedAt: Date | null;
  /** Why it was rejected; null for the other states. */
  readonly decisionReason: string | null;
  readonly createdAt: Date;
  readonly hasProofFile: boolean;
  /** Platform staff only: the people involved. Null for the agency. */
  readonly submittedByAccountId: string | null;
  readonly decidedByAccountId: string | null;
}

const NOT_ALLOWED = 'not allowed to see these payment reports';

/**
 * The payment reports of one agency (optionally of one invoice or one state), newest first.
 * Readable by the agency's owners and admins or by a platform owner. Only the named agency's
 * reports are ever read. Empty while the claim tables do not exist yet.
 */
export async function listManualClaims(
  db: Db,
  input: ClaimReader & { readonly invoiceId?: string; readonly status?: ManualClaimStatus },
): Promise<Result<ManualClaimView[], ServiceError>> {
  const reader = await invoiceLedgerReader(db, input);
  if (reader === null) return err(serviceError('forbidden', NOT_ALLOWED));
  const claims = schema.manualPaymentClaims;
  const filters = [eq(claims.organizationId, input.organizationId)];
  if (input.invoiceId !== undefined) filters.push(eq(claims.invoiceId, input.invoiceId));
  if (input.status !== undefined) filters.push(eq(claims.status, input.status));
  try {
    const rows = await db
      .select({
        claim: claims,
        invoiceRef: schema.invoices.invoiceRef,
        invoiced: schema.invoices.invoicedAmountMinorUnits,
        collected: schema.invoices.collectedAmountMinorUnits,
        proofId: schema.billingReceipts.id,
      })
      .from(claims)
      .innerJoin(schema.invoices, eq(schema.invoices.id, claims.invoiceId))
      .leftJoin(schema.billingReceipts, eq(schema.billingReceipts.claimId, claims.id))
      .where(and(...filters))
      .orderBy(desc(claims.createdAt))
      .limit(200);
    const platform = reader === 'platform';
    return ok(
      rows.map(({ claim, invoiceRef, invoiced, collected, proofId }) => ({
        id: claim.id,
        invoiceId: claim.invoiceId,
        invoiceRef,
        invoiceOutstandingMinorUnits: outstandingMinorUnits(invoiced, collected),
        method: claim.method,
        reference: claim.reference,
        amountMinorUnits: claim.amountMinorUnits,
        currency: claim.currency,
        paidOn: claim.paidOn,
        note: claim.note,
        status: claim.status,
        decidedAt: claim.decidedAt,
        decisionReason: claim.decisionReason,
        createdAt: claim.createdAt,
        hasProofFile: proofId !== null,
        submittedByAccountId: platform ? claim.submittedByAccountId : null,
        decidedByAccountId: platform ? claim.decidedByAccountId : null,
      })),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return ok([]);
    throw error;
  }
}

/**
 * Whether a stored object is a payment proof attached to a report. The orphan sweep asks this
 * before it removes a storage record, so a proof whose bytes went missing is reported, never
 * deleted from under its report. False while the claim tables do not exist yet.
 */
export async function billingFileReferenced(db: Db, storageObjectId: string): Promise<boolean> {
  const present = await db
    .select({ present: sql<boolean>`to_regclass('billing_receipts'::text) is not null` })
    .from(sql`(select 1) as probe`);
  if (present[0]?.present !== true) return false;
  const row = first(
    await db
      .select({ id: schema.billingReceipts.id })
      .from(schema.billingReceipts)
      .where(eq(schema.billingReceipts.storageObjectId, storageObjectId))
      .limit(1),
  );
  return row !== undefined;
}

export interface ProofFileBytes {
  readonly bytes: Uint8Array;
  readonly contentType: (typeof PROOF_FILE_TYPES)[number];
}

/**
 * The proof of payment attached to a report. Same readers as the report itself; looked up inside
 * the named agency only, so another agency's file looks exactly like a missing one. The bytes are
 * checked against the hash taken when they were scanned.
 */
export async function readClaimProofFile(
  db: Db,
  storage: BlobStore,
  input: ClaimReader & { readonly claimId: string },
): Promise<Result<ProofFileBytes, ServiceError>> {
  const reader = await invoiceLedgerReader(db, input);
  if (reader === null) return err(serviceError('forbidden', NOT_ALLOWED));
  const notFound = err(serviceError('not_found', 'file not found'));
  try {
    const row = first(
      await db
        .select({
          contentType: schema.billingReceipts.contentType,
          contentSha256: schema.billingReceipts.contentSha256,
          objectKey: schema.storageObjects.objectKey,
        })
        .from(schema.billingReceipts)
        .innerJoin(
          schema.storageObjects,
          eq(schema.storageObjects.id, schema.billingReceipts.storageObjectId),
        )
        .where(
          and(
            eq(schema.billingReceipts.claimId, input.claimId),
            eq(schema.billingReceipts.organizationId, input.organizationId),
          ),
        )
        .limit(1),
    );
    if (!row || !(PROOF_FILE_TYPES as readonly string[]).includes(row.contentType)) return notFound;
    const stored = await storage.getObject(row.objectKey);
    if (!stored || sha256Hex(stored.bytes) !== row.contentSha256) return notFound;
    // A bank slip is personal financial data: every read is recorded (who, which report, as
    // agency or as staff), and a read that cannot be recorded is not served.
    await db.transaction((tx) =>
      appendAuditEvent(tx, {
        eventType: 'BILLING_PROOF_VIEWED',
        actorAccountId: input.actorAccountId,
        action: 'DOWNLOAD_ORIGINAL',
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'manual_payment_claim',
        resourceId: input.claimId,
        metadata: { organizationId: input.organizationId, viewer: reader },
      }),
    );
    return ok({
      bytes: stored.bytes,
      contentType: row.contentType as (typeof PROOF_FILE_TYPES)[number],
    });
  } catch (error) {
    if (isMissingRelationError(error)) return notFound;
    throw error;
  }
}

// --- Reporting a payment ----------------------------------------------------------------------

export interface SubmitManualClaimInput {
  readonly actorAccountId: string;
  readonly invoiceId: string;
  readonly method: string;
  /** A short outside reference: a transfer id, a bKash transaction id, a cheque number. */
  readonly reference: string;
  /** Whole minor units, up to what the invoice still owes. Give this or `amountText`. */
  readonly amountMinorUnits?: number;
  /**
   * The amount as the person typed it ("1,250.50"), read in the invoice's own stored currency,
   * never in one the form names (S30). Give this or `amountMinorUnits`.
   */
  readonly amountText?: string;
  /** Optional. When given it must be the invoice's currency. */
  readonly currency?: string;
  /** The day the money was sent. */
  readonly paidOn: Date;
  readonly note?: string;
  readonly proofFile?: ProofFileInput;
  readonly now?: Date;
}

function money(currency: string, minorUnits: number): string {
  return formatAmountForCurrency(minorUnits, currency);
}

/** Why an invoice cannot take a report for this amount, in plain words, or null when it can. */
function invoiceProblem(
  invoice: {
    readonly status: string;
    readonly invoicedAmountMinorUnits: number;
    readonly collectedAmountMinorUnits: number;
    readonly currency: string;
  },
  amountMinorUnits: number,
  currency: string | undefined,
): ServiceError | null {
  if (invoice.status === 'VOID') {
    return serviceError('invalid', 'This invoice was cancelled. There is nothing to pay.');
  }
  const outstanding = outstandingMinorUnits(
    invoice.invoicedAmountMinorUnits,
    invoice.collectedAmountMinorUnits,
  );
  if (invoice.status === 'PAID' || outstanding === 0) {
    return serviceError(
      'invalid',
      'This invoice is already paid. There is nothing left to report.',
    );
  }
  if (
    currency !== undefined &&
    normalizeCurrency(currency) !== normalizeCurrency(invoice.currency)
  ) {
    return refusal(
      'currency_mismatch',
      `This invoice is in ${normalizeCurrency(invoice.currency)}. Report the payment in ${normalizeCurrency(invoice.currency)}.`,
    );
  }
  if (amountMinorUnits > outstanding) {
    return refusal(
      'amount_over_balance',
      `The amount is more than the ${money(invoice.currency, outstanding)} still owed on this invoice. Enter the amount you paid, up to ${money(invoice.currency, outstanding)}.`,
    );
  }
  return null;
}

/** Why a typed claim amount was refused. */
export const CLAIM_AMOUNT_PROBLEM =
  'Enter the amount you paid as a plain number, for example 1250.50.';

function inputProblem(input: SubmitManualClaimInput, now: Date): ServiceError | null {
  if (!(MANUAL_CLAIM_METHODS as readonly string[]).includes(input.method)) {
    return refusal('claim_method_invalid', 'Choose how you paid.');
  }
  const reference = input.reference.trim();
  if (reference.length === 0 || reference.length > CLAIM_REFERENCE_MAX) {
    return refusal(
      'claim_reference_invalid',
      `Enter the payment reference (a transfer id or cheque number), up to ${CLAIM_REFERENCE_MAX} characters.`,
    );
  }
  if ((input.note ?? '').trim().length > CLAIM_NOTE_MAX) {
    return refusal('claim_note_invalid', `Keep the note under ${CLAIM_NOTE_MAX} characters.`);
  }
  if ((input.amountMinorUnits === undefined) === (input.amountText === undefined)) {
    return refusal('amount_invalid', CLAIM_AMOUNT_PROBLEM);
  }
  if (input.amountMinorUnits !== undefined && !isValidMinorUnitAmount(input.amountMinorUnits)) {
    return refusal('amount_invalid', CLAIM_AMOUNT_PROBLEM);
  }
  if (Number.isNaN(input.paidOn.getTime())) {
    return refusal('claim_date_invalid', 'Enter the date you paid.');
  }
  if (input.paidOn.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    return refusal('claim_date_invalid', 'The date you paid cannot be in the future.');
  }
  return input.proofFile ? (proofFileProblem(input.proofFile) ?? null) : null;
}

/**
 * Reports a payment made another way. Records nothing in the ledger: the invoice only shows a
 * waiting report. One report can wait per invoice. Owners and admins of the agency only.
 */
export async function submitManualPaymentClaim(
  db: Db,
  /** Needed only when a proof file is attached; a report without a file never touches storage. */
  ports: ProofFilePorts | null,
  input: SubmitManualClaimInput,
): Promise<Result<ManualClaimView, ServiceError>> {
  const now = input.now ?? new Date();
  const invalid = inputProblem(input, now);
  if (invalid) return err(invalid);
  const reference = input.reference.trim();
  const note = (input.note ?? '').trim();

  try {
    // An agency invoice only: travellers pay online only (ADR 0025 D13), so a person's invoice
    // reads as not found here, before any membership check.
    const invoice = first(
      await db
        .select()
        .from(schema.invoices)
        .where(
          and(eq(schema.invoices.id, input.invoiceId), isNotNull(schema.invoices.organizationId)),
        )
        .limit(1),
    );
    if (!invoice || !(await isOrgAdmin(db, input.actorAccountId, invoice.organizationId))) {
      return err(serviceError('not_found', 'invoice not found'));
    }
    if (!(await manualClaimsPresent(db))) return err(serviceError('upstream_error', UNAVAILABLE));
    const amount =
      input.amountText !== undefined
        ? parseAmountForCurrency(input.amountText, invoice.currency)
        : (input.amountMinorUnits ?? null);
    if (amount === null || !isValidMinorUnitAmount(amount)) {
      return err(refusal('amount_invalid', CLAIM_AMOUNT_PROBLEM));
    }
    const early = invoiceProblem(invoice, amount, input.currency);
    if (early) return err(early);

    const limited = await checkRateLimits(
      db,
      [
        {
          input: { subjectId: input.actorAccountId, action: 'billing.claim', label: 'report' },
          config: RATE_LIMITS.MANUAL_CLAIM_SUBMIT,
        },
        {
          input: {
            subjectId: invoice.organizationId,
            action: 'billing.claim_org',
            label: 'report',
          },
          config: RATE_LIMITS.MANUAL_CLAIM_SUBMIT_ORG,
        },
      ],
      now,
    );
    if (!limited.allowed) return err(serviceError('rate_limited', limited.reason));

    let proof: StoredProof | undefined;
    if (input.proofFile) {
      if (!ports) {
        return err(
          serviceError(
            'upstream_error',
            'Attaching a file is not available right now. Send the report without a file, or try again later.',
          ),
        );
      }
      const stored = await scanAndStoreProof(db, ports, input.proofFile);
      if (!stored.ok) return stored;
      proof = stored.value;
    }

    try {
      const result = await db.transaction(
        async (tx): Promise<Result<ManualClaimView, ServiceError>> => {
          // The invoice is locked while the report is checked and written, so the balance cannot
          // move under it and two reports arriving together cannot both wait.
          const locked = required(
            first(
              await tx
                .select()
                .from(schema.invoices)
                .where(eq(schema.invoices.id, invoice.id))
                .limit(1)
                .for('update'),
            ),
            'invoice',
          );
          const problem = invoiceProblem(locked, amount, input.currency);
          if (problem) return err(problem);
          // S18 (D2): a refunded invoice is never owed again, so no payment is reported on it.
          if (await invoiceHasRefund(tx, locked.id)) {
            return err(serviceError('invalid', REFUNDED_INVOICE_MESSAGE));
          }
          const waiting = first(
            await tx
              .select({ id: schema.manualPaymentClaims.id })
              .from(schema.manualPaymentClaims)
              .where(
                and(
                  eq(schema.manualPaymentClaims.invoiceId, locked.id),
                  eq(schema.manualPaymentClaims.status, 'SUBMITTED'),
                ),
              )
              .limit(1),
          );
          if (waiting) {
            return err(
              serviceError(
                'invalid',
                'A payment report for this invoice is already waiting for confirmation.',
              ),
            );
          }
          const claim = required(
            first(
              await tx
                .insert(schema.manualPaymentClaims)
                .values({
                  invoiceId: locked.id,
                  organizationId: locked.organizationId,
                  submittedByAccountId: input.actorAccountId,
                  method: input.method as ManualClaimMethod,
                  reference,
                  amountMinorUnits: amount,
                  currency: normalizeCurrency(locked.currency),
                  paidOn: input.paidOn,
                  note: note.length > 0 ? note : null,
                })
                .returning(),
            ),
            'claim',
          );
          if (proof) {
            await tx.insert(schema.billingReceipts).values({
              claimId: claim.id,
              organizationId: locked.organizationId,
              storageObjectId: proof.storageObjectId,
              contentType: proof.contentType,
              sizeBytes: proof.sizeBytes,
              contentSha256: proof.sha256,
            });
          }
          await appendAuditEvent(tx, {
            eventType: 'MANUAL_PAYMENT_CLAIM_SUBMITTED',
            actorAccountId: input.actorAccountId,
            action: 'MANAGE',
            method: 'MANUAL',
            result: 'ALLOWED',
            resourceType: 'manual_payment_claim',
            resourceId: claim.id,
            metadata: {
              organizationId: locked.organizationId,
              invoiceId: locked.id,
              method: claim.method,
              amountMinorUnits: claim.amountMinorUnits,
              currency: claim.currency,
              hasProofFile: proof !== undefined,
            },
          });
          return ok({
            id: claim.id,
            invoiceId: claim.invoiceId,
            invoiceRef: locked.invoiceRef,
            invoiceOutstandingMinorUnits: outstandingMinorUnits(
              locked.invoicedAmountMinorUnits,
              locked.collectedAmountMinorUnits,
            ),
            method: claim.method,
            reference: claim.reference,
            amountMinorUnits: claim.amountMinorUnits,
            currency: claim.currency,
            paidOn: claim.paidOn,
            note: claim.note,
            status: claim.status,
            decidedAt: null,
            decisionReason: null,
            createdAt: claim.createdAt,
            hasProofFile: proof !== undefined,
            submittedByAccountId: null,
            decidedByAccountId: null,
          } satisfies ManualClaimView);
        },
      );
      // A refusal inside the transaction wrote nothing, so a stored file has no claim to belong to.
      if (!result.ok && proof && ports) await discardObject(db, ports.storage, 'CLEAN', proof);
      return result;
    } catch (error) {
      if (proof && ports) await discardObject(db, ports.storage, 'CLEAN', proof);
      throw error;
    }
  } catch (error) {
    if (isMissingRelationError(error)) return err(serviceError('upstream_error', UNAVAILABLE));
    throw error;
  }
}

// --- Deciding ---------------------------------------------------------------------------------

function refusalMessage(refusal: CollectionRefusal, claim: ManualPaymentClaim): string {
  switch (refusal.code) {
    case 'exceeds_outstanding':
      return `Another payment was counted since this was reported, so ${money(claim.currency, claim.amountMinorUnits)} is now more than the invoice still owes. Reject this report, or record a different amount.`;
    case 'void_invoice':
      return 'This invoice was cancelled, so nothing can be recorded against it. Reject this report.';
    case 'currency_mismatch':
      return 'This report is in a different currency from the invoice. Reject it.';
    case 'refunded_invoice':
      return 'This invoice was refunded, so nothing more is owed on it and nothing can be counted against it. Reject this report, or issue a new invoice if money is owed.';
    case 'unavailable':
      return 'Recording payments is not available yet. Please try again later.';
    default:
      return 'This payment could not be recorded.';
  }
}

export interface DecideManualClaimInput {
  readonly actor: PlatformAuthInput;
  readonly claimId: string;
}

export interface ApprovedManualClaim {
  readonly claim: ManualPaymentClaim;
  readonly receipt: PaymentReceipt | null;
  /** True when the report had already been approved and nothing changed. */
  readonly alreadyApproved: boolean;
}

/**
 * Locks the invoice and then the claim, always in that order (reporting takes the invoice first
 * too), and returns the claim as it now stands.
 */
async function lockClaim(tx: Db, claimId: string): Promise<ManualPaymentClaim | undefined> {
  const unlocked = first(
    await tx
      .select({ invoiceId: schema.manualPaymentClaims.invoiceId })
      .from(schema.manualPaymentClaims)
      .where(eq(schema.manualPaymentClaims.id, claimId))
      .limit(1),
  );
  if (!unlocked) return undefined;
  await tx
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, unlocked.invoiceId))
    .for('update');
  return first(
    await tx
      .select()
      .from(schema.manualPaymentClaims)
      .where(eq(schema.manualPaymentClaims.id, claimId))
      .limit(1)
      .for('update'),
  );
}

/**
 * Approves a reported payment: records it in the ledger once (kind MANUAL_CLAIM, the claim as the
 * source), issues its receipt, and marks the report approved, all in one transaction. A platform
 * owner with a fresh sign-in check only. Approving twice records nothing the second time. If the
 * invoice can no longer take the amount, nothing is written and the message says what to do.
 */
export async function approveManualPaymentClaim(
  db: Db,
  input: DecideManualClaimInput & { readonly stepUpSatisfied: boolean },
): Promise<Result<ApprovedManualClaim, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can confirm a payment report'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'confirming a payment requires reauthentication'));
  }
  try {
    return await db.transaction(async (tx) => {
      const claim = await lockClaim(tx, input.claimId);
      if (!claim) return err(serviceError('not_found', 'payment report not found'));
      if (claim.status === 'REJECTED') {
        return err(serviceError('invalid', 'This report was already rejected.'));
      }
      const applied = await applyInvoiceCollection(tx, {
        invoiceId: claim.invoiceId,
        amountMinorUnits: claim.amountMinorUnits,
        currency: claim.currency,
        kind: 'MANUAL_CLAIM',
        sourceId: claim.id,
        reference: claim.reference,
        collectedDate: claim.paidOn,
        recordedByAccountId: input.actor.accountId,
        reason: 'Reported payment confirmed',
      });
      if (!applied.ok) {
        return err(
          serviceError(
            applied.error.code === 'not_found' ? 'not_found' : 'invalid',
            refusalMessage(applied.error, claim),
          ),
        );
      }
      if (claim.status === 'APPROVED') {
        return ok({ claim, receipt: applied.value.receipt, alreadyApproved: true });
      }
      const decidedAt = new Date();
      const updated = required(
        first(
          await tx
            .update(schema.manualPaymentClaims)
            .set({
              status: 'APPROVED',
              decidedByAccountId: input.actor.accountId,
              decidedAt,
              updatedAt: decidedAt,
            })
            .where(eq(schema.manualPaymentClaims.id, claim.id))
            .returning(),
        ),
        'claim',
      );
      await appendAuditEvent(tx, {
        eventType: 'MANUAL_PAYMENT_CLAIM_APPROVED',
        actorAccountId: input.actor.accountId,
        action: 'MANAGE',
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'manual_payment_claim',
        resourceId: claim.id,
        metadata: {
          organizationId: claim.organizationId,
          invoiceId: claim.invoiceId,
          amountMinorUnits: claim.amountMinorUnits,
          currency: claim.currency,
          ledgerEntryId: applied.value.payment?.id ?? null,
          receiptId: applied.value.receipt?.id ?? null,
        },
      });
      return ok({ claim: updated, receipt: applied.value.receipt, alreadyApproved: false });
    });
  } catch (error) {
    if (isMissingRelationError(error)) return err(serviceError('upstream_error', UNAVAILABLE));
    throw error;
  }
}

/**
 * Rejects a reported payment with a reason the agency can read. A platform owner only. Records
 * no money. Rejecting twice changes nothing; an approved report cannot be rejected.
 */
export async function rejectManualPaymentClaim(
  db: Db,
  input: DecideManualClaimInput & { readonly reason: string },
): Promise<Result<ManualPaymentClaim, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can reject a payment report'));
  }
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > CLAIM_REASON_MAX) {
    return err(
      serviceError(
        'invalid',
        `Give a reason the agency can read, up to ${CLAIM_REASON_MAX} characters.`,
      ),
    );
  }
  try {
    return await db.transaction(async (tx) => {
      const claim = await lockClaim(tx, input.claimId);
      if (!claim) return err(serviceError('not_found', 'payment report not found'));
      if (claim.status === 'APPROVED') {
        return err(serviceError('invalid', 'This report was already confirmed.'));
      }
      if (claim.status === 'REJECTED') return ok(claim);
      const decidedAt = new Date();
      const updated = required(
        first(
          await tx
            .update(schema.manualPaymentClaims)
            .set({
              status: 'REJECTED',
              decidedByAccountId: input.actor.accountId,
              decidedAt,
              decisionReason: reason,
              updatedAt: decidedAt,
            })
            .where(eq(schema.manualPaymentClaims.id, claim.id))
            .returning(),
        ),
        'claim',
      );
      await appendAuditEvent(tx, {
        eventType: 'MANUAL_PAYMENT_CLAIM_REJECTED',
        actorAccountId: input.actor.accountId,
        action: 'MANAGE',
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'manual_payment_claim',
        resourceId: claim.id,
        reason,
        metadata: {
          organizationId: claim.organizationId,
          invoiceId: claim.invoiceId,
          amountMinorUnits: claim.amountMinorUnits,
          currency: claim.currency,
        },
      });
      return ok(updated);
    });
  } catch (error) {
    if (isMissingRelationError(error)) return err(serviceError('upstream_error', UNAVAILABLE));
    throw error;
  }
}
