import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Applicant, family-member, and authorized minor/guardian records
 * (Build Spec §2, PRD §2).
 *
 * An account owns one or more applicant records: the account holder ("SELF")
 * plus family members and minors under guardianship. Creating any subject
 * record requires the account's CORE_PROCESSING consent — data is never
 * created for a subject before the lawful basis exists (fail-closed).
 */

export type Applicant = typeof schema.applicants.$inferSelect;
export type ApplicantRelationship = Applicant['relationship'];

export interface CreateApplicantInput {
  readonly actorAccountId: string;
  /** Owner of the record (must equal the actor: an account manages its own subjects). */
  readonly ownerAccountId: string;
  readonly displayName: string;
  readonly relationship?: ApplicantRelationship;
}

/** List every applicant record owned by the account. */
export async function listApplicants(db: Db, actorAccountId: string): Promise<Applicant[]> {
  return db
    .select()
    .from(schema.applicants)
    .where(eq(schema.applicants.ownerAccountId, actorAccountId));
}

/** Load a single applicant by id (no ownership check — callers enforce that). */
export async function getApplicant(db: Db, applicantId: string): Promise<Applicant | undefined> {
  return first(
    await db.select().from(schema.applicants).where(eq(schema.applicants.id, applicantId)).limit(1),
  );
}

/**
 * Every applicant, platform-wide (no ownership check — for platform-admin
 * pickers/lookups only; callers must enforce the admin gate).
 */
export async function listAllApplicants(db: Db): Promise<Applicant[]> {
  return db.select().from(schema.applicants);
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
        'CORE_PROCESSING consent is required before creating records',
      ),
    );
  }

  const relationship = input.relationship ?? 'SELF';
  return db.transaction(async (tx) => {
    const applicant = required(
      first(
        await tx
          .insert(schema.applicants)
          .values({ ownerAccountId: input.ownerAccountId, displayName, relationship })
          .returning(),
      ),
      'applicant',
    );
    await appendAuditEvent(tx, {
      eventType: 'APPLICANT_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: applicant.id,
      resourceType: 'applicant',
      resourceId: applicant.id,
      metadata: { relationship },
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
