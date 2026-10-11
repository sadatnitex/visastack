import type { ReactNode } from 'react';
import { isPlatformAdmin } from '../../../lib/admin';
import { withSession } from '../../../lib/session';
import { AdminRestricted } from './admin-restricted';

export const dynamic = 'force-dynamic';

/** Contextual primary navigation comes from the shared shell; pages retain concern checks. */
export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  const access = await withSession(({ db, accountId, email }) =>
    isPlatformAdmin(db, { accountId, email }),
  );
  return access ? <>{children}</> : <AdminRestricted />;
}
