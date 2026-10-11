import 'server-only';
import {
  type Db,
  type WorkspaceToolbarState,
  listApplicants,
  listMembershipsForAccount,
  loadWorkspaceToolbarState,
} from '@visastack/services';
import { hasPlatformPermission, isPlatformAdmin, isPlatformOwnerAccount } from './admin';
import type { WorkspaceAccess } from './workspace-navigation';

/** Existing owner and active-membership reads, never an email-based permission shortcut. */
export async function loadWorkspaceChrome(
  db: Db,
  actor: { readonly accountId: string; readonly email: string },
): Promise<
  WorkspaceAccess & { readonly accountName: string; readonly toolbar: WorkspaceToolbarState }
> {
  const [people, memberships, platform, toolbar] = await Promise.all([
    listApplicants(db, actor.accountId),
    listMembershipsForAccount(db, actor.accountId),
    isPlatformAdmin(db, actor),
    loadWorkspaceToolbarState(db, actor.accountId),
  ]);
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
      people.find((person) => person.relationship === 'SELF')?.displayName ?? 'Your account',
    travellers: people.map((person) => ({
      id: person.id,
      name: person.displayName,
      relationship: person.relationship,
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
