'use server';

import {
  type SourceCandidateDecision,
  type SourceCheckSummary,
  createSourceFetcher,
  deactivateOfficialSource,
  registerOfficialSource,
  reviewSourceChangeCandidate,
  runSourceCheck,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../lib/admin';
import { withSession } from '../../../../../lib/session';

/**
 * Official Sources (UMPE P10): every action needs pack management rights (`PACK_MANAGE`), checked
 * live for each request (role and, when required, the authenticator code) and handed to the
 * services as a staff scope. None of them can create, approve or publish pack
 * content; Accept For Draft only records the decision.
 */

export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
}

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };

/** The fresh pack management scope for this request, or null without the rights. */
async function packScope(
  db: Parameters<typeof staffPrincipal>[0],
  accountId: string,
  email: string,
) {
  const staff = await staffPrincipal(
    db,
    { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
    'PACK_MANAGE',
  );
  return staff.ok ? staff.value : null;
}
const PATH = '/app/admin/packs/sources';

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

const DECISIONS: readonly SourceCandidateDecision[] = [
  'IN_REVIEW',
  'DISMISSED',
  'ACCEPTED_FOR_DRAFT',
];

function isDecision(value: string): value is SourceCandidateDecision {
  return (DECISIONS as readonly string[]).includes(value);
}

/** Registers one official page for a route. Pack management only. */
export async function registerSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const url = text(formData, 'url');
  const title = text(formData, 'title');
  const publisher = text(formData, 'publisher');
  const jurisdiction = text(formData, 'jurisdiction');
  if (jurisdiction.length === 0) {
    return { ok: false, message: 'Enter the two-letter country code.', field: 'jurisdiction' };
  }
  if (url.length === 0) return { ok: false, message: 'Enter the page address.', field: 'url' };
  if (title.length === 0) return { ok: false, message: 'Enter the page title.', field: 'title' };
  if (publisher.length === 0) {
    return { ok: false, message: 'Enter who publishes the page.', field: 'publisher' };
  }
  const route = text(formData, 'route');
  const purpose = text(formData, 'purpose');
  const packId = text(formData, 'packId');
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const created = await registerOfficialSource(db, staff, {
      jurisdiction,
      url,
      title,
      publisher,
      authorityTier: text(formData, 'authorityTier'),
      ...(route.length > 0 ? { route } : {}),
      ...(purpose.length > 0 ? { purpose } : {}),
      ...(packId.length > 0 ? { packId } : {}),
    });
    if (!created.ok) return { ok: false, message: created.error.message } satisfies ActionState;
    return {
      ok: true,
      message: 'Source registered. It is checked on Saturday, or now with Check Now.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

/** Stops checking a page; its history stays. Pack management only. */
export async function deactivateSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sourceId = text(formData, 'sourceId');
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const stopped = await deactivateOfficialSource(db, staff, { sourceId });
    if (!stopped.ok) return { ok: false, message: stopped.error.message } satisfies ActionState;
    return { ok: true, message: 'Checking stopped. Its history is kept.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

function summaryMessage(summary: SourceCheckSummary): ActionState {
  switch (summary.status) {
    case 'NOT_ALLOWED':
      return DENIED;
    case 'NOT_READY':
      return { ok: false, message: 'Source monitoring can be used once the database is updated.' };
    case 'INVALID_SOURCE':
      return { ok: false, message: 'That source was not found. Refresh the page and try again.' };
    case 'RATE_LIMITED':
      return {
        ok: false,
        message: 'Check Now was used many times this hour. Try again later.',
      };
    case 'IN_PROGRESS':
      return { ok: false, message: 'A check is already running. Try again in a few minutes.' };
    case 'ALREADY_DONE':
    case 'NOT_DUE':
      return { ok: false, message: 'This check just ran. Try again in a minute.' };
    default:
      break;
  }
  // Tried pages out of every active one; pages that could not be read are said separately, so a
  // blocked page is never passed off as a checked one.
  const tried = summary.sourcesDue - summary.deferred;
  const unread = summary.blocked + summary.failed + summary.unsupported;
  const parts = [
    summary.deferred > 0
      ? `Checked ${tried} of ${summary.sourcesDue}, ${summary.deferred} Left for the Next Run.`
      : `Checked ${tried} of ${summary.sourcesDue}.`,
  ];
  if (summary.changed > 0) parts.push(`${summary.changed} changed and waiting for review.`);
  if (unread > 0) parts.push(`${unread} could not be read.`);
  return { ok: true, message: parts.join(' ') };
}

/**
 * Check Now: every active source, or one when `sourceId` is sent (an urgent recheck). Runs under
 * the same safe fetcher and limits as the Saturday check. Pack management only.
 */
export async function checkNowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sourceId = text(formData, 'sourceId');
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const summary = await runSourceCheck(db, staff, {
      fetcher: createSourceFetcher(),
      now: new Date(),
      ...(sourceId.length > 0 ? { sourceId } : {}),
    });
    return summaryMessage(summary);
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

/** Records a decision on a detected change. Creates nothing in any pack. Pack management only. */
export async function reviewCandidateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const candidateId = text(formData, 'candidateId');
  const decision = text(formData, 'decision');
  const note = text(formData, 'note');
  if (!isDecision(decision)) return { ok: false, message: 'Choose a decision.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const decided = await reviewSourceChangeCandidate(db, staff, {
      candidateId,
      decision,
      ...(note.length > 0 ? { note } : {}),
    });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    const message =
      decision === 'ACCEPTED_FOR_DRAFT'
        ? 'Decision recorded. Write the change as a draft version in Pack Studio.'
        : decision === 'DISMISSED'
          ? 'Change dismissed.'
          : 'Marked in review.';
    return { ok: true, message } satisfies ActionState;
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}
