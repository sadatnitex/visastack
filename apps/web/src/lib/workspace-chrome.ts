import 'server-only';
import {
  type Db,
  type WorkspaceToolbarState,
  agencyCollectionRequestsEnabled,
  collectionAuthorityOf,
  listMembershipsForAccount,
  loadWorkspaceToolbarState,
} from '@visastack/services';
import { hasPlatformPermission, holdsPlatformRole, isPlatformOwnerAccount } from './admin';
import { documentRemovalRequestsOn } from './env';
import { loadOwnedTravellers } from './profile-photos';
import type { WorkspaceAccess } from './workspace-navigation';

/** Existing owner and active-membership reads, never an email-based permission shortcut. */
export async function loadWorkspaceChrome(
  db: Db,
  actor: { readonly accountId: string; readonly email: string; readonly displayName?: string },
): Promise<
  WorkspaceAccess & { readonly accountName: string; readonly toolbar: WorkspaceToolbarState }
> {
  // The owner's travellers and, in one batched read, their photos (WP-PH1); a photo failure
  // only hides photos.
  const [{ people, archived, photos }, memberships, platform, toolbar] = await Promise.all([
    loadOwnedTravellers(db, actor.accountId),
    listMembershipsForAccount(db, actor.accountId),
    holdsPlatformRole(db, actor),
    loadWorkspaceToolbarState(db, actor.accountId),
  ]);
  const permissions = platform
    ? await Promise.all([
        isPlatformOwnerAccount(db, actor),
        hasPlatformPermission(db, actor, 'AI_SETTINGS_MANAGE'),
        hasPlatformPermission(db, actor, 'COMPLAINT_MANAGE'),
        hasPlatformPermission(db, actor, 'AUDIT_TRAIL_VIEW'),
        hasPlatformPermission(db, actor, 'APPLICANT_DIRECTORY_VIEW'),
        hasPlatformPermission(db, actor, 'FEEDBACK_VIEW'),
        hasPlatformPermission(db, actor, 'PROCESSING_JOB_RETRY'),
        hasPlatformPermission(db, actor, 'DOCUMENT_PROTECTION_MANAGE'),
        hasPlatformPermission(db, actor, 'ACCOUNT_SIGN_IN_RECOVERY'),
      ])
    : null;
  // UMPE G3: a member (not an owner or admin) may send document requests only with May Request
  // Documents; read live per agency, only while the switch is on, and a failed read hides the link.
  const collectionsOn = agencyCollectionRequestsEnabled();
  const requesters = new Set<string>();
  if (collectionsOn) {
    const members = memberships.filter(
      (membership) =>
        membership.active && membership.role !== 'OWNER' && membership.role !== 'ADMIN',
    );
    const authorities = await Promise.all(
      members.map((membership) =>
        collectionAuthorityOf(db, actor.accountId, membership.organization.id).catch(() => null),
      ),
    );
    members.forEach((membership, index) => {
      if (authorities[index] === 'REQUESTER') requesters.add(membership.organization.id);
    });
  }
  return {
    toolbar,
    accountName:
      actor.displayName?.trim() ||
      people.find((person) => person.relationship === 'SELF')?.displayName ||
      'Your Account',
    travellers: people.map((person) => ({
      id: person.id,
      name: person.displayName,
      relationship: person.relationship,
      photo: photos.get(person.id) ?? null,
    })),
    // Not offered in the switcher; only keeps an archived traveller's page in its frame (LC-E).
    archivedTravellers: archived.map((person) => ({
      id: person.id,
      name: person.displayName,
      relationship: person.relationship,
      photo: photos.get(person.id) ?? null,
    })),
    agencies: memberships
      .filter((membership) => membership.active)
      .map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        admin: membership.role === 'OWNER' || membership.role === 'ADMIN',
        // UMPE P6 and G3: owners, admins and members with May Request Documents, switch on only.
        ...(collectionsOn &&
        (membership.role === 'OWNER' ||
          membership.role === 'ADMIN' ||
          requesters.has(membership.organization.id))
          ? { collectionRequests: true }
          : {}),
      })),
    platform: permissions
      ? {
          owner: permissions[0] === true,
          ai: permissions[1] === true,
          complaints: permissions[2] === true,
          audit: permissions[3] === true,
          privacy: permissions[4] === true,
          // The removal queue needs privacy access and the owner's switch (lifecycle lane D).
          removals: permissions[4] === true && documentRemovalRequestsOn(),
          // UMPE P12: Field Insights uses the existing feedback permission.
          insights: permissions[5] === true,
          // The Operations and Billing group lists only what this role can open.
          email: permissions[6] === true,
          protection: permissions[7] === true,
          recovery: permissions[8] === true,
        }
      : null,
  };
}
