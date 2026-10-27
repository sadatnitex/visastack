'use server';

import type { Result } from '@visastack/core';
import {
  CALENDAR_FEED_UNAVAILABLE,
  type CalendarFeedLink,
  type ServiceError,
  accountPrincipal,
  replaceCalendarFeedLink,
  requireAccess,
  turnOffCalendarFeed,
  turnOnCalendarFeed,
} from '@visastack/services';
import type { FormResult } from '../../../../../components/form-feedback';
import { resolveBaseUrl } from '../../../../../lib/base-url';
import { calendarFeedUrls } from '../../../../../lib/calendar-feed';
import { withSession } from '../../../../../lib/session';

/**
 * Turning a traveller's calendar subscription link on, replacing it, or stopping it (v1.2 B05 live
 * feed). The owner only, through the access gate (`MANAGE`, a setting of their own record), whatever
 * the form says. A new link comes back here once, in this answer, and is never
 * stored: only its hash is.
 */

export type CalendarFeedIntent = 'on' | 'new' | 'off';

export interface CalendarFeedFormResult extends FormResult {
  /** The link's state after this answer; absent when nothing changed. */
  readonly feed?: 'on' | 'off' | 'unavailable';
  /** A link just made, shown once. */
  readonly link?: { readonly https: string; readonly webcal: string };
}

const TRY_AGAIN = 'We could not change your calendar link just now. Try again.';

function intentOf(value: FormDataEntryValue | null): CalendarFeedIntent | null {
  return value === 'on' || value === 'new' || value === 'off' ? value : null;
}

function linkAnswer(
  made: Result<CalendarFeedLink, ServiceError>,
  message: string,
): CalendarFeedFormResult {
  if (made.ok) {
    return {
      ok: true,
      message,
      feed: 'on',
      link: calendarFeedUrls(resolveBaseUrl(), made.value.secret),
    };
  }
  if (made.error.message === CALENDAR_FEED_UNAVAILABLE) {
    return { ok: false, message: CALENDAR_FEED_UNAVAILABLE, feed: 'unavailable' };
  }
  if (made.error.code === 'stale') {
    return {
      ok: false,
      message: 'Your calendar link is already on. To get a link you can copy, make a new link.',
      feed: 'on',
    };
  }
  if (made.error.code === 'not_found') {
    return { ok: false, message: 'Your calendar link is off. Turn it on first.', feed: 'off' };
  }
  return { ok: false, message: TRY_AGAIN };
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
    if (intent === 'on') {
      return linkAnswer(
        await turnOnCalendarFeed(access.value),
        'Your calendar link is on. Copy it now: for your safety it is shown only this once.',
      );
    }
    if (intent === 'new') {
      return linkAnswer(
        await replaceCalendarFeedLink(access.value),
        'Your new calendar link is ready and the old one has stopped working. Copy it now: it is shown only this once.',
      );
    }
    const stopped = await turnOffCalendarFeed(access.value);
    if (stopped.ok) {
      return {
        ok: true,
        message:
          'Your calendar link has stopped working. Calendar apps that used it get no more dates.',
        feed: 'off',
      };
    }
    if (stopped.error.message === CALENDAR_FEED_UNAVAILABLE) {
      return { ok: false, message: CALENDAR_FEED_UNAVAILABLE, feed: 'unavailable' };
    }
    return { ok: false, message: TRY_AGAIN };
  });
}
