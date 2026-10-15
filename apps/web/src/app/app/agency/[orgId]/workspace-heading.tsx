'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AgencyBrand } from '../../../../lib/agency-brand';
import { AgencyBrandScope, AgencyMark } from './org-branding-header';

/** Display only. The server layout still checks membership and supplies every permission. */
export function AgencyWorkspaceHeading({
  organizationId,
  brand,
  admin,
  status,
}: {
  readonly organizationId: string;
  readonly brand: AgencyBrand;
  readonly admin: boolean;
  readonly status: ReactNode;
}) {
  const base = `/app/agency/${organizationId}`;
  const overview = usePathname() === base;
  return (
    <AgencyBrandScope brand={brand} className="agency-hero">
      <AgencyMark brand={brand} size="lg" />
      <div className="agency-hero-text">
        {!overview ? (
          <Link href={base} className="page-back">
            <span aria-hidden="true">{'←'}</span> Agency overview
          </Link>
        ) : null}
        <span className="eyebrow">Agency workspace</span>
        <h1 className="page-title">{brand.name}</h1>
        <p className="page-description">Your clients, cases and team in one place.</p>
        <p className="agency-hero-attribution">Powered by VisaStack</p>
      </div>
      <div className="page-actions">
        {overview && admin ? (
          <Link className="btn btn-primary" href={`${base}/clients`}>
            Invite traveller
          </Link>
        ) : null}
        {status}
      </div>
    </AgencyBrandScope>
  );
}
