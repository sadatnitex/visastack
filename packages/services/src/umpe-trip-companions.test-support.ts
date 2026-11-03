import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { type AuthorizedApplicant, accountPrincipal, requireAccess } from './access';
import { joinedCompanionAccess } from './access/trip-companion-access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import {
  acceptCompanionInvitation,
  addCompanion,
  listCompanions,
  openCompanionInvitation,
} from './umpe-trip-companions';
import { startGroupTrip } from './umpe-trip-service';

/**
 * Shared fixtures for the companion tests of UX6 package 4 (the companion's own case and papers).
 * Synthetic data only; a real migrated database for every test.
 */

export const TRIP = { destination: 'Japan', purpose: 'Tourism' } as const;

export async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

export async function account(
  db: Db,
  email: string,
  options: { consent?: boolean } = {},
): Promise<string> {
  const created = await provisionAccount(db, { email });
  if (!isOk(created)) throw new Error('provision');
  if (options.consent !== false) {
    await setConsent(db, {
      actorAccountId: created.value.id,
      accountId: created.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
  }
  await db
    .update(schema.accounts)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(schema.accounts.id, created.value.id));
  return created.value.id;
}

export async function traveller(
  db: Db,
  owner: string,
  displayName: string,
  relationship: 'SELF' | 'FAMILY_MEMBER' = 'SELF',
): Promise<string> {
  const created = await createApplicant(db, {
    actorAccountId: owner,
    ownerAccountId: owner,
    displayName,
    relationship,
    authorityConfirmed: relationship !== 'SELF',
  });
  if (!isOk(created)) throw new Error(`applicant: ${created.error.message}`);
  return created.value.id;
}

export async function proofFor<A extends 'MANAGE' | 'VIEW_METADATA'>(
  db: Db,
  actor: string,
  applicantId: string,
  action: A,
): Promise<AuthorizedApplicant<A>> {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    action,
    { applicantId },
    { purpose: 'owner_trip' },
  );
  if (!isOk(proof)) throw new Error('proof');
  return proof.value as AuthorizedApplicant<A>;
}

/** The owner's proof of one document (what choosing a paper needs), or null when access is denied. */
export async function documentProof(
  db: Db,
  actor: string,
  documentId: string,
): Promise<AuthorizedApplicant<'VIEW_METADATA'> | null> {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    'VIEW_METADATA',
    { documentId },
    { purpose: 'owner_trip' },
  );
  return isOk(proof) ? (proof.value as AuthorizedApplicant<'VIEW_METADATA'>) : null;
}

export async function document(
  db: Db,
  actor: string,
  applicantId: string,
  docType: string,
  name = `${docType}.pdf`,
): Promise<string> {
  const doc = await registerDocument(db, {
    actorAccountId: actor,
    applicantId,
    originalName: name,
    docType,
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: actor,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `k-${Math.random().toString(36).slice(2)}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
  });
  if (!isOk(version)) throw new Error('version');
  return doc.value.id;
}

export interface Organiser {
  readonly accountId: string;
  readonly applicantId: string;
  readonly tripId: string;
}

export async function organiser(db: Db, email = 'organiser@example.com'): Promise<Organiser> {
  const accountId = await account(db, email);
  const applicantId = await traveller(db, accountId, 'Synthetic Organiser');
  const started = await startGroupTrip(await proofFor(db, accountId, applicantId, 'MANAGE'), TRIP);
  if (!isOk(started)) throw new Error(`trip: ${started.error.message}`);
  return { accountId, applicantId, tripId: started.value.tripId };
}

/** The organiser's list of people, as the trip page reads it. */
export async function organiserList(db: Db, org: Organiser) {
  const listed = await listCompanions(
    await proofFor(db, org.accountId, org.applicantId, 'VIEW_METADATA'),
    org.tripId,
  );
  if (!isOk(listed)) throw new Error(`list: ${listed.error.message}`);
  return listed.value;
}

/** Invites an address, then has a new account with that address accept at the given level. */
export async function joined(
  db: Db,
  org: Organiser,
  name: string,
  email: string,
  level = 'NAME_ONLY',
) {
  const added = await addCompanion(
    await proofFor(db, org.accountId, org.applicantId, 'MANAGE'),
    org.tripId,
    { name, email },
  );
  if (!isOk(added) || !added.value.invitation) throw new Error('invite');
  const guest = await account(db, email);
  const token = added.value.invitation.rawToken;
  const opened = await openCompanionInvitation(db, { accountId: guest, rawToken: token });
  if (!isOk(opened)) throw new Error('open');
  const accepted = await acceptCompanionInvitation(db, opened.value, {
    rawToken: token,
    shareLevel: level,
  });
  if (!isOk(accepted)) throw new Error(`accept: ${accepted.error.message}`);
  const access = await joinedCompanionAccess(db, guest, org.tripId);
  if (!access) throw new Error('no access');
  return { companionId: added.value.companion.id, guest, access };
}
