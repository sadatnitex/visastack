import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, getTableColumns, not } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  everydayApplicantCondition,
  presentApplicantCondition,
} from './lifecycle/foundation/conditions';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { recordProductEvent } from './product-events';
import { assignReferenceCode } from './reference-codes';

/**
 * Applicant, family-member, and authorized minor/guardian records
 * (Build Spec §2, PRD §2).
 *
 * An account owns one or more applicant records: the account holder ("SELF")
 * plus family members and minors under guardianship. Creating any subject
 * record requires the account's CORE_PROCESSING consent — data is never
 * created for a subject before the lawful basis exists (fail-closed).
 *
 * IAM-04: relationship alone is never authority. A FAMILY_MEMBER or
 * MINOR_GUARDIAN record additionally requires the actor to explicitly
 * confirm they hold authority to act for that person, recorded on the row
 * itself (`authorityConfirmedAt`), never inferred from a surname, an email
 * domain, or any other household signal: no such inference exists
 * anywhere in this function, deliberately: the PRD names this exact
 * shortcut as one adult must never become "managed" by another merely
 * because they share a name or address.
 */

export type Applicant = typeof schema.applicants.$inferSelect;
export type ApplicantRelationship = Applicant['relationship'];

export interface CreateApplicantInput {
  readonly actorAccountId: string;
  /** Owner of the record (must equal the actor: an account manages its own subjects). */
  readonly ownerAccountId: string;
  readonly displayName: string;
  readonly relationship?: ApplicantRelationship;
  /**
   * Required (and must be `true`) whenever `relationship` is not `SELF`: an
   * explicit, separate attestation that the actor holds authority to act
   * for this person, distinct from merely picking a relationship label.
   * Ignored for `SELF`: an account holder needs no attestation to act for
   * themselves.
   */
  readonly authorityConfirmed?: boolean;
}

/**
 * Which of the account's traveller records to list (LC-E): `everyday` (the default) is every
 * record that is neither archived nor in Recently Deleted, the list every place shows; `archived`
 * and `recentlyDeleted` are the two lists on the travellers page.
 */
export type ApplicantListView = 'everyday' | 'archived' | 'recentlyDeleted';

/** A record in the archived or Recently Deleted list, with its lifecycle dates. */
export interface ListedApplicant extends Applicant {
  readonly archivedAt: Date | null;
  readonly deletedAt: Date | null;
  /** When a record in Recently Deleted is deleted for good. */
  readonly purgeAfter: Date | null;
}

/**
 * List the account's traveller records. By default only everyday records: archived records and
 * records in Recently Deleted are left out, so Home, the travellers page, AI app sign-in, client
 * invitations, profile photos and the WhatsApp inbox show only the people in use. A record opened
 * by its id (`getApplicant`) is still found whatever its state. Before migration 0113 nothing can
 * be archived or deleted, so the everyday list is every record and the other two are empty.
 */
export async function listApplicants(db: Db, actorAccountId: string): Promise<Applicant[]>;
export async function listApplicants(
  db: Db,
  actorAccountId: string,
  options: { readonly view: 'everyday' },
): Promise<Applicant[]>;
export async function listApplicants(
  db: Db,
  actorAccountId: string,
  options: { readonly view: 'archived' | 'recentlyDeleted' },
): Promise<ListedApplicant[]>;
export async function listApplicants(
  db: Db,
  actorAccountId: string,
  options: { readonly view?: ApplicantListView } = {},
): Promise<Applicant[] | ListedApplicant[]> {
  const view = options.view ?? 'everyday';
  const lifecycle = await lifecycleTablesPresent(db);
  const applicants = schema.applicants;
  const owned = eq(applicants.ownerAccountId, actorAccountId);
  if (view === 'everyday') {
    return db
      .select()
      .from(applicants)
      .where(and(owned, lifecycle ? everydayApplicantCondition() : undefined));
  }
  if (!lifecycle) return [];
  const state = schema.applicantLifecycle;
  const deleted = view === 'recentlyDeleted';
  return db
    .select({
      ...getTableColumns(applicants),
      archivedAt: state.archivedAt,
      deletedAt: state.deletedAt,
      purgeAfter: state.purgeAfter,
    })
    .from(applicants)
    .innerJoin(state, eq(state.applicantId, applicants.id))
    .where(
      and(
        owned,
        deleted
          ? not(presentApplicantCondition())
          : and(presentApplicantCondition(), not(everydayApplicantCondition())),
      ),
    )
    .orderBy(
      deleted ? asc(state.purgeAfter) : desc(state.archivedAt),
      asc(applicants.displayName),
      asc(applicants.id),
    );
}

/** Load a single applicant by id (no ownership check — callers enforce that). */
export async function getApplicant(db: Db, applicantId: string): Promise<Applicant | undefined> {
  return first(
    await db.select().from(schema.applicants).where(eq(schema.applicants.id, applicantId)).limit(1),
  );
}

/**
 * Create an applicant subject (self, family member, or guarded minor) owned by
 * the actor's account. Requires CORE_PROCESSING consent.
 */
export async function createApplicant(
  db: Db,
  input: CreateApplicantInput,
): Promise<Result<Applicant, ServiceError>> {
  if (input.actorAccountId !== input.ownerAccountId) {
    return err(serviceError('forbidden', 'applicants may only be created by their owning account'));
  }
  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    return err(serviceError('invalid', 'a display name is required'));
  }
  if (!(await hasConsent(db, input.ownerAccountId, 'CORE_PROCESSING'))) {
    return err(
      serviceError(
        'consent_required',
        'Core processing consent is required before creating records',
      ),
    );
  }

  const relationship = input.relationship ?? 'SELF';
  if (relationship !== 'SELF' && !input.authorityConfirmed) {
    return err(
      serviceError(
        'invalid',
        'confirm you have authority to create a record for this person before continuing',
      ),
    );
  }
  const authorityConfirmedAt =
    relationship !== 'SELF' && input.authorityConfirmed ? new Date() : null;

  return db.transaction(async (tx) => {
    const applicant = required(
      first(
        await tx
          .insert(schema.applicants)
          .values({
            ownerAccountId: input.ownerAccountId,
            displayName,
            relationship,
            authorityConfirmedAt,
          })
          .returning(),
      ),
      'applicant',
    );
    // The visible code people quote (ADR 0018), in the same transaction.
    await assignReferenceCode(tx, 'P', applicant.id);
    await appendAuditEvent(tx, {
      eventType: 'APPLICANT_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: applicant.id,
      resourceType: 'applicant',
      resourceId: applicant.id,
      metadata: { relationship, authorityConfirmed: authorityConfirmedAt !== null },
    });
    await recordProductEvent(tx, {
      eventType: 'APPLICANT_CREATED',
      accountId: input.actorAccountId,
    });
    return ok(applicant);
  });
}

/** Convenience wrapper: create a family-member (or guarded-minor) subject. */
export async function addFamilyMember(
  db: Db,
  input: Omit<CreateApplicantInput, 'relationship'> & {
    readonly relationship?: ApplicantRelationship;
  },
): Promise<Result<Applicant, ServiceError>> {
  return createApplicant(db, { ...input, relationship: input.relationship ?? 'FAMILY_MEMBER' });
}
