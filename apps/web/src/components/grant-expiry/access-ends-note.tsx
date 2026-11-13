import { componentsMoreCatalog } from '../../i18n/components-more';
import { getT } from '../../lib/i18n-server';
/**
 * What an agency sees about how long it can open a client's case: the end date and a plain line
 * that only the traveller can extend it. There is no button here, on purpose: an agency can never
 * lengthen its own access. The day is the traveller's own calendar day, the same day the reminder
 * names, whatever time zone the server or the reader is in. Renders nothing when there is no end
 * date to show.
 */
export async function AccessEndsNote({
  endsAt,
  timeZone = 'UTC',
}: {
  readonly endsAt: Date | string | null;
  /** The traveller's time zone (the case's `applicantTimezone`). */
  readonly timeZone?: string;
}) {
  if (endsAt === null) return null;
  const t = await getT(componentsMoreCatalog);
  const day = new Date(endsAt).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone,
  });
  return (
    <p className="muted u-fs-085 u-m-0" data-testid="access-ends-note">
      {t.node('componentsMore.grantExpiryAccessEndsNote.accessEndsOnDayTheTraveller', { day })}
    </p>
  );
}
