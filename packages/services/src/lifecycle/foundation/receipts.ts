import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuthorizedApplicant } from '../../access/require-access';
import { StaffScope, staffScopeProblem } from '../../access/principal';
import { type Db, first, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
import { type LifecycleAccess, lifecycleAccessCovers } from './access';
import { isUuid } from './ids';
import { lifecycleTablesPresent } from './presence';

/*
 * The Removal Record (PROGRAMME section 3.1, owner decision D8). A receipt keeps the reference
 * code, the kind of document, when and by which kind of person it was uploaded, where it was used
 * (reference codes), who asked and who approved, the dates and the effects. It never keeps a name,
 * a title, a document number, typed text, a file or a raw hash: the input schemas below are
 * strict, so any other key is refused before anything is written, and migration 0113's trigger
 * keeps a written receipt as written.
 */

const CROCKFORD = '[0-9A-HJKMNP-TV-Z]{6,8}';
const caseCode = z.string().regex(new RegExp(`^C-${CROCKFORD}$`));
const requestCode = z.string().regex(new RegExp(`^R-${CROCKFORD}$`));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** What one removal changed. Strict: an unknown key (a title, a name) is refused. */
export const receiptEffectsSchema = z
  .object({
    casesSwitched: z.array(caseCode).max(1000).optional(),
    casesFlagged: z.array(caseCode).max(1000).optional(),
    acknowledgementsReset: count.optional(),
    sharesAffected: count.optional(),
    aiChoicesMoved: count.optional(),
    aiChoicesRemoved: count.optional(),
    agencyRequestsAffected: z.array(requestCode).max(1000).optional(),
    bytesFreed: count.optional(),
  })
  .strict();

export type ReceiptEffects = z.infer<typeof receiptEffectsSchema>;

export const DELETION_RECEIPT_STATUSES = [
  'SCHEDULED',
  'RESTORED',
  'REMOVING',
  'REMOVED',
  'BLOCKED',
] as const;
export type DeletionReceiptStatus = (typeof DELETION_RECEIPT_STATUSES)[number];

const FORWARD: Readonly<Record<DeletionReceiptStatus, readonly DeletionReceiptStatus[]>> = {
  SCHEDULED: ['RESTORED', 'REMOVING', 'BLOCKED'],
  REMOVING: ['REMOVED', 'BLOCKED'],
  BLOCKED: ['REMOVING'],
  RESTORED: [],
  REMOVED: [],
};

/** Whether a receipt may move from `from` to `to` (the same rule the database trigger enforces). */
export function receiptMoveAllowed(from: DeletionReceiptStatus, to: DeletionReceiptStatus): boolean {
  return from === to || FORWARD[from].includes(to);
}

const openInputSchema = z
  .object({
    applicantId: z.string().refine(isUuid),
    subjectKind: z.enum(['DOCUMENT', 'TRAVELLER']),
    subjectCode: z.string().regex(new RegExp(`^[DP]-${CROCKFORD}$`)),
    /** A catalogue document type key, never a title. */
    documentKind: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{0,79}$/)
      .nullable()
      .optional(),
    uploadedAt: z.date().nullable().optional(),
    uploadedByRole: z.enum(['OWNER', 'AGENCY_MEMBER', 'CONTRIBUTOR', 'SYSTEM']).nullable().optional(),
    path: z.enum(['DUPLICATE', 'REQUEST', 'EMPTY_TRAVELLER']),
    requestedByAccountId: z.string().refine(isUuid).nullable().optional(),
    approvedByAccountId: z.string().refine(isUuid).nullable().optional(),
    requestedAt: z.date().optional(),
    scheduledFor: z.date().nullable().optional(),
    status: z.enum(['SCHEDULED', 'REMOVING']).optional(),
    effects: receiptEffectsSchema.optional(),
  })
  .strict()
  .refine((input) => input.subjectCode.startsWith(input.subjectKind === 'DOCUMENT' ? 'D-' : 'P-'), {
    message: 'the code must match the kind of record',
  });

export type OpenDeletionReceiptInput = z.input<typeof openInputSchema>;

/**
 * Write one Removal Record inside the caller's transaction and return its id. Refuses anything
 * outside the strict input (a title, a name, free text), a code that does not match its kind,
 * and an access that does not cover the applicant.
 */
