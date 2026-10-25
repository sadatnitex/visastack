import 'server-only';
import { SharpPhotoReencoder } from '@visastack/adapters';
import {
  type Applicant,
  type AuthorizedApplicant,
  type Db,
  EACH_GRANT,
  type ProfilePhotoPorts,
  accountPrincipal,
  applicantPhotoPath,
  listApplicantPhotoVersions,
  listApplicants,
  requireAccess,
} from '@visastack/services';
import { cache } from 'react';
import { createMalwareScanner } from './providers';
import { createStorage } from './storage';

/**
 * The web side of profile photos (WP-PH1). Every read and write goes through
 * the central access gate for one traveller record; the photo services then
 * refuse anyone but that record's owner.
 */

export function profilePhotoPorts(db: Db): ProfilePhotoPorts {
  const storage = createStorage(db);
  return { storage, scanner: createMalwareScanner(storage), reencoder: new SharpPhotoReencoder() };
}

export async function photoAccess<A extends 'MANAGE' | 'VIEW_METADATA'>(
  db: Db,
  accountId: string,
  applicantId: string,
  action: A,
): Promise<AuthorizedApplicant<A> | null> {
  const proof = await requireAccess(
    db,
    accountPrincipal(accountId),
    action,
    { applicantId },
    { purpose: EACH_GRANT },
  );
  return proof.ok ? proof.value : null;
}

function logPhotoFailure(what: string, error: unknown): void {
  // Message only: a driver error can carry query parameters.
  console.error(
    `[profile-photo] ${what} could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * Photo addresses for the given records of this account, in one batched read
 * after the gate has approved each record. For showing photos only: any
 * failure shows initials instead of breaking the page, and never grants
 * anything (a failure can only hide a photo).
 */
async function ownedPhotoUrls(
  db: Db,
  accountId: string,
  applicantIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  try {
    const proofs = (
      await Promise.all(applicantIds.map((id) => photoAccess(db, accountId, id, 'VIEW_METADATA')))
    ).filter((proof): proof is AuthorizedApplicant<'VIEW_METADATA'> => proof !== null);
    const [firstProof, ...rest] = proofs;
    if (!firstProof) return new Map();
    const versions = await listApplicantPhotoVersions(firstProof, ...rest);
    if (!versions.ok) return new Map();
    return new Map(
      [...versions.value].map(([id, version]) => [id, applicantPhotoPath(id, version)] as const),
    );
  } catch (error) {
    logPhotoFailure('photos', error);
    return new Map();
  }
}

export interface OwnedTravellers {
  readonly people: readonly Applicant[];
  /** Photo address by traveller id; a traveller without a photo is absent. */
  readonly photos: ReadonlyMap<string, string>;
}

// One answer per account per page render: the workspace frame, the account page and the profile
// page all ask, and only the first asks the database. Outside a page render (server actions,
// route handlers, tests) `cache()` keeps nothing, so every call reads afresh.
const travellerMemo = cache(() => new Map<string, Promise<OwnedTravellers>>());

/** The account's own travellers (the existing owner read) and their photos. Fails only if the traveller list itself fails. */
export function loadOwnedTravellers(db: Db, accountId: string): Promise<OwnedTravellers> {
  const memo = travellerMemo();
  const cached = memo.get(accountId);
  if (cached) return cached;
  const loading = (async () => {
    const people = await listApplicants(db, accountId);
    const photos = await ownedPhotoUrls(
      db,
      accountId,
      people.map((person) => person.id),
    );
    return { people, photos };
  })();
  memo.set(accountId, loading);
  loading.catch(() => memo.delete(accountId));
  return loading;
}

/** One traveller's photo address for this account, or null. Never fails. */
export async function ownedPhotoUrl(
  db: Db,
  accountId: string,
  applicantId: string,
): Promise<string | null> {
  try {
    return (await loadOwnedTravellers(db, accountId)).photos.get(applicantId) ?? null;
  } catch (error) {
    logPhotoFailure('photo', error);
    return null;
  }
}

export interface OwnPhoto {
  /** The signed-in person's own traveller record, or null when they have not added themselves. */
  readonly self: {
    readonly id: string;
    readonly name: string;
    readonly photoUrl: string | null;
  } | null;
}

/** For the account page: the person's own traveller record and its photo. Null when it cannot be read, so the card is left out rather than the page failing. */
export async function loadOwnPhoto(db: Db, accountId: string): Promise<OwnPhoto | null> {
  try {
    const { people, photos } = await loadOwnedTravellers(db, accountId);
    const me = people.find((person) => person.relationship === 'SELF');
    if (!me) return { self: null };
    return { self: { id: me.id, name: me.displayName, photoUrl: photos.get(me.id) ?? null } };
  } catch (error) {
    logPhotoFailure('own photo', error);
    return null;
  }
}
