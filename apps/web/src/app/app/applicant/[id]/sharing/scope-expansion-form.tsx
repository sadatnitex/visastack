'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
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
  const [state, formAction, pending] = useActionState(expandGrantScopeAction, INITIAL);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(candidates.map((c) => c.id)),
  );

  return (
    <div
      className="notice"
      style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
    >
      <p style={{ margin: 0 }}>
        {candidates.length} new document{candidates.length === 1 ? '' : 's'} now match{' '}
        {candidates.length === 1 ? 'this grant category' : 'this grant categories'}. They stay
        hidden from the recipient until you confirm including them.
      </p>
      <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
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
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
          />
        </div>
        <FormMessage result={state} />
      </form>
    </div>
  );
}
