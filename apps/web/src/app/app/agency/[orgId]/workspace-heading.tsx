'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AgencyBrand } from '../../../../lib/agency-brand';
import { AgencyBrandScope, AgencyMark } from './org-branding-header';

/** The page names of the agency workspace, by the part of the address after the agency. */
const PAGE_NAMES: Readonly<Record<string, string>> = {
  '': 'Agency Overview',
  cases: 'Cases',
  clients: 'Clients',
  team: 'Team',
  settings: 'Settings',
  countries: 'Countries',
  activity: 'Case Activity',
};

/**
 * Display only. The server layout still checks membership and supplies every permission.
 * The agency's name sits above as the eyebrow and the page's own name is the one h1 (D3). A page
 * that renders its own h1 (Plan & Usage) gets the agency's name as plain text instead.
 */
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
  const pathname = usePathname();
  const overview = pathname === base;
  const section = pathname.startsWith(`${base}/`)
    ? (pathname.slice(base.length + 1).split('/')[0] ?? '')
    : '';
  const pageName = overview ? PAGE_NAMES[''] : PAGE_NAMES[section];
  return (
    <AgencyBrandScope brand={brand} className="agency-hero">
      <AgencyMark brand={brand} size="lg" />
      <div className="agency-hero-text">
        {!overview ? (
          <Link href={base} className="page-back">
            <span aria-hidden="true">{'←'}</span> Agency Overview
          </Link>
        ) : null}
        {pageName ? (
          <>
            <span className="eyebrow">{brand.name}</span>
            <h1 className="page-title">{pageName}</h1>
          </>
        ) : (
          <p className="page-title">{brand.name}</p>
        )}
        <p className="page-description">Your clients, cases and team in one place.</p>
        <p className="agency-hero-attribution">Powered by VisaStack</p>
      </div>
      <div className="page-actions">
        {overview && admin ? (
          <Link className="btn btn-primary" href={`${base}/clients`}>
            Invite a Client
          </Link>
        ) : null}
        {status}
      </div>
    </AgencyBrandScope>
  );
}
