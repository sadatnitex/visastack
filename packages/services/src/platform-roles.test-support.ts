import { isOk } from '@visastack/core';
import { type StaffScope, staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import { type Db, schema } from './db';
import type { PlatformAction, PlatformAuthInput, PlatformRole } from './platform-roles';

/**
 * Test-only helpers (not exported from the package index): an account that holds one active
 * platform role, and the staff scope for one platform action, made the same way a page makes it.
 */
export async function seedStaffAccount(
  db: Db,
  role: PlatformRole,
  email: string,
): Promise<PlatformAuthInput> {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision failed');
  await db
    .insert(schema.platformRoles)
    .values({ accountId: account.value.id, role, reason: 'test setup' });
  return { accountId: account.value.id, email, bootstrapEmails: [] };
}

export async function staffScopeFor<A extends PlatformAction>(
  db: Db,
  actor: PlatformAuthInput,
  action: A,
): Promise<StaffScope<A>> {
  const staff = await staffPrincipal(db, actor, action);
  if (!staff.ok) throw new Error(`no staff scope: ${staff.error.message}`);
  return staff.value;
}
