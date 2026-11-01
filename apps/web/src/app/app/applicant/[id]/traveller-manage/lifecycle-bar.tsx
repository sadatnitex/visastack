import { TRAVELLER_RECENTLY_DELETED_DAYS, type TravellerManageView } from '@visastack/services';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { removedInDays } from './labels';
import { outcomeMessage } from './messages';
import { RestoreTravellerForm } from './restore-form';
import { TravellerManageMenu } from './traveller-manage-menu';

/**
 * Under the traveller's page heading (LC-E): the result of the last traveller action, an
 * "Archived" or "Recently Deleted" note with Restore Traveller, and the Manage menu. Renders
 * nothing while the lifecycle tables do not exist and no result is waiting.
 */
export function TravellerLifecycleBar({
  applicantId,
  name,
  view,
  outcome,
  now = new Date(),
}: {
  readonly applicantId: string;
  readonly name: string;
  readonly view: TravellerManageView | null;
  readonly outcome: string | readonly string[] | undefined;
  readonly now?: Date;
}) {
  const result = outcomeMessage(outcome);
  const state = view?.lifecycle.state ?? 'CURRENT';
  const showMenu = view?.actions.some((a) => a === 'ARCHIVE' || a === 'REMOVE_EMPTY') === true;
  if (!result && state === 'CURRENT' && !showMenu) return null;
  return (
    <div className="lc-traveller-bar">
      {result ? (
        <output
          id="traveller-outcome"
          tabIndex={-1}
          className={`notice ${result.ok ? 'notice-ok' : 'notice-warn'}`}
        >
          {result.text}
        </output>
      ) : null}
      {view && state === 'ARCHIVED' ? (
        <div className="notice lc-traveller-note">
          <p>
            <strong>Archived</strong>
            {view.lifecycle.archivedAt
              ? ` on ${formatTimestampDate(view.lifecycle.archivedAt)}`
              : ''}
            . Hidden from your everyday lists, and reminders are paused.
          </p>
          <RestoreTravellerForm
            applicantId={applicantId}
            name={name}
            deleted={false}
            returnTo="traveller"
          />
        </div>
      ) : null}
      {view && state === 'RECENTLY_DELETED' ? (
        <div className="notice notice-warn lc-traveller-note">
          <p>
            <strong>Recently Deleted</strong>
            {view.lifecycle.purgeAfter
              ? `. ${removedInDays(view.lifecycle.purgeAfter, now)}: this empty record is removed for good on ${formatTimestampDate(view.lifecycle.purgeAfter)}.`
              : '.'}
          </p>
          <RestoreTravellerForm
            applicantId={applicantId}
            name={name}
            deleted
            returnTo="traveller"
          />
        </div>
      ) : null}
      {showMenu && view ? (
        <TravellerManageMenu
          applicantId={applicantId}
          name={name}
          actions={view.actions}
          days={TRAVELLER_RECENTLY_DELETED_DAYS}
        />
      ) : null}
    </div>
  );
}
