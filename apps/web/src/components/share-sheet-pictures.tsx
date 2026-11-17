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
 */
import type { DocumentIcon } from '../lib/item-icons';
import { documentPicture } from '../lib/document-picture';
import { ExplainTip } from './explain-tip';
import { Icon } from './icons';
import { DocumentPicture } from './pictures/document-picture';
import type { DocumentScope, ProfileScope } from './selected-scope-summary';

/** The plain word for each kind of paper, in Title Case. */
export const SHARE_KIND_WORD: Readonly<Record<DocumentIcon, string>> = {
  docPassport: 'Passport',
  docId: 'ID Card',
  docPhoto: 'Photo',
  docBank: 'Bank Papers',
  docSalary: 'Salary Papers',
  docTax: 'Tax Papers',
  docLicence: 'Licence',
  docCertificate: 'Certificate',
  docLetter: 'Letter',
  docFlight: 'Flight Booking',
  docHotel: 'Hotel Booking',
  docInsurance: 'Insurance',
  file: 'Document',
};

/** The sentence behind the strip's explain button. */
export const SHARE_EXPLAIN_TEXT =
  'Only what you see here is shared. You can take it back at any time.';

export interface DocumentKindCount {
  readonly kind: DocumentIcon;
  /** A name that stands for the kind, given to the picture so it draws that kind. */
  readonly sample: string;
  readonly count: number;
}

/** Chosen documents grouped by kind, in the order each kind first appears. Names never leave this function. */
export function countDocumentKinds(names: readonly string[]): readonly DocumentKindCount[] {
  const counts = new Map<DocumentIcon, number>();
  for (const name of names) {
    const kind = documentPicture(name, { generic: 'picture' }).mark.icon as DocumentIcon;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  // The picture is drawn from the kind's own word, not from the person's document name.
  return [...counts].map(([kind, count]) => ({ kind, sample: SHARE_KIND_WORD[kind], count }));
}

type Leaving =
  | { readonly key: string; readonly type: 'profile'; readonly word: string }
  | { readonly key: string; readonly type: 'documents'; readonly word: string }
  | {
      readonly key: string;
      readonly type: 'kind';
      readonly word: string;
      readonly sample: string;
      readonly count: number;
    };

/** What the strip draws: what leaves, and what stays private. */
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
    for (const group of countDocumentKinds(documents.names)) {
      leaves.push({
        key: `kind-${group.kind}`,
        type: 'kind',
        word: SHARE_KIND_WORD[group.kind],
        sample: group.sample,
        count: group.count,
      });
    }
  }

  stays.push('Everything Else');
  return { leaves, stays };
}

function LeavingItem({ item }: { readonly item: Leaving }) {
  return (
    <li className="share-pics-item">
      {item.type === 'profile' ? (
        <span className="share-pics-icon" aria-hidden="true">
          <Icon name="user" size={20} />
        </span>
      ) : (
        <DocumentPicture
          type={item.type === 'kind' ? item.sample : null}
          generic="picture"
          size={28}
        />
      )}
      <span className="share-pics-word">{item.word}</span>
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
}: {
  readonly profile: ProfileScope;
  readonly documents: DocumentScope;
}) {
  const { leaves, stays } = sharePictureModel(profile, documents);
  return (
    <div className="share-pics" data-share-pictures="">
      <div className="share-pics-row share-pics-leaves">
        <p className="share-pics-term">
          <span>They Get</span>
          <ExplainTip label="What They Get" text={SHARE_EXPLAIN_TEXT}>
            <Icon name="ask" size={18} />
          </ExplainTip>
        </p>
        <ul className="share-pics-list">
          {leaves.length > 0 ? (
            leaves.map((item) => <LeavingItem key={item.key} item={item} />)
          ) : (
            <li className="share-pics-item share-pics-empty">Nothing Yet</li>
          )}
        </ul>
      </div>
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
    </div>
  );
}
