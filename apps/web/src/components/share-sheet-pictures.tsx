/**
 * WP-PIC12 share sheet pictures: the grant review brief drawn as pictures, so a person sees at a
 * glance what leaves and what stays private before (and while) an agency has access.
 *
 * Presentation only. It draws exactly the scope `SelectedScopeSummary` is given (itself worked out
 * by `describeGrantScope` from the access rules) and decides nothing: no grant rule, scope or
 * permission is read or changed here. Documents are drawn by KIND only (a passport picture with a
 * count), never by their names, so nothing a person typed, and no other person's name, appears in
 * the strip. Documents the recipient cannot open (no Preview) are drawn as staying private, which
 * is what the access rules do.
 *
 * The kind is read from the name the summary already has; a name that is not a known type name
 * ("scan_0012.pdf") is counted as a plain Document. The strip never guesses beyond that.
 */
import { documentPicture } from '../lib/document-picture';
import type { DocumentIcon } from '../lib/item-icons';
import { ExplainTip } from './explain-tip';
import { Icon } from './icons';
import { DocumentPicture } from './pictures/document-picture';
import type { DocumentScope, GrantTense, ProfileScope } from './selected-scope-summary';

/** The plain word for each kind of paper, in Title Case, and a catalogue key that draws that kind. */
export const SHARE_KINDS: Readonly<
  Record<DocumentIcon, { readonly word: string; readonly key: string }>
> = {
  docPassport: { word: 'Passport', key: 'PASSPORT' },
  docId: { word: 'ID Card', key: 'NID' },
  docPhoto: { word: 'Photo', key: 'PHOTO' },
  docBank: { word: 'Bank Papers', key: 'BANK_STATEMENT' },
  docSalary: { word: 'Salary Papers', key: 'SALARY_SLIP' },
  docTax: { word: 'Tax Papers', key: 'TAX_RETURN' },
  docLicence: { word: 'Licence', key: 'TRADE_LICENSE' },
  docCertificate: { word: 'Certificate', key: 'BIRTH_CERTIFICATE' },
  docLetter: { word: 'Letter', key: 'NOC_EMPLOYER' },
  docFlight: { word: 'Flight Booking', key: 'FLIGHT_TICKET' },
  docHotel: { word: 'Hotel Booking', key: 'HOTEL_BOOKING' },
  docInsurance: { word: 'Insurance', key: 'TRAVEL_INSURANCE' },
  file: { word: 'Document', key: '' },
};

/** The sentence behind the strip's explain button. */
export const SHARE_EXPLAIN_TEXT =
  'Only what you see here is shared. You can take it back at any time.';

/** The name a grant card gives a document that no longer exists; it is not drawn as leaving. */
const MISSING_DOCUMENT_NAME = 'Document details unavailable';

export interface DocumentKindCount {
  readonly kind: DocumentIcon;
  readonly count: number;
}

/** Chosen documents grouped by kind, in the order each kind first appears. Names never leave this function. */
export function countDocumentKinds(names: readonly string[]): readonly DocumentKindCount[] {
  const counts = new Map<DocumentIcon, number>();
  for (const name of names) {
    if (name === MISSING_DOCUMENT_NAME) continue;
    // `documentMark` only ever chooses a document kind, so the icon is a document kind.
    const kind = documentPicture(name, { generic: 'picture' }).mark.icon as DocumentIcon;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, count]) => ({ kind, count }));
}

type Leaving =
  | { readonly key: string; readonly type: 'profile'; readonly word: string }
  | { readonly key: string; readonly type: 'documents'; readonly word: string }
  | { readonly key: string; readonly type: 'kind'; readonly kind: DocumentIcon; readonly count: number }
  | { readonly key: string; readonly type: 'note'; readonly word: string };

