import type { AttentionItem } from '@visastack/services';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../../components/icons';
import { DocumentPicture } from '../../../components/pictures/document-picture';
import { StatusBadge } from '../../../components/ui';
import { ExpandableSection } from '../../../components/ui-lift/expandable-section';

/*
 * One Needs Attention item as one Wallet row (WAL10): a picture, the title, the person and case,
 * the urgency word and the item's single action. The reason shows as one clamped line in the row
 * itself (so a quick look or a screen reader meets it without opening anything); the full
 * sentence sits inside the row and opens with a tap. The urgency word, person and date are always
 * visible. The markup is the browser's own details, so the sentence is in the page
 * without script. Nothing here reads data: Home passes in what it already worked out.
 */

/** The picture of one item: the document's own drawing, or one mark for the kind. */
export function attentionPictureFor(item: AttentionItem): {
  readonly type: 'document' | 'icon';
  readonly node: ReactNode;
} {
  const docType =
    item.subject?.kind === 'document' || item.subject?.kind === 'request'
      ? item.subject.docType
      : null;
  if (item.kind === 'document_expiry' || (item.kind === 'evidence_request' && docType)) {
    return { type: 'document', node: <DocumentPicture type={docType} size={36} /> };
  }
  const names: Readonly<Record<AttentionItem['kind'], IconName>> = {
    evidence_request: 'file',
    task: 'clipboard',
    case_changed: 'activity',
    document_expiry: 'file',
    suggestions: 'eye',
    sharing_invitations: 'share',
  };
  return {
    type: 'icon',
    node: (
      <span className="home-attention-mark">
        <Icon name={names[item.kind]} size={22} />
      </span>
    ),
  };
}

export function AttentionRow({
  item,
  heading,
  context,
  when,
  tierLabel,
  actionLabel,
}: {
  readonly item: AttentionItem;
  readonly heading: string;
  readonly context: string;
  readonly when: string | null;
  readonly tierLabel: string;
  readonly actionLabel: string;
}) {
  return (
    <li className={`do-next-item home-attention-row do-next-tier-${item.tier}`}>
      <ExpandableSection
        title={heading}
        summary={item.why}
        picture={attentionPictureFor(item).node}
        className="home-attention-section"
      >
        <p className="home-attention-why">{item.why}</p>
      </ExpandableSection>
      <div className="home-attention-meta">
        <span className="do-next-tier">
          <StatusBadge tone={item.tier <= 2 ? 'danger' : item.tier <= 3 ? 'warning' : 'neutral'}>
            {tierLabel}
          </StatusBadge>
        </span>
        {context ? <p className="do-next-context home-attention-person">{context}</p> : null}
        {when ? (
          <p className="home-attention-when">{when}</p>
        ) : item.dueState === 'unknown' ? (
          <p className="home-attention-when">
            <StatusBadge tone="neutral">Date Unknown</StatusBadge>
          </p>
        ) : null}
      </div>
      <div className="do-next-action">
        <Link href={item.href} className="btn btn-secondary do-next-link">
          {actionLabel}
          <span className="sr-only">: {heading}</span>
        </Link>
      </div>
    </li>
  );
}
