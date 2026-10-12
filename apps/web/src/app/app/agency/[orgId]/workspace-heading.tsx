'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '../../../../components/ui';

/** Display only. The server layout still checks membership and supplies every permission. */
export function AgencyWorkspaceHeading({
  organizationId,
  name,
  admin,
  lead,
  status,
}: {
  readonly organizationId: string;
  readonly name: string;
  readonly admin: boolean;
  readonly lead: ReactNode;
  readonly status: ReactNode;
}) {
  const base = `/app/agency/${organizationId}`;
  const overview = usePathname() === base;
  return (
    <PageHeader
      {...(!overview ? { back: { href: base, label: 'Agency overview' } } : {})}
      lead={lead}
      eyebrow="Agency workspace"
      title={name}
      description="Your clients, cases and team in one place."
      actions={
        <>
          {overview && admin ? (
            <Link className="btn btn-primary" href={`${base}/clients`}>
              Invite traveller
            </Link>
          ) : null}
          {status}
        </>
      }
    />
  );
}
