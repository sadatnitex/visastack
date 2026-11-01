'use client';

import { useActionState, useRef } from 'react';
import { CollapsibleGroup } from '../../../../../../components/collapsible-group';
import {
  FormMessage,
  SubmitButton,
  useFocusInvalidField,
} from '../../../../../../components/form-feedback';
import { StickyActionBar } from '../../../../../../components/sticky-action-bar';
import type { Tone } from '../../../../../../components/ui';
import { CASE_DATE_FIELDS } from '../../../../../../lib/form-dates';
import { usePartTypedDateCheck } from '../../../../../../lib/use-part-typed-date-check';
import type { ActionState } from '../actions';
import type { CaseFormField } from '../case-form-fields';
import { prepareCaseAgainAction } from './actions';

/** One record the person may tick (or only see), already in plain words. */
export interface PrepareAgainRecordView {
  /** `<requirement>|f|<fact>` or `<requirement>|d|<document>`: what the form submits. */
  readonly value: string;
  readonly label: string;
  readonly carriable: boolean;
  readonly preselected: boolean;
}

export interface PrepareAgainItemView {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly optional: boolean;
  readonly records: readonly PrepareAgainRecordView[];
}

export interface PrepareAgainGroupView {
  readonly key: 'REUSABLE' | 'NEEDS_REVIEW' | 'MISSING';
  readonly title: string;
  readonly hint: string;
  readonly tone: Tone;
  readonly items: readonly PrepareAgainItemView[];
}

export interface SharingQuestionView {
  readonly kind: 'grant' | 'invitation';
  readonly id: string;
  readonly recipient: string;
  readonly purpose: string;
  readonly pending: boolean;
}

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * Start a New Case from This One (Programme X U02): the new case's details, the three groups
 * of records with tick boxes for what to carry, and one tick box per person
 * or agency with all-cases access. Nothing is ticked for them by default:
 * leaving someone unticked means they do not see the new case.
 */
