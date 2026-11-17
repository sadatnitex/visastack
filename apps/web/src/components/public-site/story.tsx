import type { ReactNode } from 'react';
import { publicText } from './public-text';
import './public-site.css';
import './public-scenes.css';

/** The word on every illustrative figure, name, date or country list. */
export const EXAMPLE_WORD = 'Example';

/** Marks a made-up figure as made up. */
export function ExampleTag({ pageLang = 'en' }: { readonly pageLang?: string }) {
  return <span className="pub-example">{publicText(EXAMPLE_WORD, pageLang)}</span>;
}

export interface StoryCardProps {
  readonly title: ReactNode;
  readonly body: ReactNode;
  /** True when the card shows made-up figures: it then carries the Example tag. */
  readonly example?: boolean;
  /** The heading level inside the page outline. Default 3. */
  readonly level?: 2 | 3 | 4;
  /** Lets the card rest raised on a chapter (the depth lives in public-scenes.css). */
  readonly raised?: boolean;
  readonly pageLang?: string;
  readonly children?: ReactNode;
}

/** A flat story card: a title, a line or two, and anything drawn under it. */
export function StoryCard({
  title,
  body,
  example = false,
  level = 3,
  raised = false,
  pageLang = 'en',
  children,
}: StoryCardProps) {
  const Heading = `h${level}` as const;
  return (
    <article className="pub-card" {...(raised ? { 'data-pub-depth': '' } : {})}>
      {example ? <ExampleTag pageLang={pageLang} /> : null}
      <Heading className="pub-card-title">{title}</Heading>
      <p className="pub-card-body">{body}</p>
      {children}
    </article>
  );
}

/**
 * The states a picture may show, each with its own word: Received is not Reviewed, Suggested is
 * not Confirmed, Saved is not Shared. Words come only from here.
 */
export const STATUS_WORDS = Object.freeze({
  received: 'Received',
  reviewed: 'Reviewed',
  suggested: 'Suggested',
  confirmed: 'Confirmed',
  saved: 'Saved',
  shared: 'Shared',
  accessEnded: 'Access Ended',
} as const);

export type PublicStatus = keyof typeof STATUS_WORDS;

const STATUS_CLASS: Readonly<Record<PublicStatus, string>> = {
  received: 'received',
  reviewed: 'reviewed',
  suggested: 'suggested',
  confirmed: 'confirmed',
  saved: 'saved',
  shared: 'shared',
  accessEnded: 'access-ended',
};

export function StatusChip({
  status,
  pageLang = 'en',
}: {
  readonly status: PublicStatus;
  readonly pageLang?: string;
}) {
  return (
    <span className={`pub-chip pub-chip-${STATUS_CLASS[status]}`} data-status={status}>
      {publicText(STATUS_WORDS[status], pageLang)}
    </span>
  );
}

/** Headline words drawn in tints of the brand blue (plain brand colour where that is not possible). */
export function HeadlineWords({ children }: { readonly children: ReactNode }) {
  return (
    <span className="pub-words" data-pub-depth="">
      {children}
    </span>
  );
}
