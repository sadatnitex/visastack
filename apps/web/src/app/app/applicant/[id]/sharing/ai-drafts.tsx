'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
} from '../../../../../components/form-feedback';
import { plural } from '../../../../../lib/plural';
import { deleteAiDraftAction } from './ai-draft-actions';

/** One draft as the page shows it: plain text, the app already named on the server. */
export interface AiDraftItem {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly caseTitle: string | null;
  /** "Claude (claude.ai)", cleaned on the server. */
  readonly app: string;
  readonly savedOn: string;
}

function AiDraft({
  applicantId,
  draft,
  onDeleted,
}: {
  readonly applicantId: string;
  readonly draft: AiDraftItem;
  readonly onDeleted: (id: string, result: FormResult) => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (previous: FormResult, formData: FormData) => {
      const result = await deleteAiDraftAction(previous, formData);
      // A success removes this draft; the list keeps the message. A refusal stays here.
      if (result.ok) onDeleted(draft.id, result);
      return result;
    },
    NO_RESULT,
  );
  const [copied, setCopied] = useState<FormResult>(NO_RESULT);
  const copy = async () => {
    // Cleared first, so copying again is announced again.
    setCopied(NO_RESULT);
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied({ ok: true, message: 'Copied. You can paste it where you need it.' });
    } catch {
      setCopied({ ok: false, message: 'Choose Show Draft, select the text and copy it.' });
    }
  };
  return (
    <li className="ai-draft">
      <h3 className="ai-draft-title">{draft.title}</h3>
      <p className="muted u-fs-085 u-m-0">
        Saved by {draft.app} on {draft.savedOn}
        {draft.caseTitle ? `, for ${draft.caseTitle}` : ''}.
      </p>
      <details className="ai-draft-text">
        <summary>Show Draft</summary>
        {/* A long draft scrolls in its own box, which keyboard users can reach and scroll. */}
        <p
          className="ai-draft-body"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the scrolling box must be reachable by keyboard.
          tabIndex={0}
          // biome-ignore lint/a11y/useSemanticElements: a named, focusable scroll box for one draft's text.
          role="region"
          aria-label={`Draft text: ${draft.title}`}
        >
          {draft.body}
        </p>
      </details>
      <div className="page-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={copy}
          aria-label={`Copy Draft: ${draft.title}`}
        >
          Copy Draft
        </button>
        <form action={formAction}>
          <input type="hidden" name="applicantId" value={applicantId} />
          <input type="hidden" name="draftId" value={draft.id} />
          <SubmitButton
            pending={pending}
            idle="Delete Draft"
            busy="Deleting…"
            className="btn btn-secondary"
            label={`Delete Draft: ${draft.title}`}
          />
        </form>
      </div>
      <FormMessage result={copied} />
      <FormMessage result={state.ok ? NO_RESULT : state} />
    </li>
  );
}

/**
 * "Drafts from AI Apps" on the Sharing page (S21): drafts the person's own AI apps saved, beside
 * the connections that wrote them. Only the person sees them; nothing is sent or shared, and they
 * can be read, copied and deleted whether or not AI App Suggestions is on.
 */
export function AiDraftsSection({
  applicantId,
  drafts,
  more,
}: {
  readonly applicantId: string;
  readonly drafts: readonly AiDraftItem[];
  readonly more: number;
}) {
  const [lastResult, setLastResult] = useState<FormResult>(NO_RESULT);
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = drafts.filter((draft) => !deleted.has(draft.id));
  // After a draft goes, focus moves to the section, where the confirmation is read out.
  useEffect(() => {
    if (lastResult.ok && lastResult.message) headingRef.current?.focus();
  }, [lastResult]);
  return (
    <article className="card ai-drafts" id="ai-drafts" aria-labelledby="ai-drafts-title">
      <p className="card-kicker">AI Apps</p>
      <h2 className="card-title" id="ai-drafts-title" ref={headingRef} tabIndex={-1}>
        Drafts from AI Apps
      </h2>
      <p className="card-body">
        Drafts your AI apps saved for you, such as letters and notes. They are kept here for you
        only: nothing is sent anywhere, and agencies never see them. Drafts stay until you delete
        them.
      </p>
      <FormMessage result={lastResult} />
      {shown.length > 0 ? (
        <ul className="ai-draft-list">
          {shown.map((draft) => (
            <AiDraft
              key={draft.id}
              applicantId={applicantId}
              draft={draft}
              onDeleted={(id, result) => {
                setDeleted((previous) => new Set(previous).add(id));
                setLastResult(result);
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="card-body muted">No drafts from AI apps.</p>
      )}
      {more > 0 ? (
        <p className="card-body muted">
          And {plural(more, 'more draft', 'more drafts')}, not shown here. Delete ones you no longer
          need to see the rest.
        </p>
      ) : null}
    </article>
  );
}
