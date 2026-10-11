import { type Result, err, ok } from '@visastack/core';
import { asc, gt } from 'drizzle-orm';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type PlatformAuthInput, isPlatformOwner } from './platform-roles';

export interface PlatformMember {
  readonly id: string;
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  readonly createdAt: Date;
}

/** Owner-only account directory, independent of legacy IDs or staff-role reports. */
export async function listPlatformMembers(
  db: Db,
  actor: PlatformAuthInput,
  after?: string,
): Promise<
  Result<
    { readonly members: readonly PlatformMember[]; readonly next: string | null },
    ServiceError
  >
> {
  if (!(await isPlatformOwner(db, actor)))
    return err(serviceError('forbidden', 'Platform owner access is required.'));
  if (after && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after)) {
    return err(
      serviceError('invalid', 'This page link is invalid. Open the member directory again.'),
    );
  }
  const rows = await db
    .select({
      id: schema.accounts.id,
      email: schema.accounts.email,
      emailVerifiedAt: schema.accounts.emailVerifiedAt,
      createdAt: schema.accounts.createdAt,
    })
    .from(schema.accounts)
    .where(after ? gt(schema.accounts.id, after) : undefined)
    .orderBy(asc(schema.accounts.id))
    .limit(51);
  return ok({ members: rows.slice(0, 50), next: rows.length > 50 ? (rows[49]?.id ?? null) : null });
}
