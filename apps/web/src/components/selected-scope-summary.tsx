/**
 * WP-X2 grant review brief: what a person is about to share, or has shared,
 * in plain rows. Presentational only: it shows exactly the props it is given
 * and decides nothing, so the form and the grant cards (and WP-V5 later)
 * describe a grant the same way. Broad choices (the whole profile, every
 * document, no end date) are shown in warning tone while access is live.
 * Callers must describe what the access rules actually allow (see
 * `describeGrantScope`), never more and never less.
 */
import type { ReactNode } from 'react';

export type ProfileScope =
  | { readonly kind: 'whole' }
  | { readonly kind: 'parts'; readonly labels: readonly string[] }
  | { readonly kind: 'case' }
  | { readonly kind: 'nothing' };

export type DocumentScope =
  | { readonly kind: 'every'; readonly detailsOnly?: boolean }
  /** Documents in the chosen parts; `when` says whether that is now or as at sharing. */
  | { readonly kind: 'inParts'; readonly when: 'now' | 'atSharing'; readonly detailsOnly?: boolean }
  | {
      readonly kind: 'chosen';
      readonly names: readonly string[];
      readonly onlyInParts: boolean;
      readonly detailsOnly?: boolean;
    }
  | { readonly kind: 'nothing' }
  /** No documents row at all (a case grant, or no documents exist). */
  | { readonly kind: 'omit' };

/** Live access reads in the present tense; anything else reads as what it would or did allow. */
export type GrantTense = 'live' | 'notYet' | 'ended';

export interface SelectedScopeSummaryProps {
  /** Who receives access. Omit where the recipient is already shown, as on grant cards. */
  readonly recipient?: string;
  readonly purpose: string | null;
  /** Permissions in plain words, already lower case ("preview documents"). */
  readonly permissions: readonly string[];
  readonly profile: ProfileScope;
  readonly documents: DocumentScope;
  /** The formatted end date, or null when access has no end date. */
  readonly endsOn: string | null;
  /** Extra detail after the end date, such as "in 30 days, the default". */
  readonly endsNote?: string;
  readonly tense?: GrantTense;
}

/** Wording this component writes itself, shown with a capital first letter. Values people typed are left exactly as typed. */
function Phrase({ children }: { readonly children: ReactNode }) {
  return <span className="scope-phrase">{children}</span>;
}

function Row({
  term,
  warning = false,
  children,
}: {
  readonly term: string;
  readonly warning?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={warning ? 'scope-row scope-row-warning' : 'scope-row'}>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function profileText(profile: ProfileScope): ReactNode {
  switch (profile.kind) {
    case 'whole':
      return <Phrase>your whole profile</Phrase>;
    case 'case':
      return <Phrase>one specific case</Phrase>;
    case 'nothing':
      return <Phrase>none of your profile details</Phrase>;
    case 'parts':
      return profile.labels.join(', ');
  }
}

function documentText(documents: Exclude<DocumentScope, { kind: 'omit' }>): ReactNode {
  switch (documents.kind) {
    case 'every':
      return <Phrase>every document</Phrase>;
    case 'inParts':
      return (
        <Phrase>
          {documents.when === 'now'
            ? 'documents in the parts you chose'
            : 'documents in these parts when you shared'}
        </Phrase>
      );
    case 'nothing':
      return <Phrase>none of your documents</Phrase>;
    case 'chosen':
      return (
        <>
          {documents.names.join(', ')}
          {documents.onlyInParts ? (
            <span className="scope-row-note">Only those in the parts you chose can open.</span>
          ) : null}
        </>
      );
  }
}

export function SelectedScopeSummary(props: SelectedScopeSummaryProps) {
  const { profile, documents } = props;
  const tense = props.tense ?? 'live';
  // Warning tone marks broad access that is live or about to be; ended access is shown plainly.
  const warn = tense !== 'ended';
  return (
    <div className="scope-summary">
      <dl>
        {props.recipient !== undefined ? <Row term="Who">{props.recipient}</Row> : null}
        {props.purpose ? <Row term="For">{props.purpose}</Row> : null}
        <Row term={tense === 'live' ? 'They can' : 'They could'}>
          {props.permissions.length > 0 ? (
            props.permissions.join(', ')
          ) : (
            <Phrase>nothing yet</Phrase>
          )}
        </Row>
        <Row
          term={tense === 'live' ? 'Can see' : 'Could see'}
          warning={warn && profile.kind === 'whole'}
        >
          {profileText(profile)}
        </Row>
        {documents.kind === 'omit' ? null : (
          <Row
            term={
              documents.kind !== 'nothing' && documents.detailsOnly
                ? 'Document details'
                : tense === 'live'
                  ? 'Can open'
                  : 'Could open'
            }
            warning={warn && documents.kind === 'every'}
          >
            {documentText(documents)}
            {documents.kind !== 'nothing' && documents.detailsOnly ? (
              <span className="scope-row-note">Details only. They cannot open these.</span>
            ) : null}
          </Row>
        )}
        <Row term={tense === 'ended' ? 'Ended' : 'Ends on'} warning={warn && props.endsOn === null}>
          {props.endsOn === null ? (
            <Phrase>no end date</Phrase>
          ) : (
            <>
              {props.endsOn}
              {props.endsNote ? ` (${props.endsNote})` : null}
            </>
          )}
        </Row>
      </dl>
      {tense === 'ended' ? null : (
        <p className="scope-summary-private">Everything you did not select stays private.</p>
      )}
    </div>
  );
}

/**
 * What a grant actually allows, from its stored or chosen scope, following
 * the access rules: specific documents exclude every profile detail; profile
 * details need "see document details"; opening documents needs "preview
 * documents" or a download permission, and with "see document details" alone
 * the documents show their details but cannot be opened; with both parts and
 * documents chosen, only chosen documents inside those parts open.
 */
export function describeGrantScope(input: {
  readonly actions: readonly string[];
  readonly caseGrant: boolean;
  readonly partLabels: readonly string[];
  readonly documentNames: readonly string[];
  readonly hasDocuments: boolean;
  readonly partsWhen: 'now' | 'atSharing';
}): { readonly profile: ProfileScope; readonly documents: DocumentScope } {
  const canSeeDetails = input.actions.includes('VIEW_METADATA');
  const canOpen = input.actions.includes('PREVIEW') || input.actions.includes('DOWNLOAD_REDACTED');
  const specificDocuments = input.documentNames.length > 0;
  const profile: ProfileScope = input.caseGrant
    ? { kind: 'case' }
    : !canSeeDetails || specificDocuments
      ? { kind: 'nothing' }
      : input.partLabels.length > 0
        ? { kind: 'parts', labels: input.partLabels }
        : { kind: 'whole' };
  // With only "see document details", the documents in scope show their
  // details but cannot be opened; with neither permission nothing shows.
  const detailsOnly = !canOpen;
  const documents: DocumentScope =
    input.caseGrant || !input.hasDocuments
      ? { kind: 'omit' }
      : !canOpen && !canSeeDetails
        ? { kind: 'nothing' }
        : specificDocuments
          ? {
              kind: 'chosen',
              names: input.documentNames,
              onlyInParts: input.partLabels.length > 0,
              detailsOnly,
            }
          : input.partLabels.length > 0
            ? { kind: 'inParts', when: input.partsWhen, detailsOnly }
            : { kind: 'every', detailsOnly };
  return { profile, documents };
}
