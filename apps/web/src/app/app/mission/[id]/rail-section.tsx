import type { ReactNode } from 'react';
import { atLevel } from '../../../../components/depth';
import { ExpandableSection } from '../../../../components/ui-lift/expandable-section';
import type { DepthLevel } from '../../../../lib/ccd/depth';

/**
 * A rail card as an Expandable Section (WAL3). On a phone it is a closed row with a one-line
 * summary; on a wide screen the row is hidden and the card shows as it always did (globals.css,
 * WP-WAL3 block), so nothing is lost on either size. The anchor sits on the body, inside the
 * closed row, so a link to it opens the row.
 */
export function RailSection({
  id,
  level,
  title,
  summary,
  open,
  children,
}: {
  readonly id?: string;
  readonly level: DepthLevel;
  readonly title: string;
  readonly summary: string;
  readonly open?: boolean | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="lift-rail-slot rail-section" data-rail-section="" {...atLevel(level)}>
      <ExpandableSection
        title={title}
        summary={summary}
        headingLevel={2}
        defaultOpen={open === true}
      >
        <div className="rail-section-body" {...(id ? { id } : {})}>
          {children}
        </div>
      </ExpandableSection>
    </div>
  );
}