export function PrepareAgainForm({
  applicantId,
  fromMissionId,
  defaultTitle,
  expectedPackVersionId,
  checklistNote,
  groups,
  sharingQuestions,
}: {
  readonly applicantId: string;
  readonly fromMissionId: string;
  readonly defaultTitle: string;
  readonly expectedPackVersionId: string;
  readonly checklistNote: string;
  readonly groups: readonly PrepareAgainGroupView[];
  readonly sharingQuestions: readonly SharingQuestionView[];
}) {
  const [state, formAction, pending] = useActionState(prepareCaseAgainAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  // A part-typed date sends nothing, so the page stops the form and says so beside the box.
  const dateCheck = usePartTypedDateCheck(CASE_DATE_FIELDS);
  const errors: Readonly<Partial<Record<CaseFormField, string>>> = {
    ...(state.fieldErrors ?? {}),
    ...dateCheck.errors,
  };
  const values = state.values ?? {};
  // The first group with something in it opens, and so does any group asking for a look (its
  // tone says so), so nothing that needs checking starts out of sight.
  const firstFilled = groups.find((group) => group.items.length > 0)?.key;
  const startsOpen = (group: PrepareAgainGroupView) =>
    group.items.length > 0 && (group.key === firstFilled || group.tone === 'warning');

  /** The attributes and message that tie one box to its own problem, as on Start a Case. */
  const problem = (name: CaseFormField, describedBy?: string) => {
    const error = errors[name];
    const errorId = `prepare-again-${name}-error`;
    const ids = [describedBy ?? null, error ? errorId : null].filter(Boolean).join(' ');
    return {
      control: {
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(ids ? { 'aria-describedby': ids } : {}),
      },
      message: error ? (
        <p id={errorId} className="field-msg field-msg-err case-field-error">
          {error}
        </p>
      ) : null,
    };
  };
  const title = problem('title');
  const start = problem('travelStartDate', 'prepare-again-dates');
  const end = problem('travelEndDate', 'prepare-again-dates');
  const deadline = problem('targetDeadline');

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={dateCheck.onSubmit}
      className="field-list"
      noValidate
    >
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="from" value={fromMissionId} />
      <input type="hidden" name="expectedPackVersionId" value={expectedPackVersionId} />

      {/* Drawn afresh after each refused attempt, so each box shows what was sent. */}
      <section key={state.attempt ?? 0} className="card" aria-labelledby="prepare-again-details">
        <h2 className="card-title" id="prepare-again-details">
          New Case Details
        </h2>
        <div className="field-row">
          <label className="field-label" htmlFor="prepare-again-title">
            What Is This Case For?
          </label>
          <input
            id="prepare-again-title"
            name="title"
            type="text"
            required
            className="input"
            defaultValue={values.title ?? defaultTitle}
            {...title.control}
          />
          {title.message}
        </div>
        <div className="field-row">
          <span className="field-label" id="prepare-again-dates">
            Travel Dates (Optional)
          </span>
          <div className="field-inline">
            <input
              name="travelStartDate"
              type="date"
              className="input"
              aria-label="Travel Start Date"
              defaultValue={values.travelStartDate ?? ''}
              {...start.control}
            />
            <input
              name="travelEndDate"
              type="date"
              className="input"
              aria-label="Travel End Date"
              defaultValue={values.travelEndDate ?? ''}
              {...end.control}
            />
          </div>
          {start.message}
          {end.message}
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="prepare-again-deadline">
            Target Deadline (Optional)
          </label>
          <input
            id="prepare-again-deadline"
            name="targetDeadline"
            type="date"
            className="input"
            defaultValue={values.targetDeadline ?? ''}
            {...deadline.control}
          />
          {deadline.message}
        </div>
        <p className="muted u-m-0">{checklistNote}</p>
      </section>

      {/* The three groups fold away (WP-SB4), so the page starts short; the first group with
          something in it, and any group that needs a look, are open. Every tick box is sent
          whether its group is open or not. */}
      <section className="card" aria-labelledby="prepare-again-records">
        <h2 className="card-title" id="prepare-again-records">
          Records from the Last Case
        </h2>
        <div className="collapsible-groups">
          {groups.map((group) => (
            <CollapsibleGroup
              key={group.key}
              id={`prepare-again-${group.key}`}
              title={group.title}
              count={group.items.length}
              noun={{ one: 'item', other: 'items' }}
              open={startsOpen(group)}
            >
              <>
                <p className="muted">{group.hint}</p>
                {group.items.length === 0 ? (
                  <p className="muted u-m-0">Nothing here.</p>
                ) : (
                  <ul className="rows u-mt-050">
                    {group.items.map((item) => (
                      <li className="row" key={item.id}>
                        <fieldset className="fieldset u-m-0">
                          <legend className="row-key">
                            {item.label}
                            {item.optional ? ' (Optional)' : ''}
                          </legend>
                          <p className="muted u-fs-075 u-m-0">{item.reason}</p>
                          {item.records.length > 0 ? (
                            <div className="checks">
                              {item.records.map((record) =>
                                record.carriable ? (
                                  <label className="check" key={record.value}>
                                    <input
                                      type="checkbox"
                                      name="carry"
                                      value={record.value}
                                      defaultChecked={record.preselected}
                                    />
                                    <span>{record.label}</span>
                                  </label>
                                ) : (
                                  <p className="u-m-0" key={record.value}>
                                    {record.label}
                                  </p>
                                ),
                              )}
                            </div>
                          ) : null}
                        </fieldset>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            </CollapsibleGroup>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="prepare-again-sharing">
        <h2 className="card-title" id="prepare-again-sharing">
          Who Can See This Case
        </h2>
        {sharingQuestions.length === 0 ? (
          <p className="muted u-m-0">
            Nobody has access to all your cases, so this case stays private to you.
          </p>
        ) : (
          <fieldset className="fieldset u-m-0">
            <legend className="muted">
              These people and agencies can see all your cases. Tick anyone who should also see this
              new one. Anyone you leave unticked will not see it.
            </legend>
            <div className="checks">
              {sharingQuestions.map((q) => (
                <label className="check" key={`${q.kind}-${q.id}`}>
                  <input
                    type="checkbox"
                    name={q.kind === 'grant' ? 'allowGrant' : 'allowInvitation'}
                    value={q.id}
                  />
                  <span>
                    {q.recipient}
                    {q.pending ? ' (Not Accepted Yet)' : ''}
                    <span className="muted"> · {q.purpose}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </section>

      <FormMessage result={state} />
      <StickyActionBar label="Create the New Case">
        <SubmitButton
          pending={pending}
          idle="Create Case"
          busy="Creating…"
          className="btn btn-primary"
        />
      </StickyActionBar>
    </form>
  );
}
