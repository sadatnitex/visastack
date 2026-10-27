/**
 * What the case page found about checklists for a case that has none linked:
 * - `pick`: at least one fits its country and purpose. `travellerUnconfirmed` when one may be
 *   meant only for some nationalities or residences and the traveller's are not confirmed (or
 *   not readable), which is why none was linked on its own.
 * - `none`: none fits.
 * - `unknown`: the check could not be made.
 */
export type WelcomeChecklists =
  | { readonly kind: 'pick'; readonly travellerUnconfirmed: boolean }
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown' };

/**
 * The welcome note's words for a case that has just been created, from what the case holds now:
 * a linked checklist, checklists to pick from, none yet, or not known. Never claims more than that.
 */
export function caseWelcomeCopy(input: {
  readonly packName: string | null;
  readonly checklists: WelcomeChecklists;
  readonly firstGapHref: string | null;
}): {
  readonly title: string;
  readonly body: readonly string[];
  readonly action: { readonly href: string; readonly label: string };
} {
  const title = 'Case Created';
  if (input.packName) {
    return {
      title,
      body: [
        `Checklist linked: ${input.packName}. It lists what this visa route asks for and shows what you already have on file.`,
        'Start with the items marked Missing. Add each document or detail once and it counts for this case.',
      ],
      action: { href: input.firstGapHref ?? '#readiness', label: 'See What to Do First' },
    };
  }
  const { checklists } = input;
  if (checklists.kind === 'pick' && checklists.travellerUnconfirmed) {
    return {
      title,
      body: [
        'A checklist for this route is meant only for some nationalities or countries of residence, and the profile does not confirm them yet, so none was linked.',
        'Confirm the nationality and country of residence on the profile, as country names, and VisaStack can choose the checklist when a case starts. Or pick one now.',
      ],
      action: { href: '#pack', label: 'Pick a Checklist' },
    };
  }
  if (checklists.kind === 'pick') {
    return {
      title,
      body: [
        'First, pick the checklist for this visa route. It lists the papers the route asks for and shows which ones you already have.',
      ],
      action: { href: '#pack', label: 'Pick a Checklist' },
    };
  }
  if (checklists.kind === 'unknown') {
    return {
      title,
      body: [
        'Add documents and details to the case as you go.',
        'The Requirement Pack section further down shows whether a checklist can be linked.',
      ],
      action: { href: '#evidence', label: 'Add Evidence' },
    };
  }
  return {
    title,
    body: [
      'There is no checklist for this route yet, so the case cannot show what is missing on its own.',
      'You can still add documents and details to the case and keep track of what the route asks for yourself.',
    ],
    action: { href: '#evidence', label: 'Add Evidence' },
  };
}
