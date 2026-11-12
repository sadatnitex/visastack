'use client';

import { useActionState, useRef, useState } from 'react';
import {
  FieldError,
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../components/form-feedback';
import { useT } from '../../../components/i18n-provider';
import { collectCatalog } from '../../../i18n/collect';
import { type ResponseActionState, submitResponseAction, withdrawResponseAction } from './actions';
import { type ItemView, choiceFieldName } from './terms';

const INITIAL: ResponseActionState = { ok: true, message: '' };

function initialChoices(items: readonly ItemView[]): Record<string, readonly string[]> {
  const chosen: Record<string, readonly string[]> = {};
  for (const item of items) chosen[item.id] = item.initialKeys;
  return chosen;
}

/**
 * The issued checklist with the person's matching copies proposed (UMPE P7). Each item is approved
 * on its own: a proposed copy starts ticked and can be unticked, any other copy can be ticked
 * instead, and an item with nothing ticked reads Still Missing, right there, before anything is
 * sent. Only what is ticked is shared, and only after the person agrees in words.
 */
export function ResponseForm({
  personId,
  linkId,
  revisionId,
  items,
  consentText,
  consentVersion,
}: {
  readonly personId: string;
  readonly linkId: string;
  readonly revisionId: string;
  readonly items: readonly ItemView[];
  readonly consentText: string;
  readonly consentVersion: string;
}) {
  const t = useT(collectCatalog);
  const [state, formAction, pending] = useActionState(submitResponseAction, INITIAL);
  const [chosen, setChosen] = useState(() => initialChoices(items));
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = 'collect-response-message';
  const toggle = (itemId: string, key: string, on: boolean) =>
    setChosen((current) => {
      const now = new Set(current[itemId] ?? []);
      if (on) now.add(key);
      else now.delete(key);
      return { ...current, [itemId]: [...now] };
    });
  const missing = items.filter((item) => (chosen[item.id] ?? []).length === 0).length;

  return (
    <form
      ref={form}
      action={formAction}
      className="stack"
      // React resets a form after every send, accepted or refused. Here that would put the ticks
      // back to the first proposal while the screen still shows the person's own choices, so a
      // refused send could share something they had unticked. The person's choices always stand.
      onReset={(event) => event.preventDefault()}
    >
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="linkId" value={linkId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="consentVersion" value={consentVersion} />
      <ol className="collect-response-items">
        {items.map((item) => {
          const ticked = new Set(chosen[item.id] ?? []);
          const matches = item.choices.filter((choice) => choice.matches);
          const others = item.choices.filter((choice) => !choice.matches);
          const groupId = `collect-item-${item.id}`;
          return (
            <li key={item.id} className="collect-response-item">
              <input type="hidden" name="itemId" value={item.id} />
              <fieldset className="form-section" aria-describedby={`${groupId}-state`}>
                <legend>
                  <strong>{item.label}</strong>
                </legend>
                <p className="muted u-fs-085">{item.meta}</p>
                {item.note ? (
                  <p className="u-fs-085">
                    {t('collect.collectAccountResponseForm.noteFromTheAgencyNote', {
                      note: item.note,
                    })}
                  </p>
                ) : null}
                {matches.length === 0 && others.length === 0 ? (
                  <p className="muted u-fs-085">
                    {t('collect.collectAccountResponseForm.nothingInThisRecordMatchesYet')}
                  </p>
                ) : null}
                {matches.map((choice) => (
                  <ChoiceRow
                    key={choice.key}
                    itemId={item.id}
                    choice={choice}
                    checked={ticked.has(choice.key)}
                    onChange={toggle}
                  />
                ))}
                {others.length > 0 ? (
                  <details className="collect-response-more">
                    <summary>
                      {matches.length > 0
                        ? t('collect.collectAccountResponseForm.chooseADifferentDocument')
                        : t('collect.collectAccountResponseForm.chooseFromYourDocuments')}
                    </summary>
                    {others.map((choice) => (
                      <ChoiceRow
                        key={choice.key}
                        itemId={item.id}
                        choice={choice}
                        checked={ticked.has(choice.key)}
                        onChange={toggle}
                      />
                    ))}
                  </details>
                ) : null}
                <p id={`${groupId}-state`} className="collect-response-state u-fs-085">
                  {ticked.size === 0 ? (
                    <span className="collect-response-missing">
                      {t('collect.collectAccountResponseForm.stillMissing')}
                    </span>
                  ) : (
                    <span>
                      {ticked.size === 1
                        ? t('collect.collectAccountResponseForm.oneCopyChosen')
                        : t('collect.collectAccountResponseForm.sizeCopiesChosen', {
                            size: ticked.size,
                          })}
                    </span>
                  )}
                </p>
              </fieldset>
            </li>
          );
        })}
      </ol>

      <section className="card" aria-labelledby="collect-response-review">
        <div className="card-body stack">
          <h2 id="collect-response-review">
            {t('collect.collectAccountResponseForm.reviewAndSubmit')}
          </h2>
          <output className="collect-response-summary">
            {missing === 0
              ? t('collect.collectAccountResponseForm.everyItemHasSomethingChosen')
              : missing === 1
                ? t('collect.collectAccountResponseForm.oneItemIsStillMissingYou')
                : t('collect.collectAccountResponseForm.missingItemsAreStillMissingYou', {
                    missing: missing,
                  })}
          </output>
          <div className="field-row">
            <label className="check" htmlFor="collect-response-consent">
              <input
                id="collect-response-consent"
                type="checkbox"
                name="consent"
                {...fieldProblem(state, 'consent', messageId)}
              />
              <span>{consentText}</span>
            </label>
            <FieldError result={state} field="consent" />
          </div>
          <FormMessage id={messageId} result={state} pending={pending} pendingText="Sending…" />
          <div className="action-row">
            <SubmitButton pending={pending} idle="Submit to Agency" busy="Submitting…" />
          </div>
        </div>
      </section>
    </form>
  );
}

function ChoiceRow({
  itemId,
  choice,
  checked,
  onChange,
}: {
  readonly itemId: string;
  readonly choice: ItemView['choices'][number];
  readonly checked: boolean;
  readonly onChange: (itemId: string, key: string, on: boolean) => void;
}) {
  const id = `collect-choice-${itemId}-${choice.key}`.replace(/[^A-Za-z0-9_-]/g, '-');
  return (
    <label className="collect-response-choice check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        name={choiceFieldName(itemId)}
        value={choice.key}
        checked={checked}
        onChange={(event) => onChange(itemId, choice.key, event.target.checked)}
      />
      <span>
        <strong>{choice.title}</strong>{' '}
        <span
          className={`badge badge-${choice.label === 'Current Copy' || choice.label === 'Confirmed Detail' ? 'success' : 'warning'}`}
        >
          {choice.label}
        </span>
        <br />
        <span className="muted u-fs-085">{choice.detail}</span>
      </span>
    </label>
  );
}

/** Withdraw one answer: the agency loses access to everything in it at once. */
export function WithdrawAnswerButton({
  personId,
  responseId,
  agencyName,
}: {
  readonly personId: string;
  readonly responseId: string;
  readonly agencyName: string;
}) {
  const [state, formAction, pending] = useActionState(withdrawResponseAction, INITIAL);
  return (
    <div>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (
            !window.confirm(
              `Withdraw this answer? ${agencyName} can no longer open anything in it.`,
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="responseId" value={responseId} />
        <SubmitButton
          pending={pending}
          idle="Withdraw Answer"
          busy="Withdrawing…"
          className="btn btn-secondary"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}
