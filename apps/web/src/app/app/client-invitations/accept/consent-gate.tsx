'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, setConsentAction } from '../../actions';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * A single grant-only consent button. `setConsentAction`'s own
 * `revalidatePath` calls target `/app`, `/app/applicants`, `/app/account`,
 * never this page, so this page's own server-rendered `coreGranted`/
 * `sharingGranted` props would otherwise stay stale after a successful
 * grant. `router.refresh()` re-runs this page's own data fetch once the
 * action confirms success, which is what actually flips `granted` (via a
 * fresh prop from the parent Server Component) and swaps the button to its
 * disabled "Granted" state.
 */
function ConsentToggle({
  type,
  label,
  granted,
}: {
  readonly type: string;
  readonly label: string;
  readonly granted: boolean;
}) {
  const [state, formAction, pending] = useActionState(setConsentAction, INITIAL);
  const router = useRouter();
  const refreshedFor = useRef(false);

  useEffect(() => {
    if (state.ok && state.message.length > 0 && !refreshedFor.current) {
      refreshedFor.current = true;
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="row">
      <span className="row-key">{label}</span>
      {granted ? (
        <span className="badge badge-success">Granted</span>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="granted" value="true" />
          <SubmitButton
            pending={pending}
            idle="Grant"
            busy="Granting…"
            label={`Grant: ${label}`}
            className="btn btn-primary"
            style={{ padding: '0.35rem 1rem', fontSize: '0.85rem' }}
          />
          {/* A failed grant used to say nothing at all. */}
          <FormMessage result={state} />
        </form>
      )}
    </div>
  );
}

export function ConsentGate({
  core,
  sharing,
}: {
  readonly core: boolean;
  readonly sharing: boolean;
}) {
  return (
    <div className="rows u-mb-125">
      <ConsentToggle type="CORE_PROCESSING" label="Core processing" granted={core} />
      <ConsentToggle type="SHARING" label="Sharing" granted={sharing} />
    </div>
  );
}