export async function openDeletionReceipt(
  tx: Db,
  input: OpenDeletionReceiptInput,
  access: LifecycleAccess,
): Promise<Result<{ readonly id: string }, ServiceError>> {
  const parsed = openInputSchema.safeParse(input);
  if (!parsed.success) return err(serviceError('invalid', 'the removal record is not valid'));
  const value = parsed.data;
  if (!lifecycleAccessCovers(access, value.applicantId)) {
    return err(serviceError('forbidden', 'this removal record cannot be written'));
  }
  if (!(await lifecycleTablesPresent(tx))) {
    return err(serviceError('invalid', 'removal records are not available yet'));
  }
  const rows = await tx
    .insert(schema.deletionReceipts)
    .values({
      applicantId: value.applicantId,
      subjectKind: value.subjectKind,
      subjectCode: value.subjectCode,
      documentKind: value.documentKind ?? null,
      uploadedAt: value.uploadedAt ?? null,
      uploadedByRole: value.uploadedByRole ?? null,
      path: value.path,
      requestedByAccountId: value.requestedByAccountId ?? null,
      approvedByAccountId: value.approvedByAccountId ?? null,
      requestedAt: value.requestedAt ?? new Date(),
      scheduledFor: value.scheduledFor ?? null,
      status: value.status ?? 'SCHEDULED',
      effects: value.effects ?? {},
    })
    .returning({ id: schema.deletionReceipts.id });
  const id = first(rows)?.id;
  return id ? ok({ id }) : err(serviceError('invalid', 'the removal record was not written'));
}

const patchSchema = z
  .object({
    approvedByAccountId: z.string().refine(isUuid).nullable().optional(),
    verifiedGoneAt: z.date().optional(),
    effects: receiptEffectsSchema.optional(),
  })
  .strict();

export type AdvanceDeletionReceiptPatch = z.input<typeof patchSchema>;

/**
 * Combine recorded effects with new ones. Lists gain the codes they did not have; a count is
 * written once. Returns null when a new count would change one already recorded (a record is
 * never rewritten).
 */
export function mergeReceiptEffects(
  recorded: ReceiptEffects,
  added: ReceiptEffects,
): ReceiptEffects | null {
  const merged: Record<string, unknown> = { ...recorded };
  for (const [key, value] of Object.entries(added)) {
    if (value === undefined) continue;
    const before = merged[key];
    if (Array.isArray(value)) {
      const list = Array.isArray(before) ? [...(before as string[])] : [];
      for (const code of value) if (!list.includes(code)) list.push(code);
      merged[key] = list;
    } else if (before === undefined || before === value) {
      merged[key] = value;
    } else {
      return null;
    }
  }
  return receiptEffectsSchema.parse(merged);
}

/**
 * Move a receipt forward (SCHEDULED to RESTORED, REMOVING or BLOCKED; REMOVING to REMOVED or
 * BLOCKED; BLOCKED to REMOVING), recording the approver, the verified time and new effects.
 * Locks the receipt row; refuses a backward move, a changed count and an access that does not
 * cover the receipt's applicant.
 */
export async function advanceDeletionReceipt(
  tx: Db,
  id: string,
  next: DeletionReceiptStatus,
  patch: AdvanceDeletionReceiptPatch,
  access: LifecycleAccess,
): Promise<Result<{ readonly status: DeletionReceiptStatus }, ServiceError>> {
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success || !isUuid(id) || !DELETION_RECEIPT_STATUSES.includes(next)) {
    return err(serviceError('invalid', 'the removal record change is not valid'));
  }
  if (!(await lifecycleTablesPresent(tx))) {
    return err(serviceError('not_found', 'removal record not found'));
  }
  const receipts = schema.deletionReceipts;
  const current = first(
    await tx
      .select({
        applicantId: receipts.applicantId,
        status: receipts.status,
        effects: receipts.effects,
        verifiedGoneAt: receipts.verifiedGoneAt,
      })
      .from(receipts)
      .where(eq(receipts.id, id))
      .for('update'),
  );
  if (!current || !lifecycleAccessCovers(access, current.applicantId)) {
    return err(serviceError('not_found', 'removal record not found'));
  }
  if (!receiptMoveAllowed(current.status, next)) {
    return err(serviceError('stale', 'this removal record has already moved on'));
  }
  const effects = parsed.data.effects
    ? mergeReceiptEffects(receiptEffectsSchema.parse(current.effects), parsed.data.effects)
    : null;
  if (parsed.data.effects && !effects) {
    return err(serviceError('invalid', 'a recorded effect cannot change'));
  }
  if (parsed.data.verifiedGoneAt && current.verifiedGoneAt) {
    return err(serviceError('invalid', 'the verified time is already recorded'));
  }
  await tx
    .update(receipts)
    .set({
      status: next,
      ...(parsed.data.approvedByAccountId !== undefined
        ? { approvedByAccountId: parsed.data.approvedByAccountId }
        : {}),
      ...(parsed.data.verifiedGoneAt ? { verifiedGoneAt: parsed.data.verifiedGoneAt } : {}),
      ...(effects ? { effects } : {}),
    })
    .where(eq(receipts.id, id));
  return ok({ status: next });
}

