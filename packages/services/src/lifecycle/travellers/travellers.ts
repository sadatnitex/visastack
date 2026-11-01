import { type Result, err, ok } from '@visastack/core';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { type SystemJob, SystemScope, accountPrincipal } from '../../access/principal';
import { type AuthorizedApplicant, requireAccess } from '../../access/require-access';
import { appendAuditEvent } from '../../audit';
import { type Db, first, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
// Imported by the foundation's path, which the read-path guard recognises.
import { presentApplicantCondition } from '../../lifecycle/foundation/conditions';
import { recordProductEvent } from '../../product-events';
import { assignReferenceCode, referenceCodeFor } from '../../reference-codes';
import { lifecycleAccessCovers, lifecycleCommandCovers } from '../foundation/access';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';
import { advanceDeletionReceipt, openDeletionReceipt } from '../foundation/receipts';
import { APPLICANT_REFERENCES } from './classification';

/*
 * Travellers: Archive, Restore and Remove Empty Record (LC-E, owner decision D9).
 *
 * - Anyone can be archived and restored, except "Myself", which is never archived.
 * - Only an empty record can be removed: one that holds nothing in any table that points at
 *   travellers (classification.ts). It waits in Recently Deleted for 30 days, where it can be
 *   restored, and the daily deletion job then checks again that it is still empty before the row
 *   is deleted. A record that gained anything in the meantime is restored instead, never lost.
 * - An empty Myself can be removed only while another Myself record stays.
 * - Only the record owner acts, with their own MANAGE proof. The Removal Record of a traveller is
 *   anchored on another record of the same owner that stays (their Myself where there is one),
 *   because a record goes with the traveller it is anchored on.
 *
 * Until migration 0113 has created the lifecycle tables every command here refuses with
 * `TRAVELLER_REFUSALS.unavailable` and every screen hides these actions.
 */

/** How long a removed traveller record waits in Recently Deleted before it is deleted. */
export const TRAVELLER_RECENTLY_DELETED_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why a traveller command is refused. The web layer maps these exact messages to its own words. */
export const TRAVELLER_REFUSALS = {
  unavailable: 'archiving and removing travellers is not available yet',
  notOwner: 'only the record owner can change this traveller record',
  myselfArchive: 'your own record is never archived',
  deleted: 'this traveller record is in Recently Deleted',
  notDeleted: 'this traveller record is not in Recently Deleted',
  notEmpty: 'this traveller record holds information and can only be archived',
  lastMyself: 'your own record can be removed only while another record for you stays',
  onlyRecord: 'the only traveller record on an account cannot be removed',
  noCode: 'this traveller record has no reference code yet',
} as const;

export type TravellerLifecycleState = 'CURRENT' | 'ARCHIVED' | 'RECENTLY_DELETED';

export interface TravellerLifecycle {
  readonly state: TravellerLifecycleState;
  readonly archivedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly purgeAfter: Date | null;
}

export const TRAVELLER_ACTIONS = ['ARCHIVE', 'RESTORE', 'REMOVE_EMPTY', 'RESTORE_DELETED'] as const;
export type TravellerAction = (typeof TRAVELLER_ACTIONS)[number];

/** Why "Remove Empty Record" is not offered, in the order it is checked. */
export type TravellerRemovalBlock = 'NOT_EMPTY' | 'LAST_MYSELF' | 'ONLY_RECORD';

export interface TravellerActionView {
  readonly state: TravellerLifecycleState;
  readonly isMyself: boolean;
  readonly removalBlock: TravellerRemovalBlock | null;
}

/**
 * The traveller actions the owner may take, in menu order. Pure: screens never decide visibility
 * themselves. Myself is never archived; removal needs an empty record and an anchor that stays.
 */
export function availableTravellerActions(view: TravellerActionView): TravellerAction[] {
  if (view.state === 'RECENTLY_DELETED') return ['RESTORE_DELETED'];
  const actions: TravellerAction[] = [];
  if (view.state === 'ARCHIVED') actions.push('RESTORE');
  else if (!view.isMyself) actions.push('ARCHIVE');
  if (view.removalBlock === null) actions.push('REMOVE_EMPTY');
  return actions;
}

export interface TravellerManageView {
  readonly lifecycle: TravellerLifecycle;
  readonly actions: readonly TravellerAction[];
  readonly removalBlock: TravellerRemovalBlock | null;
}

type LifecycleRow = typeof schema.applicantLifecycle.$inferSelect;

function lifecycleOf(row: LifecycleRow | undefined): TravellerLifecycle {
  const archivedAt = row?.archivedAt ?? null;
  const deletedAt = row?.deletedAt ?? null;
  return {
    state: deletedAt ? 'RECENTLY_DELETED' : archivedAt ? 'ARCHIVED' : 'CURRENT',
    archivedAt,
    deletedAt,
    purgeAfter: row?.purgeAfter ?? null,
  };
}

async function lifecycleRow(db: Db, applicantId: string): Promise<LifecycleRow | undefined> {
  const table = schema.applicantLifecycle;
  return first(await db.select().from(table).where(eq(table.applicantId, applicantId)).limit(1));
}

/** Which classified tables exist on this database (a later migration may not have run yet). */
async function presentRelations(db: Db, names: readonly string[]): Promise<ReadonlySet<string>> {
  if (names.length === 0) return new Set();
  const list = sql.join(
    names.map((name) => sql`(${name}::text, to_regclass(${name}::text) is not null)`),
    sql`, `,
  );
  const rows = await db
    .select({ name: sql<string>`probe.name`, present: sql<boolean>`probe.present` })
    .from(sql`(values ${list}) as probe(name, present)`);
  return new Set(rows.filter((row) => row.present === true).map((row) => row.name));
}

/** Whether any classified table holds a row for the traveller. One query over the present tables. */
async function holdsAnything(db: Db, applicantId: string): Promise<boolean> {
  const blocking = APPLICANT_REFERENCES.filter(
    (ref) => ref.kind === 'DATA' || ref.kind === 'UNFINISHED',
  );
  const present = await presentRelations(
    db,
    blocking.map((ref) => ref.table),
  );
  const checks = blocking
    .filter((ref) => present.has(ref.table))
    .map((ref) => {
      const where = sql`${sql.identifier(ref.column)} = ${applicantId}::uuid`;
      const unfinished = ref.finished
        ? sql` and ${sql.identifier(ref.finished.column)}::text <> ${ref.finished.value}`
        : sql``;
      return sql`exists (select 1 from ${sql.identifier(ref.table)} where ${where}${unfinished})`;
    });
  if (checks.length === 0) return false;
  const rows = await db
    .select({ holds: sql<boolean>`(${sql.join(checks, sql` or `)})` })
    .from(sql`(select 1) as probe`);
  return rows[0]?.holds === true;
}

/**
 * True when the traveller record holds nothing at all: no row in any table classified as data in
 * classification.ts, and no file of it still being destroyed. Fails closed: an access that does
 * not cover the record, or a malformed id, gives false ("not empty"), so nothing is ever removed
 * on a doubtful answer.
 */
export async function travellerIsEmpty(
  db: Db,
  applicantId: string,
  access: AuthorizedApplicant<'MANAGE'> | SystemScope<SystemJob>,
): Promise<boolean> {
  if (!isUuid(applicantId) || !lifecycleAccessCovers(access, applicantId)) return false;
  return !(await holdsAnything(db, applicantId));
}

interface OwnedRecord {
  readonly id: string;
  readonly relationship: string;
  readonly createdAt: Date;
  readonly present: boolean;
}

/**
 * The owner's traveller records, locked in id order so two removals on one account run one after
 * the other (two Myself records can never remove each other at the same moment). `present` is
 * false for a record in Recently Deleted.
 */
async function lockOwnedRecords(
  tx: Db,
  ownerAccountId: string,
  lifecycle: boolean,
): Promise<OwnedRecord[]> {
  const applicants = schema.applicants;
  const rows = await tx
    .select({
      id: applicants.id,
      relationship: applicants.relationship,
      createdAt: applicants.createdAt,
      present: lifecycle ? sql<boolean>`${presentApplicantCondition()}` : sql<boolean>`true`,
    })
    .from(applicants)
    .where(eq(applicants.ownerAccountId, ownerAccountId))
    .orderBy(asc(applicants.id))
    .for('update', { of: applicants });
  return rows.map((row) => ({ ...row, present: row.present === true }));
}

/** The record a traveller's Removal Record is anchored on: another present Myself, else any other present record. */
function anchorFor(records: readonly OwnedRecord[], applicantId: string): OwnedRecord | undefined {
  const others = records
    .filter((record) => record.id !== applicantId && record.present)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return others.find((record) => record.relationship === 'SELF') ?? others[0];
}

function removalBlockFor(
  records: readonly OwnedRecord[],
  target: { readonly id: string; readonly relationship: string },
  empty: boolean,
): TravellerRemovalBlock | null {
  if (!empty) return 'NOT_EMPTY';
  const others = records.filter((record) => record.id !== target.id && record.present);
  if (target.relationship === 'SELF' && !others.some((record) => record.relationship === 'SELF')) {
    return 'LAST_MYSELF';
  }
  if (others.length === 0) return 'ONLY_RECORD';
  return null;
}

const BLOCK_REFUSAL: Readonly<Record<TravellerRemovalBlock, string>> = {
  NOT_EMPTY: TRAVELLER_REFUSALS.notEmpty,
  LAST_MYSELF: TRAVELLER_REFUSALS.lastMyself,
  ONLY_RECORD: TRAVELLER_REFUSALS.onlyRecord,
};

function ownerOnly(access: AuthorizedApplicant<'MANAGE'>): ServiceError | null {
  return lifecycleCommandCovers(access, access.applicant.id)
    ? null
    : serviceError('forbidden', TRAVELLER_REFUSALS.notOwner);
}

/**
 * What the traveller's own page shows: the lifecycle state and the actions the owner may take.
 * Null while the lifecycle tables do not exist (the Manage menu is then hidden). Owner only.
 */
export async function getTravellerManageView(
  access: AuthorizedApplicant<'MANAGE'>,
): Promise<Result<TravellerManageView | null, ServiceError>> {
  const refused = ownerOnly(access);
  if (refused) return err(refused);
  const db = access.tx;
  if (!(await lifecycleTablesPresent(db))) return ok(null);
  const applicant = access.applicant;
  const applicants = schema.applicants;
  const [row, records, holds] = await Promise.all([
    lifecycleRow(db, applicant.id),
    db
      .select({
        id: applicants.id,
        relationship: applicants.relationship,
        createdAt: applicants.createdAt,
        present: sql<boolean>`${presentApplicantCondition()}`,
      })
      .from(applicants)
      .where(eq(applicants.ownerAccountId, applicant.ownerAccountId)),
    holdsAnything(db, applicant.id),
  ]);
  const lifecycle = lifecycleOf(row);
  const removalBlock = removalBlockFor(
    records.map((record) => ({ ...record, present: record.present === true })),
    applicant,
    !holds,
  );
  return ok({
    lifecycle,
    removalBlock,
    actions: availableTravellerActions({
      state: lifecycle.state,
      isMyself: applicant.relationship === 'SELF',
      removalBlock,
    }),
  });
}

/** Archive a traveller: hidden from everyday lists, reminders and offers, nothing removed. */
export async function archiveTraveller(
  access: AuthorizedApplicant<'MANAGE'>,
  options: { readonly now?: Date } = {},
): Promise<Result<TravellerLifecycle, ServiceError>> {
  const refused = ownerOnly(access);
  if (refused) return err(refused);
  if (!(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('invalid', TRAVELLER_REFUSALS.unavailable));
  }
  const applicant = access.applicant;
  if (applicant.relationship === 'SELF') {
    return err(serviceError('invalid', TRAVELLER_REFUSALS.myselfArchive));
  }
  const now = options.now ?? new Date();
  const actor = applicant.ownerAccountId;
  return access.tx.transaction(async (tx) => {
    await lockOwnedRecords(tx, actor, true);
    const before = lifecycleOf(await lifecycleRow(tx, applicant.id));
    if (before.state === 'RECENTLY_DELETED') {
      return err(serviceError('invalid', TRAVELLER_REFUSALS.deleted));
    }
    if (before.state === 'ARCHIVED') return ok(before);
    const table = schema.applicantLifecycle;
    await tx
      .insert(table)
      .values({
        applicantId: applicant.id,
        archivedAt: now,
        archivedByAccountId: actor,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: table.applicantId,
        set: { archivedAt: now, archivedByAccountId: actor, updatedAt: now },
      });
    await appendAuditEvent(tx, {
      eventType: 'APPLICANT_ARCHIVED',
      actorAccountId: actor,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: applicant.id,
      resourceType: 'applicant',
      resourceId: applicant.id,
    });
    await recordProductEvent(tx, { eventType: 'TRAVELLER_ARCHIVED', accountId: actor });
    return ok(lifecycleOf(await lifecycleRow(tx, applicant.id)));
  });
}

/** Restore an archived traveller to the everyday lists. */
export async function restoreTraveller(
  access: AuthorizedApplicant<'MANAGE'>,
  options: { readonly now?: Date } = {},
): Promise<Result<TravellerLifecycle, ServiceError>> {
  const refused = ownerOnly(access);
  if (refused) return err(refused);
  if (!(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('invalid', TRAVELLER_REFUSALS.unavailable));
  }
  const applicant = access.applicant;
  const now = options.now ?? new Date();
  const actor = applicant.ownerAccountId;
  return access.tx.transaction(async (tx) => {
    await lockOwnedRecords(tx, actor, true);
    const before = lifecycleOf(await lifecycleRow(tx, applicant.id));
    if (before.state === 'RECENTLY_DELETED') {
      return err(serviceError('invalid', TRAVELLER_REFUSALS.deleted));
    }
    if (before.state === 'CURRENT') return ok(before);
    const table = schema.applicantLifecycle;
    await tx
      .update(table)
      .set({ archivedAt: null, archivedByAccountId: null, updatedAt: now })
      .where(eq(table.applicantId, applicant.id));
    await appendAuditEvent(tx, {
      eventType: 'APPLICANT_RESTORED',
      actorAccountId: actor,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: applicant.id,
      resourceType: 'applicant',
      resourceId: applicant.id,
      metadata: { from: 'ARCHIVED' },
    });
    await recordProductEvent(tx, { eventType: 'TRAVELLER_RESTORED', accountId: actor });
    return ok(lifecycleOf(await lifecycleRow(tx, applicant.id)));
  });
}

/** The owner's MANAGE proof for the anchor record, opened as the same owner inside `tx`. */
async function anchorProof(
  tx: Db,
  ownerAccountId: string,
  anchorId: string,
): Promise<AuthorizedApplicant<'MANAGE'> | null> {
  const proof = await requireAccess(
    tx,
    accountPrincipal(ownerAccountId),
    'MANAGE',
    { applicantId: anchorId },
    { purpose: 'owner_traveller_removal_record' },
  );
  return proof.ok && proof.value.actor.kind === 'applicant_owner' ? proof.value : null;
}

/** The traveller's P- code, assigned now if it has none yet. */
async function travellerCode(tx: Db, applicantId: string): Promise<string | null> {
  const code = await referenceCodeFor(tx, 'P', applicantId);
  if (code) return code;
  await assignReferenceCode(tx, 'P', applicantId);
  return referenceCodeFor(tx, 'P', applicantId);
}

export interface TravellerRemovalOutcome {
  readonly purgeAfter: Date;
  readonly receiptId: string;
}

/**
 * Remove an empty traveller record: it moves to Recently Deleted for 30 days (restorable) and a
 * Removal Record (`EMPTY_TRAVELLER`) is written on the record that stays. Refused when the record
 * holds anything, for the last Myself, and for the only record on the account.
 */
export async function deleteEmptyTraveller(
  access: AuthorizedApplicant<'MANAGE'>,
  options: { readonly now?: Date } = {},
): Promise<Result<TravellerRemovalOutcome, ServiceError>> {
  const refused = ownerOnly(access);
  if (refused) return err(refused);
  if (!(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('invalid', TRAVELLER_REFUSALS.unavailable));
  }
  const applicant = access.applicant;
  const now = options.now ?? new Date();
  const purgeAfter = new Date(now.getTime() + TRAVELLER_RECENTLY_DELETED_DAYS * DAY_MS);
  const actor = applicant.ownerAccountId;
  return access.tx.transaction(async (tx) => {
    const records = await lockOwnedRecords(tx, actor, true);
    const target = records.find((record) => record.id === applicant.id);
    if (!target) return err(serviceError('not_found', 'record not found'));
    if (!target.present) return err(serviceError('invalid', TRAVELLER_REFUSALS.deleted));
    const block = removalBlockFor(records, target, !(await holdsAnything(tx, applicant.id)));
    if (block) return err(serviceError('invalid', BLOCK_REFUSAL[block]));
    const anchor = anchorFor(records, applicant.id);
    const anchorAccess = anchor ? await anchorProof(tx, actor, anchor.id) : null;
    if (!anchor || !anchorAccess) {
      return err(serviceError('invalid', TRAVELLER_REFUSALS.onlyRecord));
    }
    const code = await travellerCode(tx, applicant.id);
    if (!code) return err(serviceError('invalid', TRAVELLER_REFUSALS.noCode));
    const receipt = await openDeletionReceipt(
      tx,
      {
        applicantId: anchor.id,
        subjectKind: 'TRAVELLER',
        subjectCode: code,
        path: 'EMPTY_TRAVELLER',
        requestedByAccountId: actor,
        requestedAt: now,
        scheduledFor: purgeAfter,
        status: 'SCHEDULED',
      },
      anchorAccess,
    );
    if (!receipt.ok) return err(receipt.error);
    const table = schema.applicantLifecycle;
    const deleted = {
      deletedAt: now,
      deletedByAccountId: actor,
      purgeAfter,
      receiptId: receipt.value.id,
      updatedAt: now,
    };
    await tx
      .insert(table)
      .values({ applicantId: applicant.id, ...deleted })
      .onConflictDoUpdate({ target: table.applicantId, set: deleted });
    await appendAuditEvent(tx, {
      eventType: 'APPLICANT_DELETED',
      actorAccountId: actor,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: applicant.id,
      resourceType: 'applicant',
      resourceId: applicant.id,
      metadata: {
        receiptId: receipt.value.id,
        code,
        purgeAfter: purgeAfter.toISOString(),
        myself: applicant.relationship === 'SELF',
      },
    });
    await recordProductEvent(tx, { eventType: 'TRAVELLER_REMOVED', accountId: actor });
    return ok({ purgeAfter, receiptId: receipt.value.id });
  });
}

/** Bring a traveller record back from Recently Deleted; its Removal Record reads Restored. */
export async function restoreDeletedTraveller(
  access: AuthorizedApplicant<'MANAGE'>,
  options: { readonly now?: Date } = {},
): Promise<Result<TravellerLifecycle, ServiceError>> {
  const refused = ownerOnly(access);
  if (refused) return err(refused);
  if (!(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('invalid', TRAVELLER_REFUSALS.unavailable));
  }
  const applicant = access.applicant;
  const now = options.now ?? new Date();
  const actor = applicant.ownerAccountId;
  return access.tx.transaction(async (tx) => {
    await lockOwnedRecords(tx, actor, true);
    const row = await lifecycleRow(tx, applicant.id);
    if (lifecycleOf(row).state !== 'RECENTLY_DELETED') {
      return err(serviceError('invalid', TRAVELLER_REFUSALS.notDeleted));
    }
    const restored = await clearDeleted(tx, applicant.id, row?.receiptId ?? null, now, {
      ownerAccountId: actor,
    });
    if (!restored.ok) return err(restored.error);
    await appendAuditEvent(tx, {
      eventType: 'APPLICANT_RESTORED',
      actorAccountId: actor,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: applicant.id,
      resourceType: 'applicant',
      resourceId: applicant.id,
      metadata: { from: 'RECENTLY_DELETED', receiptId: row?.receiptId ?? null },
    });
    await recordProductEvent(tx, { eventType: 'TRAVELLER_RESTORED', accountId: actor });
    return ok(lifecycleOf(await lifecycleRow(tx, applicant.id)));
  });
}

/**
 * Take a record out of Recently Deleted and mark its Removal Record Restored. The receipt is
 * moved with the owner's proof for the receipt's own anchor record, or with the job's scope.
 */
async function clearDeleted(
  tx: Db,
  applicantId: string,
  receiptId: string | null,
  now: Date,
  by: { readonly ownerAccountId: string } | { readonly job: SystemScope<SystemJob> },
): Promise<Result<true, ServiceError>> {
  if (receiptId) {
    const receipts = schema.deletionReceipts;
    const receipt = first(
      await tx
        .select({ applicantId: receipts.applicantId, status: receipts.status })
        .from(receipts)
        .where(eq(receipts.id, receiptId))
        .limit(1),
    );
    if (receipt && receipt.status === 'SCHEDULED') {
      const access =
        'job' in by ? by.job : await anchorProof(tx, by.ownerAccountId, receipt.applicantId);
      if (!access) return err(serviceError('forbidden', TRAVELLER_REFUSALS.notOwner));
      const moved = await advanceDeletionReceipt(tx, receiptId, 'RESTORED', {}, access);
      if (!moved.ok) return err(moved.error);
    }
  }
  const table = schema.applicantLifecycle;
  await tx
    .update(table)
    .set({
      deletedAt: null,
      deletedByAccountId: null,
      purgeAfter: null,
      receiptId: null,
      updatedAt: now,
    })
    .where(eq(table.applicantId, applicantId));
  return ok(true);
}

export interface TravellerPurgeOutcome {
  /** Records deleted for good. */
  readonly removed: number;
  /** Records that gained something while in Recently Deleted and were restored instead. */
  readonly restored: number;
  /** Records that could not be handled this time (tried again on the next run). */
  readonly failed: number;
}

/**
 * The daily traveller purge, run by the deletion job. For each record whose 30 days in Recently
 * Deleted are over: lock it, check again that it is still empty, then delete the row and mark its
 * Removal Record Removed. A record that holds anything now is restored, never deleted. Each
 * record is handled in its own transaction, so one failure never stops the rest.
 */
export async function purgeDueTravellers(
  db: Db,
  scope: SystemScope<'process-deletions'>,
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<Result<TravellerPurgeOutcome, ServiceError>> {
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-deletions') {
    return err(serviceError('forbidden', 'this job cannot remove traveller records'));
  }
  if (!(await lifecycleTablesPresent(db))) return ok({ removed: 0, restored: 0, failed: 0 });
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const table = schema.applicantLifecycle;
  const due = await db
    .select({ applicantId: table.applicantId })
    .from(table)
    .where(and(sql`${table.deletedAt} is not null`, lte(table.purgeAfter, now)))
    .orderBy(asc(table.purgeAfter), asc(table.applicantId))
    .limit(limit);
  let removed = 0;
  let restored = 0;
  let failed = 0;
  for (const { applicantId } of due) {
    try {
      const outcome = await db.transaction(async (tx) => purgeOne(tx, scope, applicantId, now));
      if (outcome === 'REMOVED') removed += 1;
      else if (outcome === 'RESTORED') restored += 1;
    } catch (error) {
      failed += 1;
      // Ids only: nothing about the person is logged.
      console.error(
        `[traveller-purge] ${applicantId} could not be handled: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return ok({ removed, restored, failed });
}

async function purgeOne(
  tx: Db,
  scope: SystemScope<'process-deletions'>,
  applicantId: string,
  now: Date,
): Promise<'REMOVED' | 'RESTORED' | 'SKIPPED'> {
  const applicants = schema.applicants;
  const locked = first(
    await tx
      .select({ id: applicants.id })
      .from(applicants)
      .where(eq(applicants.id, applicantId))
      .for('update'),
  );
  if (!locked) return 'SKIPPED';
  const row = await lifecycleRow(tx, applicantId);
  // Restored, or moved again, since the list was read.
  if (!row?.deletedAt || !row.purgeAfter || row.purgeAfter.getTime() > now.getTime()) {
    return 'SKIPPED';
  }
  if (!(await travellerIsEmpty(tx, applicantId, scope))) {
    const cleared = await clearDeleted(tx, applicantId, row.receiptId, now, { job: scope });
    if (!cleared.ok) throw new Error(cleared.error.message);
    await appendAuditEvent(tx, {
      eventType: 'APPLICANT_RESTORED',
      method: 'SYSTEM',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'applicant',
      resourceId: applicantId,
      metadata: { from: 'RECENTLY_DELETED', reason: 'NOT_EMPTY', receiptId: row.receiptId },
    });
    return 'RESTORED';
  }
  if (row.receiptId) {
    for (const next of ['REMOVING', 'REMOVED'] as const) {
      const moved = await advanceDeletionReceipt(
        tx,
        row.receiptId,
        next,
        next === 'REMOVED' ? { verifiedGoneAt: now } : {},
        scope,
      );
      // A receipt gone with its anchor (cascade) leaves nothing to move.
      if (!moved.ok && moved.error.code !== 'not_found') throw new Error(moved.error.message);
    }
  }
  await tx.delete(applicants).where(eq(applicants.id, applicantId));
  await appendAuditEvent(tx, {
    eventType: 'APPLICANT_REMOVED',
    method: 'SYSTEM',
    result: 'ALLOWED',
    applicantId,
    resourceType: 'applicant',
    resourceId: applicantId,
    metadata: { receiptId: row.receiptId },
  });
  return 'REMOVED';
}
