'use server';

import type { Result } from '@visastack/core';
import {
  type AuthorizedApplicant,
  CALENDAR_FEED_SHARING_NEEDED,
  CALENDAR_FEED_UNAVAILABLE,
  type CalendarFeedLink,
  type ServiceError,
  accountPrincipal,
  getCalendarFeedStatus,
  replaceCalendarFeedLink,
  requireAccess,
  turnOffCalendarFeed,
  turnOnCalendarFeed,
} from '@visastack/services';
import type { FormResult } from '../../../../../components/form-feedback';
import { resolveBaseUrl } from '../../../../../lib/base-url';
import { calendarFeedUrl } from '../../../../../lib/calendar-feed';
import { reportServerError } from '../../../../../lib/server-error';
import { withSession } from '../../../../../lib/session';

/**
 * Turning a traveller's calendar subscription link on, replacing it, or stopping it (v1.2 B05 live
 * feed). The owner only, through the access gate (`MANAGE`, a setting of their own record), whatever
 * the form says. A new link comes back here once, in this answer, and is never stored: only its
 * hash is. A change that fails says how the link stands now, read again from the server, so the
 * page never shows a stale state.
 */

export type CalendarFeedIntent = 'on' | 'new' | 'off';

export interface CalendarFeedFormResult extends FormResult {
  /** The link's state as the server last knew it; absent when it could not be read. */
  readonly feed?: 'on' | 'off' | 'unavailable';
  /** A link just made (https only), shown once. */
  readonly link?: string;
}

const TRY_AGAIN = 'We could not change your calendar link just now. Try again.';

function intentOf(value: FormDataEntryValue | null): CalendarFeedIntent | null {
  return value === 'on' || value === 'new' || value === 'off' ? value : null;
}

/** How the link stands now, for an answer whose change did not happen; absent if unreadable. */
async function currentFeed(
  access: AuthorizedApplicant<'MANAGE'>,
): Promise<Pick<CalendarFeedFormResult, 'feed'>> {
  try {
    const status = await getCalendarFeedStatus(access);
    return status.ok ? { feed: status.value.state } : {};
  } catch (error) {
    reportServerError('calendarFeedAction', error, { step: 'status after failure' });
    return {};
  }
}

async function failure(
  access: AuthorizedApplicant<'MANAGE'>,
  error: ServiceError,
): Promise<CalendarFeedFormResult> {
  if (error.message === CALENDAR_FEED_UNAVAILABLE) {
    return { ok: false, message: CALENDAR_FEED_UNAVAILABLE, feed: 'unavailable' };
  }
  const message =
    error.code === 'consent_required'
      ? CALENDAR_FEED_SHARING_NEEDED
      : error.code === 'stale'
        ? 'Your calendar link is already on. To get a link you can copy, make a new link.'
        : error.code === 'not_found'
          ? 'Your calendar link is off. Turn it on first.'
          : TRY_AGAIN;
  return { ok: false, message, ...(await currentFeed(access)) };
}

async function linkAnswer(
  access: AuthorizedApplicant<'MANAGE'>,
  made: Result<CalendarFeedLink, ServiceError>,
  message: string,
): Promise<CalendarFeedFormResult> {
  if (!made.ok) return failure(access, made.error);
  return {
    ok: true,
    message,
    feed: 'on',
    link: calendarFeedUrl(resolveBaseUrl(), made.value.secret),
  };
}

export async function calendarFeedAction(
  _previous: CalendarFeedFormResult,
  formData: FormData,
): Promise<CalendarFeedFormResult> {
  const intent = intentOf(formData.get('intent'));
  const applicantId = formData.get('applicantId');
  if (!intent || typeof applicantId !== 'string') return { ok: false, message: TRY_AGAIN };

  return withSession(async ({ db, accountId }): Promise<CalendarFeedFormResult> => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId },
      { purpose: 'self' },
    );
    if (!access.ok || access.value.actor.kind !== 'applicant_owner') {
      return { ok: false, message: 'Only the owner of this record can change its calendar link.' };
    }
    const owner = access.value;
    if (intent === 'on') {
      return linkAnswer(
        owner,
        await turnOnCalendarFeed(owner),
        'Your calendar link is on. Copy it now: for your safety it is shown only this once.',
      );
    }
    if (intent === 'new') {
      return linkAnswer(
        owner,
        await replaceCalendarFeedLink(owner),
        'Your new calendar link is ready and the old one has stopped working. Copy it now: it is shown only this once.',
      );
    }
    const stopped = await turnOffCalendarFeed(owner);
    if (!stopped.ok) return failure(owner, stopped.error);
    return {
      ok: true,
      message:
        'Your calendar link has stopped working. Calendar apps that used it get no more dates.',
      feed: 'off',
    };
  });
}
