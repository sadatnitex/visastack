import { isStarterPackKey } from '@visastack/core';
import type { NoPackReason, PinnedPackNotice } from '@visastack/services';

/**
 * Plain words for requirement packs (checklists), shared by the case page and Pack Studio so one
 * checklist reads the same everywhere (VS-006). Pure: no server code, safe in client files.
 */

/** The badge words of a starter checklist: the agency's reading of country files, never official. */
export const STARTER_BADGE = 'Starter List, Not Official';

/** The badge for a pack: reviewed public, a starter list, an agency's own, or published with no review. */
export function packBadge(pack: {
  readonly authoritative: boolean;
  readonly ownerOrganizationId: string | null | undefined;
  readonly key?: string | null | undefined;
}): { readonly label: string; readonly reviewed: boolean } {
  if (pack.authoritative) return { label: 'Official Requirement Pack', reviewed: true };
  if (!pack.ownerOrganizationId && pack.key != null && isStarterPackKey(pack.key)) {
    return { label: STARTER_BADGE, reviewed: false };
  }
  // A pack with an owning agency is that agency's own checklist. One with no owner and no review
  // is not an agency's, so calling it "Agency Custom Checklist" would be wrong.
  return pack.ownerOrganizationId
    ? { label: 'Agency Custom Checklist', reviewed: false }
    : { label: 'Not Reviewed', reviewed: false };
}

/**
 * What a pack covers, as a line: the country it is for travel to, then its route. The pack's
 * jurisdiction is the destination, never the embassy or visa centre the person applies at.
 */
export function packCoverageLine(pack: {
  readonly jurisdiction: string | null;
  readonly route: string | null;
}): string | null {
  const parts = [
    pack.jurisdiction?.trim() ? `For travel to ${pack.jurisdiction.trim()}` : null,
    pack.route?.trim() || null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const dateWords = (date: Date | string) => DATE_FORMAT.format(new Date(date));

/** A notice about the checklist a case holds, or null. It never says the checklist is removed. */
export function packNoticeLine(notice: PinnedPackNotice | null): string | null {
  if (notice === null) return null;
  switch (notice.kind) {
    case 'REVIEW_OVERDUE':
      return `Due for its regular review since ${dateWords(notice.since)}. It stays on this case.`;
    case 'WITHDRAWN':
      return `${notice.since ? `Withdrawn on ${dateWords(notice.since)}. ` : 'Withdrawn. '}It stays on this case as it was, so check the official guidance yourself.`;
    case 'NOT_REVIEWED':
      return 'Nobody has reviewed this checklist yet. Check it against the official guidance before relying on it.';
    case 'STARTER':
      return 'A starter list from agency files. It is not official. Check it against the official guidance before relying on it.';
  }
}

/**
 * What decides whether a case finds a pack on its own, for Pack Studio. Matching reads only what
 * is recorded, so each line names a gap that makes a pack invisible to cases, never a guess.
 */
export const PACK_MATCHING_HELP =
  "A case finds a pack by the country it travels to, its purpose, and the traveller's nationality and country of residence when the pack lists them. A pack that names an embassy or visa centre or travel dates is matched on those too. A pack marked authoritative is found by any case; an agency's own checklist is offered only to that agency's cases.";

/** Gaps in how a pack is set up that keep cases from finding it. Empty when it can be found. */
export function packMatchingGaps(pack: {
  readonly authoritative: boolean;
  readonly ownerOrganizationId: string | null | undefined;
  readonly jurisdiction: string | null;
  readonly purpose: string | null;
  readonly route: string | null;
}): readonly string[] {
  if (pack.ownerOrganizationId) {
    return ["This is an agency's own checklist. Only cases of that agency can pick it."];
  }
  const gaps: string[] = [];
  if (!pack.authoritative) {
    gaps.push(
      'Not marked authoritative, so cases do not find it and travellers cannot pick it. Nobody has reviewed it as an official pack.',
    );
  }
  if (!pack.jurisdiction?.trim()) {
    gaps.push(
      'No destination country is set, so a case that names where it travels never finds this pack.',
    );
  }
  if (!pack.purpose?.trim()) {
    gaps.push('No purpose is set, so a case that names its purpose never finds this pack.');
  }
  if (pack.route?.trim()) {
    gaps.push(
      'A route is set. Cases do not record a route yet, so this pack is offered to pick and is never linked on its own.',
    );
  }
  return gaps;
}

/** The warning for a published version whose review date has passed, or null. */
export function reviewOverdueLine(
  nextReviewDate: Date | null,
  now: Date = new Date(),
): string | null {
  return nextReviewDate && nextReviewDate.getTime() < now.getTime()
    ? `Review overdue since ${dateWords(nextReviewDate)}. Cases that hold this version keep it.`
    : null;
}

/** Shown in place of "no checklist" when the page could not look checklists up. Promises nothing. */
export const CHECKLISTS_NOT_LOADED = 'Checklists could not be loaded right now.';

const REASON_WORDS: Readonly<Record<Exclude<NoPackReason, 'NO_REVIEWED_CHECKLIST'>, string>> = {
  OTHER_NATIONALITY: 'travellers of other nationalities',
  OTHER_RESIDENCE: 'people living in other countries',
  OTHER_ROUTE: 'a different kind of visa',
  OTHER_APPLICATION_POST: 'a different embassy or visa centre than the one on this case',
  OUTSIDE_TRAVEL_DATES: 'different travel dates than the ones on this case',
};

/**
 * Why a case has no checklist, in two plain sentences at most. It states what was found and never
 * promises a checklist, never links a source, and never says a route is open or closed.
 */
export function noChecklistLines(
  reasons: readonly NoPackReason[] | undefined,
  trip: { readonly destination: string | null; readonly purpose: string | null },
): readonly string[] {
  const where = trip.destination?.trim();
  const why = trip.purpose?.trim();
  const route =
    where && why
      ? `travel to ${where} for ${why.toLowerCase()}`
      : where
        ? `travel to ${where}`
        : 'this route';
  const mismatch = (reasons ?? []).filter(
    (reason): reason is Exclude<NoPackReason, 'NO_REVIEWED_CHECKLIST'> =>
      reason !== 'NO_REVIEWED_CHECKLIST',
  );
  if (mismatch.length > 0) {
    return [
      `A reviewed checklist exists for ${route}, but none of them fits this case. They are written for ${mismatch.map((reason) => REASON_WORDS[reason]).join(' or ')}, so none was linked.`,
      'Check the details on this case, or keep track of what the route asks for yourself.',
    ];
  }
  return [
    `VisaStack has no reviewed checklist for ${route} yet, so the case cannot show what is missing on its own.`,
    'You can still add documents and details to the case and keep track of what the route asks for yourself.',
  ];
}
