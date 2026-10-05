import { type I18n, isMessageKey } from '@visastack/i18n';
import type { InAppNotificationView } from '@visastack/services';

/**
 * The title and text of an alert in the reader's language. An alert is stored in
 * English together with the messages it was written from; when those are known
 * and still exist, the page looks them up again in the reader's language. An
 * alert stored before that existed, or one built from a message that has since
 * been removed, is shown in the English it was written in rather than hidden.
 */
export function alertText(
  i18n: I18n,
  alert: Pick<InAppNotificationView, 'subject' | 'summary' | 'messages'>,
): { readonly subject: string; readonly summary: string } {
  const messages = alert.messages;
  if (!messages || !isMessageKey(messages.subject) || !isMessageKey(messages.summary)) {
    return { subject: alert.subject, summary: alert.summary };
  }
  return {
    subject: i18n.t(messages.subject, messages.params),
    summary: i18n.t(messages.summary, messages.params),
  };
}
