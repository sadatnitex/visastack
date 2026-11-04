/** The colour roles of the signed-in screens. `info` is the brand blue; `neutral` is grey. */
export type LiftTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** The heading levels a card or panel may use (the page's own title is the only h1). */
export type LiftHeadingLevel = 2 | 3 | 4 | 5;

/** A link that looks like a button: the words, where it goes, and the group it opens, if any. */
export interface LiftAction {
  readonly label: string;
  readonly href: string;
  /** The id of a collapsible group to open when the link is followed (`data-open-group`). */
  readonly openGroup?: string | undefined;
}
