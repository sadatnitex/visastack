import type { AttentionItem } from '@visastack/services';
import { formatDateOnly } from '../../lib/format-date';
import { documentTypeLabel } from '../../lib/labels';
import { plural } from '../../lib/plural';
import { requestItemLabel } from './agency/[orgId]/do-next';

/**
 * The heading for one item: what a request asks for or which document is expiring, by its own
 * name, otherwise the plain heading the item came with. Server-only: the request label reads the
 * field catalogue, which never goes to the browser.
 */
export function attentionHeading(item: AttentionItem): string {
  const subject = item.subject;
  if (subject?.kind === 'request') {
    return requestItemLabel({
      kind: subject.requestKind,
      fieldKey: subject.fieldKey,
      docType: subject.docType,
    });
  }
  if (subject?.kind === 'document' && subject.docType) return documentTypeLabel(subject.docType);
  return item.title;
}

/** Who and which case an item is about, in a short line. */
export function attentionContext(item: AttentionItem): string {
  const parts = [item.applicantName, item.caseTitle].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  if (item.count !== null) {
    parts.push(
      item.kind === 'sharing_invitations'
        ? plural(item.count, 'invitation')
        : plural(item.count, 'suggested detail'),
    );
  }
  return parts.join(' \u00b7 ');
}

/** The date line for an item, or null when it has no date (an unknown date gets a badge). */
export function attentionWhen(item: AttentionItem): string | null {
  if (item.dueDate === null) return null;
  const date = formatDateOnly(item.dueDate);
  if (item.kind === 'document_expiry') {
    return item.dueState === 'overdue' ? `Expired on ${date}` : `Expires on ${date}`;
  }
  if (item.daysUntilDue === 0) return `Due today, ${date}`;
  if (item.dueState === 'overdue') return `Was due on ${date}`;
  return `Due on ${date}`;
}
