/**
 * The welcome note's words for a case that has just been created, from what the case holds now:
 * a linked checklist, checklists to pick from, or none yet. Never claims more than that.
 */
export function caseWelcomeCopy(input: {
  readonly packName: string | null;
  readonly checklistsToPick: number;
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
  if (input.checklistsToPick > 0) {
    return {
      title,
      body: [
        'First, pick the checklist for this visa route. It lists the papers the route asks for and shows which ones you already have.',
      ],
      action: { href: '#pack', label: 'Pick a Checklist' },
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
