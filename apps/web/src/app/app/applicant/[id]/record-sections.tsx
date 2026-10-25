'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isCurrentPath } from '../../../../lib/navigation';
import { recordSections } from '../../../../lib/workspace-navigation';

/**
 * The sections of the Record tab, shown above each of its pages so a person can move between
 * Profile, Documents, Dates & Expiry and History without leaving Record. Other pages of the
 * person's workspace (Home, Cases, Sharing, Evidence Requests) do not show it.
 */
export function RecordSections({ applicantId }: { readonly applicantId: string }) {
  const pathname = usePathname();
  const sections = recordSections(applicantId);
  if (!sections.some((section) => isCurrentPath(pathname, section))) return null;
  return (
    <nav className="record-sections" aria-label="Record sections">
      {sections.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          aria-current={isCurrentPath(pathname, section) ? 'page' : undefined}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
