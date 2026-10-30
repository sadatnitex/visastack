import {
  AI_CONNECTION_LAYERS,
  AI_SUGGEST_CHANGES_SCOPE,
  type AiConnectionDuration,
  type AiConnectionLayer,
} from './ai-consent-choices';

/** What each choice on the AI app consent screen is called (ADR 0021 section 5). */
export const AI_LAYER_LABELS: Readonly<Record<AiConnectionLayer, string>> = {
  identity: 'Personal Details',
  travel_documents: 'Passports and Travel Documents',
  timelines: 'Travel, Home and Work History',
  money: 'Money',
  people: 'Family and Sponsors',
  qualifications: 'Education and Qualifications',
  declarations: 'Past Refusals and Declarations',
  health: 'Health',
};

/** One plain sentence under each choice. */
export const AI_LAYER_NOTES: Readonly<Record<AiConnectionLayer, string>> = {
  identity:
    'Name, date of birth, nationality and contact details. Numbers show only their last three characters.',
  travel_documents: 'Passport and visa details and their dates.',
  timelines: 'Past trips, where you lived and where you worked.',
  money: 'Income, savings and who pays for the trip.',
  people: 'Family members, sponsors and the people you visit.',
  qualifications: 'Schools, degrees and certificates.',
  declarations:
    'Sensitive: past visa refusals and legal declarations. Allow only if the app needs them.',
  health: 'Sensitive: health details. Allow only if the app needs them.',
};

export const AI_DURATION_LABELS: Readonly<Record<AiConnectionDuration, string>> = {
  '1h': '1 Hour',
  '24h': '24 Hours',
  '7d': '7 Days',
  '30d': '30 Days',
  until_off: 'Until I Turn It Off',
};

/** The document choices, named the same on the consent screen and on the Sharing page. */
export const AI_DOCUMENT_LIST_LABEL = 'List of My Documents';
export const AI_DOCUMENT_TEXT_LABEL = 'Text Read From My Documents';
export const AI_FULL_NUMBERS_LABEL = 'Full Document Numbers';
/** "Suggest Changes" (S21, ADR 0021 extension), and the ADR's own sentence under it. */
export const AI_SUGGEST_CHANGES_LABEL = 'Suggest Changes';
export const AI_SUGGEST_CHANGES_NOTE =
  'The app can suggest updates, save drafts and add reminders to your cases. Suggested updates change nothing until you accept them.';
/** Added to the "turned off" sentence where a person's earlier choice is kept. */
export const AI_SUGGEST_KEPT_NOTE = 'Your choice is kept for when it is turned on again.';

/** "Original Files" (S20, ADR 0021 extension): the group, its rows and its plain sentences. */
export const AI_ORIGINAL_FILES_LABEL = 'Original Files';
export const AI_SHARE_FILE_LABEL = 'Share This File';
export const AI_SAFE_COPY_LABEL = 'Safe Copy';
export const AI_ORIGINAL_LABEL = 'Original';
export const AI_ORIGINAL_FILES_NOTE =
  'Sensitive: the app receives the whole file of each document you tick. A Safe Copy hides what you covered in black; the Original is the file exactly as you uploaded it. PDF, PNG and JPEG files up to 3 MB.';
export const AI_ORIGINAL_FILES_PROTECTED =
  'Passports, identity, money and health documents are protected and never shared with AI apps.';
export const AI_ORIGINAL_FILES_NEEDS_LIST =
  'Needs List of My Documents, so the app can find each file.';
export const AI_ORIGINAL_NOTE = 'You confirm it is you before an Original is allowed.';
export const AI_SAFE_COPY_NOT_READY =
  'Prepare a Safe Copy on the document’s page. Until then the app gets nothing for this file.';
export const AI_ORIGINAL_FILES_NONE = 'No documents can be shared as files yet.';
/** While AI App Original Files is off: what stays possible. */
export const AI_FILES_KEPT_NOTE = 'Files you ticked stay ticked, and you can untick them.';

/** "2 Files (1 Original)": how many documents a connection was given, for the Sharing page. */
export function aiFilesLine(files: readonly { readonly variant: string }[]): string {
  if (files.length === 0) return 'None';
  const originals = files.filter((file) => file.variant === 'ORIGINAL').length;
  const count = `${files.length} ${files.length === 1 ? 'File' : 'Files'}`;
  if (originals === 0) return `${count} (${files.length === 1 ? 'Safe Copy' : 'Safe Copies'})`;
  if (originals === files.length) return `${count} (${originals === 1 ? 'Original' : 'Originals'})`;
  return `${count} (${originals} ${originals === 1 ? 'Original' : 'Originals'})`;
}

/**
 * What a stored connection lets the app read, in the consent screen's own words and order. The
 * stored strings are layer keys plus `document_list` and `document_text`; anything else is left
 * out rather than guessed at.
 */
export function aiAccessLabels(scopes: readonly string[]): string[] {
  return [
    ...AI_CONNECTION_LAYERS.filter((layer) => scopes.includes(layer)).map(
      (layer) => AI_LAYER_LABELS[layer],
    ),
    ...(scopes.includes('document_list') ? [AI_DOCUMENT_LIST_LABEL] : []),
    ...(scopes.includes('document_text') ? [AI_DOCUMENT_TEXT_LABEL] : []),
  ];
}

/** Whether a stored connection lets the app suggest changes (only the exact stored string). */
export function aiAllowsSuggestions(scopes: readonly string[]): boolean {
  return scopes.includes(AI_SUGGEST_CHANGES_SCOPE);
}

/** The sentence under the consent choices: what the app can and cannot do with these choices. */
export function aiConsentSentence(suggestChanges: boolean): string {
  return suggestChanges
    ? 'This app can read what you choose here. It can also suggest updates, save drafts and add reminders to your cases. Suggested updates change nothing until you accept them. You can turn it off at any time.'
    : 'This app can read what you choose here. It cannot change anything in VisaStack. You can turn it off at any time.';
}

/** The sentence under Change Access, for one app. */
export function aiChangeSentence(appName: string, suggestChanges: boolean): string {
  return suggestChanges
    ? `${appName} can read only what you choose here. It can also suggest updates, save drafts and add reminders to your cases. Suggested updates change nothing until you accept them.`
    : `${appName} can read only what you choose here. It cannot change anything in VisaStack.`;
}
