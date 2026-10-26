import 'server-only';
import {
  type Db,
  type WorkspaceToolbarState,
  listMembershipsForAccount,
  loadWorkspaceToolbarState,
} from '@visastack/services';
import { hasPlatformPermission, isPlatformAdmin, isPlatformOwnerAccount } from './admin';
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
  const [{ people, photos }, memberships, platform, toolbar] = await Promise.all([
    loadOwnedTravellers(db, actor.accountId),
    listMembershipsForAccount(db, actor.accountId),
    isPlatformAdmin(db, actor),
    loadWorkspaceToolbarState(db, actor.accountId),
  ]);
  const permissions = platform
    ? await Promise.all([
        isPlatformOwnerAccount(db, actor),
        hasPlatformPermission(db, actor, 'AI_SETTINGS_MANAGE'),
        hasPlatformPermission(db, actor, 'COMPLAINT_MANAGE'),
        hasPlatformPermission(db, actor, 'AUDIT_TRAIL_VIEW'),
        hasPlatformPermission(db, actor, 'APPLICANT_DIRECTORY_VIEW'),
      ])
    : null;
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
          audit: permissions[3] === true,
          privacy: permissions[4] === true,
        }
      : null,
  };
}