/** What the strip draws: what leaves, and what specifically stays private. */
export function sharePictureModel(
  profile: ProfileScope,
  documents: DocumentScope,
): { readonly leaves: readonly Leaving[]; readonly stays: readonly string[] } {
  const leaves: Leaving[] = [];
  const stays: string[] = [];

  if (profile.kind === 'whole') {
    leaves.push({ key: 'profile-whole', type: 'profile', word: 'Whole Profile' });
  } else if (profile.kind === 'parts') {
    profile.labels.forEach((label, index) => {
      leaves.push({ key: `profile-${index}`, type: 'profile', word: label });
    });
  } else if (profile.kind === 'nothing') {
    stays.push('Profile Details');
  }
  // A case grant shows nothing from the case yet, so nothing is drawn as leaving for it.

  if (documents.kind === 'nothing' || (documents.kind !== 'omit' && documents.notVisible)) {
    stays.push('Documents');
  } else if (documents.kind === 'every') {
    leaves.push({ key: 'documents-every', type: 'documents', word: 'Every Document' });
  } else if (documents.kind === 'inParts') {
    leaves.push({
      key: 'documents-in-parts',
      type: 'documents',
      word: 'Documents in Chosen Parts',
    });
  } else if (documents.kind === 'chosen') {
    const groups = countDocumentKinds(documents.names);
    for (const group of groups) {
      leaves.push({ key: `kind-${group.kind}`, type: 'kind', ...group });
    }
    // The access rules open only the chosen documents inside the chosen parts.
    if (documents.onlyInParts && groups.length > 0) {
      leaves.push({ key: 'only-in-parts', type: 'note', word: 'Only Those in Chosen Parts' });
    }
  }

  return { leaves, stays };
}

function LeavingItem({ item }: { readonly item: Leaving }) {
  if (item.type === 'note') {
    return <li className="share-pics-item share-pics-note">{item.word}</li>;
  }
  return (
    <li className="share-pics-item">
      {item.type === 'profile' ? (
        <span className="share-pics-icon" aria-hidden="true">
          <Icon name="user" size={20} />
        </span>
      ) : (
        <DocumentPicture
          type={item.type === 'kind' ? SHARE_KINDS[item.kind].key : null}
          generic="picture"
          size={28}
        />
      )}
      <span className="share-pics-word">
        {item.type === 'kind' ? SHARE_KINDS[item.kind].word : item.word}
      </span>
      {item.type === 'kind' ? (
        <>
          <span className="share-pics-count" aria-hidden="true">
            {`×${item.count}`}
          </span>
          <span className="sr-only">{`, ${item.count} ${item.count === 1 ? 'document' : 'documents'}`}</span>
        </>
      ) : null}
    </li>
  );
}

export function SharePictureStrip({
  profile,
  documents,
  tense = 'live',
}: {
  readonly profile: ProfileScope;
  readonly documents: DocumentScope;
  /** Live access reads "They Get"; paused or not yet accepted access reads "They Could Get". */
  readonly tense?: Exclude<GrantTense, 'ended'>;
}) {
  const { leaves, stays } = sharePictureModel(profile, documents);
  const term = tense === 'live' ? 'They Get' : 'They Could Get';
  return (
    // The rows above already say all of this in words, so a live region around the summary
    // (the grant form) does not read the strip out again on every change.
    <div className="share-pics" data-share-pictures="" aria-live="off">
      <div className="share-pics-row share-pics-leaves">
        <p className="share-pics-term">
          <span>{term}</span>
          <ExplainTip label="What They Get" text={SHARE_EXPLAIN_TEXT}>
            <Icon name="ask" size={18} />
          </ExplainTip>
        </p>
        <ul className="share-pics-list">
          {leaves.length > 0 ? (
            leaves.map((item) => <LeavingItem key={item.key} item={item} />)
          ) : (
            <li className="share-pics-item share-pics-note">Nothing Yet</li>
          )}
        </ul>
      </div>
      {/* Only what specifically stays private; the line below the summary says the rest. */}
      {stays.length > 0 ? (
        <div className="share-pics-row share-pics-private">
          <p className="share-pics-term">
            <span className="share-pics-icon" aria-hidden="true">
              <Icon name="lock" size={18} />
            </span>
            <span>Stays Private</span>
          </p>
          <ul className="share-pics-list">
            {stays.map((word) => (
              <li key={word} className="share-pics-item">
                <span className="share-pics-word">{word}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
