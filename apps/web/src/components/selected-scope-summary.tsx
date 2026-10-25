/**
 * WP-X2 grant review brief: what a person is about to share, or has shared,
 * in plain rows. Presentational only: it shows exactly the props it is given
 * and decides nothing, so the form and the grant cards (and WP-V5 later)
 * describe a grant the same way. Broad choices (the whole profile, every
 * document, no end date) are shown in warning tone.
 */
import type { ReactNode } from 'react';

export type ProfileScope =
  | { readonly kind: 'whole' }
  | { readonly kind: 'parts'; readonly labels: readonly string[] }
  | { readonly kind: 'case' };

export type DocumentScope =
  | { readonly kind: 'every' }
  | { readonly kind: 'everyInParts' }
  | { readonly kind: 'chosen'; readonly names: readonly string[] }
  | { readonly kind: 'none' };

export interface SelectedScopeSummaryProps {
  /** Who receives access: an email address or an organisation name. */
  readonly recipient: string;
  readonly purpose: string | null;
  /** Permissions in plain words, already lower case ("preview documents"). */
  readonly permissions: readonly string[];
  readonly profile: ProfileScope;
  readonly documents: DocumentScope;
  /** The formatted end date, or null when access has no end date. */
  readonly endsOn: string | null;
  /** Extra detail after the end date, such as "in 30 days, the default". */
  readonly endsNote?: string;
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

export function SelectedScopeSummary(props: SelectedScopeSummaryProps) {
  const { profile, documents } = props;
  return (
    <div className="scope-summary">
      <dl>
        <Row term="Who">{props.recipient}</Row>
        {props.purpose ? <Row term="For">{props.purpose}</Row> : null}
        <Row term="They can">
          {props.permissions.length > 0 ? props.permissions.join(', ') : 'nothing yet'}
        </Row>
        <Row term="Can see" warning={profile.kind === 'whole'}>
          {profile.kind === 'whole'
            ? 'your whole profile'
            : profile.kind === 'case'
              ? 'one specific case'
              : profile.labels.join(', ')}
        </Row>
        {documents.kind === 'none' ? null : (
          <Row term="Can open" warning={documents.kind === 'every'}>
            {documents.kind === 'every'
              ? 'every document'
              : documents.kind === 'everyInParts'
                ? 'every document in the parts you chose'
                : documents.names.join(', ')}
          </Row>
        )}
        <Row term="Ends on" warning={props.endsOn === null}>
          {props.endsOn === null ? (
            'No end date'
          ) : (
            <>
              {props.endsOn}
              {props.endsNote ? ` (${props.endsNote})` : null}
            </>
          )}
        </Row>
      </dl>
      <p className="scope-summary-private">Everything you did not select stays private.</p>
    </div>
  );
}
