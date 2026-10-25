import 'server-only';
import {
  type Db,
  type WorkspaceToolbarState,
  listApplicants,
  listMembershipsForAccount,
  loadWorkspaceToolbarState,
} from '@visastack/services';
import { hasPlatformPermission, isPlatformAdmin, isPlatformOwnerAccount } from './admin';
import { displayPhotoUrl } from './profile-photos';
import type { WorkspaceAccess } from './workspace-navigation';

/** Existing owner and active-membership reads, never an email-based permission shortcut. */
export async function loadWorkspaceChrome(
  db: Db,
  actor: { readonly accountId: string; readonly email: string; readonly displayName?: string },
): Promise<
  WorkspaceAccess & { readonly accountName: string; readonly toolbar: WorkspaceToolbarState }
> {
  const [people, memberships, platform, toolbar] = await Promise.all([
    listApplicants(db, actor.accountId),
    listMembershipsForAccount(db, actor.accountId),
    isPlatformAdmin(db, actor),
    loadWorkspaceToolbarState(db, actor.accountId),
  ]);
  // Shown where initials show; a failure only hides a photo (WP-PH1).
  const photos = await Promise.all(
    people.map((person) => displayPhotoUrl(db, actor.accountId, person.id)),
  );
  const permissions = platform
    ? await Promise.all([
        isPlatformOwnerAccount(db, actor),
        hasPlatformPermission(db, actor, 'AI_SETTINGS_MANAGE'),
        hasPlatformPermission(db, actor, 'COMPLAINT_MANAGE'),
      ])
    : null;
  return {
    toolbar,
    accountName:
      actor.displayName?.trim() ||
      people.find((person) => person.relationship === 'SELF')?.displayName ||
      'Your Account',
    travellers: people.map((person, index) => ({
      id: person.id,
      name: person.displayName,
      relationship: person.relationship,
      photo: photos[index] ?? null,
    })),
    agencies: memberships
      .filter((membership) => membership.active)
      .map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        admin: membership.role === 'OWNER' || membership.role === 'ADMIN',
      })),
    platform: permissions
      ? {
          owner: permissions[0] === true,
          ai: permissions[1] === true,
          complaints: permissions[2] === true,
        }
      : null,
  };
}
