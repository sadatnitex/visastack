import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { isPlatformAdmin } from '../../../lib/admin';
import { withSession } from '../../../lib/session';
import { staffFactorGate } from '../../../lib/staff-factor';
import { AdminRestricted } from './admin-restricted';

export const dynamic = 'force-dynamic';

/**
 * Contextual primary navigation comes from the shared shell; pages retain concern checks. When
 * authenticator codes are required, staff prove one code per sign-in before any platform page
 * opens, and a person who has not set the app up yet is taken to set it up.
 */
export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  const gate = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { kind: 'restricted' } as const;
    return staffFactorGate(accountId, '/app/admin', { anyAge: true });
  });
  if (gate.kind === 'restricted') return <AdminRestricted />;
  if (gate.kind === 'redirect') redirect(gate.url);
  if (gate.kind === 'unavailable') {
    return (
      <section className="section container">
        <output className="notice notice-warn">
          Platform pages are paused until authenticator codes can be checked. Try again in a moment.
        </output>
      </section>
    );
  }
  return <>{children}</>;
}
