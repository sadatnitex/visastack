'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../../components/form-feedback';
import { StatusBadge, type Tone } from '../../../../../../components/ui';
import type { ActionState } from '../actions';
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
 * Prepare Again (Programme X U02): the new case's details, the three groups
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

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="from" value={fromMissionId} />
      <input type="hidden" name="expectedPackVersionId" value={expectedPackVersionId} />

      <section className="card" aria-labelledby="prepare-again-details">
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
            defaultValue={defaultTitle}
          />
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
              aria-describedby="prepare-again-dates"
            />
            <input
              name="travelEndDate"
              type="date"
              className="input"
              aria-label="Travel End Date"
              aria-describedby="prepare-again-dates"
            />
          </div>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="prepare-again-deadline">
            Target Deadline (Optional)
          </label>
          <input id="prepare-again-deadline" name="targetDeadline" type="date" className="input" />
        </div>
        <p className="muted u-m-0">{checklistNote}</p>
      </section>

      {groups.map((group) => (
        <section key={group.key} className="card" aria-labelledby={`prepare-again-${group.key}`}>
          <h2 className="card-title" id={`prepare-again-${group.key}`}>
            {group.title} <StatusBadge tone={group.tone}>{group.items.length}</StatusBadge>
          </h2>
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
        </section>
      ))}

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

      <div>
        <SubmitButton
          pending={pending}
          idle="Create Case"
          busy="Creating…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
