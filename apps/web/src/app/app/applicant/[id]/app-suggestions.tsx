'use client';

import { useEffect, useRef, useState } from 'react';
import { FormMessage } from '../../../../components/form-feedback';
import { plural } from '../../../../lib/plural';
import type { ActionState } from './actions';
import { AiProposalReview, type AiProposalViewModel } from './ai-review';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * "Suggestions from AI Apps" on My Profile (S21): an AI app's suggestions about the profile itself.
 * After Accept or Skip the card goes, the outcome is kept in the section's polite message, and
 * focus moves to the section heading, where it is read out. After the last decision the section
 * stays and says nothing is waiting.
 */
export function AppSuggestionsSection({
  applicantId,
  proposals,
  canApprove,
}: {
  readonly applicantId: string;
  readonly proposals: readonly AiProposalViewModel[];
  readonly canApprove: boolean;
}) {
  const [lastResult, setLastResult] = useState<ActionState>(INITIAL);
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (lastResult.ok && lastResult.message) heading.current?.focus();
  }, [lastResult]);
  const waiting = proposals.filter((proposal) => !decided.has(proposal.id));
  return (
    <section
      className="card u-mb-150 ai-app-suggestions"
      id="ai-app-suggestions"
      aria-labelledby="ai-app-suggestions-title"
    >
      <p className="card-kicker">AI Apps</p>
      <h2 className="card-title" id="ai-app-suggestions-title" ref={heading} tabIndex={-1}>
        Suggestions from AI Apps
      </h2>
      {waiting.length > 0 ? (
        <p className="card-body">
          {plural(waiting.length, 'change', 'changes')} your AI apps suggested for your profile.
          Nothing is saved until you accept it. Check each one: an app can be wrong.
        </p>
      ) : (
        <p className="card-body muted">Nothing waiting.</p>
      )}
      <FormMessage result={lastResult} />
      {waiting.map((proposal) => (
        <AiProposalReview
          key={proposal.id}
          applicantId={applicantId}
          proposal={proposal}
          canApprove={canApprove}
          headingLevel="h3"
          onResult={(result) => {
            setDecided((previous) => new Set(previous).add(proposal.id));
            setLastResult(result);
          }}
        />
      ))}
    </section>
  );
}
