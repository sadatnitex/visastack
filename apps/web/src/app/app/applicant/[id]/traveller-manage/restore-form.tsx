import { travellerLifecycleAction } from './actions';

/**
 * Restore Traveller as a plain form (works without script): from Archived, or back from Recently
 * Deleted. `returnTo` says where the person lands with the result line.
 */
export function RestoreTravellerForm({
  applicantId,
  name,
  deleted,
  returnTo,
}: {
  readonly applicantId: string;
  readonly name: string;
  readonly deleted: boolean;
  readonly returnTo: 'traveller' | 'list';
}) {
  return (
    <form action={travellerLifecycleAction} className="lc-traveller-form">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="command" value={deleted ? 'restoreDeleted' : 'restore'} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className="btn btn-secondary lc-traveller-button">
        Restore Traveller<span className="sr-only">: {name}</span>
      </button>
    </form>
  );
}
