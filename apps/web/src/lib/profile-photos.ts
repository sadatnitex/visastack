import 'server-only';
import { SharpPhotoReencoder } from '@visastack/adapters';
import {
  type AuthorizedApplicant,
  type Db,
  EACH_GRANT,
  type ProfilePhotoPorts,
  accountPrincipal,
  applicantPhotoPath,
  getApplicantPhotoVersion,
  listApplicants,
  requireAccess,
} from '@visastack/services';
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

/** The address of a traveller's current photo for this viewer, or null when there is none to show them. */
export async function applicantPhotoUrl(
  db: Db,
  accountId: string,
  applicantId: string,
): Promise<string | null> {
  const access = await photoAccess(db, accountId, applicantId, 'VIEW_METADATA');
  if (!access) return null;
  const version = await getApplicantPhotoVersion(access);
  return version.ok && version.value ? applicantPhotoPath(applicantId, version.value) : null;
}

/**
 * For showing a photo only: any failure (for example before the photo table's migration has
 * run) shows initials instead of breaking the page. This never grants anything: a failure
 * can only hide a photo.
 */
export async function displayPhotoUrl(
  db: Db,
  accountId: string,
  applicantId: string,
): Promise<string | null> {
  try {
    return await applicantPhotoUrl(db, accountId, applicantId);
  } catch (error) {
    // Message only: a driver error can carry query parameters.
    console.error(
      `[profile-photo] photo could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
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
    const people = await listApplicants(db, accountId);
    const me = people.find((person) => person.relationship === 'SELF');
    if (!me) return { self: null };
    return {
      self: {
        id: me.id,
        name: me.displayName,
        photoUrl: await displayPhotoUrl(db, accountId, me.id),
      },
    };
  } catch (error) {
    console.error(
      `[profile-photo] own photo could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