/** One Removal Record as people read it: codes, kinds, dates and counts only. */
export interface DeletionReceiptView {
  readonly id: string;
  readonly subjectKind: 'DOCUMENT' | 'TRAVELLER';
  readonly subjectCode: string;
  readonly documentKind: string | null;
  readonly uploadedAt: Date | null;
  readonly uploadedByRole: 'OWNER' | 'AGENCY_MEMBER' | 'CONTRIBUTOR' | 'SYSTEM' | null;
  readonly path: 'DUPLICATE' | 'REQUEST' | 'EMPTY_TRAVELLER';
  readonly requestedAt: Date;
  readonly scheduledFor: Date | null;
  readonly verifiedGoneAt: Date | null;
  readonly status: DeletionReceiptStatus;
  readonly effects: ReceiptEffects;
  readonly createdAt: Date;
}

const LIST_DEFAULT = 50;
const LIST_MAX = 200;

/**
 * A traveller record's Removal Records, newest first. Read by the record's owner (an access proof
 * issued to the owner themself) or by a platform administrator with the compliance directory
 * view, who names the database and the applicant. Returns an empty list while migration 0113 has
 * not run. Never returns who asked or approved: codes, kinds, dates and counts only.
 */
export async function listDeletionReceipts(
  access: AuthorizedApplicant<'VIEW_METADATA'> | StaffScope<'APPLICANT_DIRECTORY_VIEW'>,
  options: { readonly db?: Db; readonly applicantId?: string; readonly limit?: number } = {},
): Promise<Result<readonly DeletionReceiptView[], ServiceError>> {
  let db: Db;
  let applicantId: string;
  if (access instanceof AuthorizedApplicant) {
    if (
      !AuthorizedApplicant.isGenuine(access, 'VIEW_METADATA') ||
      access.actor.kind !== 'applicant_owner'
    ) {
      return err(serviceError('forbidden', 'only the record owner can read its removal records'));
    }
    db = access.tx;
    applicantId = access.applicant.id;
  } else {
    const problem = staffScopeProblem(access, 'APPLICANT_DIRECTORY_VIEW');
    if (problem) return err(problem);
    if (!options.db || !isUuid(options.applicantId)) {
      return err(serviceError('invalid', 'name the traveller record to read'));
    }
    db = options.db;
    applicantId = options.applicantId;
  }
  if (!(await lifecycleTablesPresent(db))) return ok([]);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? LIST_DEFAULT), 1), LIST_MAX);
  const receipts = schema.deletionReceipts;
  const rows = await db
    .select({
      id: receipts.id,
      subjectKind: receipts.subjectKind,
      subjectCode: receipts.subjectCode,
      documentKind: receipts.documentKind,
      uploadedAt: receipts.uploadedAt,
      uploadedByRole: receipts.uploadedByRole,
      path: receipts.path,
      requestedAt: receipts.requestedAt,
      scheduledFor: receipts.scheduledFor,
      verifiedGoneAt: receipts.verifiedGoneAt,
      status: receipts.status,
      effects: receipts.effects,
      createdAt: receipts.createdAt,
    })
    .from(receipts)
    .where(and(eq(receipts.applicantId, applicantId)))
    .orderBy(desc(receipts.createdAt), desc(receipts.id))
    .limit(limit);
  return ok(
    rows.map((row) => {
      const effects = receiptEffectsSchema.safeParse(row.effects);
      return { ...row, effects: effects.success ? effects.data : {} };
    }),
  );
}
