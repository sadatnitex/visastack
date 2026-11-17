/**
 * WP-PIC12 share sheet pictures: the grant review brief drawn as pictures, so a person sees at a
 * glance what leaves and what stays private before (and while) an agency has access.
 *
 * Presentation only. It draws exactly the scope `SelectedScopeSummary` is given (itself worked out
 * by `describeGrantScope` from the access rules) and decides nothing: no grant rule, scope or
 * permission is read or changed here. Documents are drawn as a count, never by their names, so nothing a person typed, and no other person's name, appears in
 * the strip. Documents the recipient cannot open (no Preview) are drawn as staying private, which
 * is what the access rules do.
 *
 * The summary has document names, not stored types, so chosen documents are drawn as one plain
 * Document picture with their count; a kind is never guessed from what a person typed. Every
 * listed document counts, including one whose details failed to load.
 */
import { ExplainTip } from './explain-tip';
import { Icon } from './icons';
import { DocumentPicture } from './pictures/document-picture';
import type { DocumentScope, GrantTense, ProfileScope } from './selected-scope-summary';

/** The sentence behind the strip's explain button, matching the grant pane's revoke wording. */
export const SHARE_EXPLAIN_TEXT =
  'Only what you see here is shared. You can stop sharing at any time; copies already downloaded stay with them.';

type Leaving =
  | { readonly key: string; readonly type: 'profile'; readonly word: string }
  | { readonly key: string; readonly type: 'documents'; readonly word: string }
  | { readonly key: string; readonly type: 'count'; readonly count: number }
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
    // Every listed document counts, whatever its name says: a name never decides what is drawn.
    const count = documents.names.length;
    if (count > 0) {
      leaves.push({ key: 'documents-chosen', type: 'count', count });
      // The access rules open only the chosen documents inside the chosen parts.
      if (documents.onlyInParts) {
        leaves.push({ key: 'only-in-parts', type: 'note', word: 'Only Those in Chosen Parts' });
      }
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
        <DocumentPicture type={null} generic="picture" size={28} />
      )}
      <span className="share-pics-word">{item.type === 'count' ? 'Document' : item.word}</span>
      {item.type === 'count' ? (
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
