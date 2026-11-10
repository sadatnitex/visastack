import { permissionActionLabel } from './labels';

/**
 * What each kind of access lets a person do, as plain words that finish the sentence "They can ..."
 * ("open and read your documents"). Lower case, no full stop: the caller joins them or puts each
 * in its own sentence. An access with no phrase falls back to its own label, so nothing is ever
 * left out of what a person reads before they agree.
 */
const PHRASES: Readonly<Record<string, string>> = {
  VIEW_METADATA: 'see the details of your documents',
  PREVIEW: 'open and read your documents',
  DOWNLOAD_REDACTED: 'download safe copies',
  COMMENT: 'leave comments',
  PROPOSE_EDIT: 'suggest changes that you approve first',
};

export function permissionPhrase(action: string): string {
  return PHRASES[action] ?? permissionActionLabel(action).toLowerCase();
}

/** "They can open and read your documents." for one access. */
export function permissionSentence(action: string): string {
  return `They can ${permissionPhrase(action)}.`;
}

/**
 * The same access in the voice of the person being offered it, for the page where they decide
 * whether to accept ("You will be able to open and read their documents."). The sharer's own
 * screens use `permissionSentence`; reading "your documents" there is right, here it would read
 * as the recipient's own files.
 */
const RECIPIENT_PHRASES: Readonly<Record<string, string>> = {
  VIEW_METADATA: 'see the details of their documents',
  PREVIEW: 'open and read their documents',
  DOWNLOAD_REDACTED: 'download safe copies',
  COMMENT: 'leave comments',
  PROPOSE_EDIT: 'suggest changes, which they approve first',
};

export function recipientPermissionSentence(action: string): string {
  const phrase = RECIPIENT_PHRASES[action] ?? permissionActionLabel(action).toLowerCase();
  return `You will be able to ${phrase}.`;
}
