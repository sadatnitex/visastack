import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type AuthorizedApplicant,
  type Db,
  acceptCompanionInvitation,
  accountPrincipal,
  addCompanion,
  addDocumentVersion,
  addTravellerToTrip,
  createApplicant,
  openCompanionInvitation,
  provisionAccount,
  registerDocument,
  requireAccess,
  setConsent,
  startGroupTrip,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

/**
 * Shared fixtures for the joined trip tests (UX6 package 4): a real migrated database, an organiser
 * with a trip and a managed family member, and a companion who joined. Synthetic data only.
 */

export const FRIEND = 'friend@example.com';
export const FAMILY_NAME = 'Zubair Karim Family Member';
export const COMPANION_NAME = 'Nadia Rahman';

export async function newAccount(
  db: Db,
  email: string,
  options: { consent?: boolean } = {},
): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!made.ok) throw new Error('account');
  if (options.consent !== false) {
    await setConsent(db, {
      actorAccountId: made.value.id,
      accountId: made.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
  }
  await db
    .update(schema.accounts)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(schema.accounts.id, made.value.id));
  return made.value.id;
}

export async function addPerson(
  db: Db,
  owner: string,
  displayName: string,
  relationship: 'SELF' | 'FAMILY_MEMBER' = 'SELF',
): Promise<string> {
  const made = await createApplicant(db, {
    actorAccountId: owner,
    ownerAccountId: owner,
    displayName,
    relationship,
    authorityConfirmed: relationship !== 'SELF',
  });
  if (!made.ok) throw new Error(`applicant: ${made.error.message}`);
  return made.value.id;
}

export async function addPaper(
  db: Db,
  owner: string,
  applicantId: string,
  docType: string,
  name: string,
): Promise<string> {
  const doc = await registerDocument(db, {
    actorAccountId: owner,
    applicantId,
    originalName: name,
    docType,
  });
  if (!doc.ok) throw new Error('document');
  const version = await addDocumentVersion(db, {
    actorAccountId: owner,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `k-${Math.random().toString(36).slice(2)}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
  });
  if (!version.ok) throw new Error('version');
  return doc.value.id;
}

export interface JoinedWorld {
  readonly db: Db;
  readonly client: Awaited<ReturnType<typeof createMigratedPglite>>;
  readonly organiserId: string;
  readonly organiserApplicantId: string;
  readonly familyApplicantId: string;
  readonly tripId: string;
  /** The companion who joined, and the row that records it. */
  readonly guestId: string;
  readonly companionId: string;
  readonly organiserProof: () => Promise<AuthorizedApplicant<'MANAGE'>>;
}

/** An organiser (with a family member on the trip), and a companion who joined at `level`. */
export async function joinedWorld(level = 'NAME_ONLY'): Promise<JoinedWorld> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema }) as unknown as Db;
  const organiserId = await newAccount(db, 'organiser@example.com');
  const organiserApplicantId = await addPerson(db, organiserId, 'Rahima Akter');
  const familyApplicantId = await addPerson(db, organiserId, FAMILY_NAME, 'FAMILY_MEMBER');
  const organiserProof = async () => {
    const proof = await requireAccess(
      db,
      accountPrincipal(organiserId),
      'MANAGE',
      { applicantId: organiserApplicantId },
      { purpose: 'owner_trip' },
    );
    if (!proof.ok) throw new Error('proof');
    return proof.value as AuthorizedApplicant<'MANAGE'>;
  };
  const started = await startGroupTrip(await organiserProof(), {
    destination: 'Japan',
    purpose: 'Tourism',
  });
  if (!started.ok) throw new Error('trip');
  const tripId = started.value.tripId;
  // The family member travels too: a companion must never see this name.
  const familyProof = await requireAccess(
    db,
    accountPrincipal(organiserId),
    'MANAGE',
    { applicantId: familyApplicantId },
    { purpose: 'owner_trip' },
  );
  if (!familyProof.ok) throw new Error('family proof');
  const linked = await addTravellerToTrip(
    familyProof.value as AuthorizedApplicant<'MANAGE'>,
    tripId,
  );
  if (!linked.ok) throw new Error(`family: ${linked.error.message}`);

  const added = await addCompanion(await organiserProof(), tripId, {
    name: COMPANION_NAME,
    email: FRIEND,
  });
  if (!added.ok || !added.value.invitation) throw new Error('invite');
  const guestId = await newAccount(db, FRIEND);
  const token = added.value.invitation.rawToken;
  const opened = await openCompanionInvitation(db, { accountId: guestId, rawToken: token });
  if (!opened.ok) throw new Error('open');
  const accepted = await acceptCompanionInvitation(db, opened.value, {
    rawToken: token,
    shareLevel: level,
  });
  if (!accepted.ok) throw new Error(`accept: ${accepted.error.message}`);
  return {
    db,
    client,
    organiserId,
    organiserApplicantId,
    familyApplicantId,
    tripId,
    guestId,
    companionId: added.value.companion.id,
    organiserProof,
  };
}
