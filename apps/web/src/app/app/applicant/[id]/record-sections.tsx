'use client';

import { usePathname } from 'next/navigation';
import { isCurrentPath } from '../../../../lib/navigation';
import { recordSections } from '../../../../lib/workspace-navigation';
import { SubNav } from '../../subnav';

/**
 * The sections of the Record tab, as one underlined row of short tabs that share the width (nothing
 * scrolls, at any phone width), shown above each Record page so a person can move between
 * My Profile, Documents, Dates & Expiry and History without leaving Record. Other pages of the
 * person's workspace (Home, Cases, Sharing, Evidence Requests) do not show it.
 */
export function RecordSections({ applicantId }: { readonly applicantId: string }) {
  const pathname = usePathname();
  const sections = recordSections(applicantId);
  if (!sections.some((section) => isCurrentPath(pathname, section))) return null;
  return <SubNav links={sections} label="Record Sections" fit />;
}
