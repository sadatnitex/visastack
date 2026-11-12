'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { useT } from '../../../../../components/i18n-provider';
import { applicantSharingCatalog } from '../../../../../i18n/applicant-sharing';
import { type ActionState, expandGrantScopeAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

interface ScopeExpansionCandidate {
  readonly id: string;
  readonly displayName: string;
}

/**
 * The "displayed confirmation" PRD SHR-01 requires before a category
 * grant's scope ever widens: names exactly which new documents now match,
 * defaults every checkbox on, and only the ones still checked at submit
 * time are the ones `expandGrantScopeAction` actually receives.
 */
export function ScopeExpansionForm({
  applicantId,
  grantId,
  candidates,
}: {
  readonly applicantId: string;
  readonly grantId: string;
  readonly candidates: readonly ScopeExpansionCandidate[];
}) {
  const t = useT(applicantSharingCatalog);
  const [state, formAction, pending] = useActionState(expandGrantScopeAction, INITIAL);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(candidates.map((c) => c.id)),
  );

  return (
    <div className="notice lc-scope-expansion">
      <p className="u-m-0">
        {t(
          'applicantSharing.appApplicantIdSharingScopeExpansionForm.lengthNewDocumentsNowMatchThis',
          { length: candidates.length },
        )}
      </p>
      <form action={formAction} className="lc-scope-expansion-form">
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="grantId" value={grantId} />
        <div className="checks">
          {candidates.map((c) => (
            <label className="check" key={c.id}>
              <input
                type="checkbox"
                name="documentId"
                value={c.id}
                checked={selected.has(c.id)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  })
                }
              />
              <span>{c.displayName}</span>
            </label>
          ))}
        </div>
        <div>
          <SubmitButton
            pending={pending}
            unavailable={selected.size === 0}
            idle={`Include ${selected.size} selected document${selected.size === 1 ? '' : 's'}`}
            busy="Including…"
            className="btn btn-secondary u-btn-sm"
          />
        </div>
        <FormMessage result={state} />
      </form>
    </div>
  );
}
