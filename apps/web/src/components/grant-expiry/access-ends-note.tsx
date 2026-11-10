import { formatTimestampDate } from '../../lib/format-date';

/**
 * What an agency sees about how long it can open a client's case: the end date and a plain line
 * that only the traveller can extend it. There is no button here, on purpose: an agency can never
 * lengthen its own access. Renders nothing when there is no end date to show.
 */
export function AccessEndsNote({ endsAt }: { readonly endsAt: Date | string | null }) {
  if (endsAt === null) return null;
  return (
    <p className="muted u-fs-085 u-m-0" data-testid="access-ends-note">
      Access ends on {formatTimestampDate(endsAt)}. The traveller can extend it.
    </p>
  );
}
