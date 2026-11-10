'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import type { ChoiceGroup } from '../../../../lib/master-profile-types';
import { type ActionState, requestEvidenceAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Chosen from the document list when the document is not one the product names yet. */
const OTHER_DOCUMENT = '__other__';

/** The traveller and the case, already chosen by the screen the form sits on (the case workspace). */
export interface FixedRequestTarget {
  readonly applicantId: string;
  readonly applicantName: string;
  readonly missionId: string;
  readonly caseTitle: string;
}

interface RequestEvidenceFormBaseProps {
  readonly organizationId: string;
  /** Every detail that can be asked for, grouped by part of the profile. Built on the server. */
  readonly fieldGroups: readonly ChoiceGroup[];
  /** Every document type that can be asked for, grouped. Built on the server. */
  readonly documentGroups: readonly ChoiceGroup[];
}

/** Clients: the traveller and the case are chosen from lists. */
interface ChosenTargetProps extends RequestEvidenceFormBaseProps {
  readonly applicants: readonly { readonly applicantId: string; readonly displayName: string }[];
  /** Missions this org can currently reach — lets a mission-scoped-only grant still succeed (Codex review, PR #65). */
  readonly missions?: readonly {
    readonly missionId: string;
    readonly title: string;
    readonly applicantName: string;
  }[];
  readonly fixed?: undefined;
}

/**
 * A case's own workspace: the traveller and the case are known, so they are shown, not asked. They
 * travel as the same two fields; the server checks them exactly as it does when they are chosen
 * from the lists (the organization's grant for that person and that case). The form holds its
 * choices for one case: the screen gives it a `key` of that case, so another case starts clean.
 */
interface FixedTargetProps extends RequestEvidenceFormBaseProps {
  readonly fixed: FixedRequestTarget;
  readonly applicants?: undefined;
  readonly missions?: undefined;
}

type RequestEvidenceFormProps = ChosenTargetProps | FixedTargetProps;

/** One request that went out: who it was for, which case, and the words for what was asked. */
interface SentItem {
  readonly applicantId: string;
  readonly missionId: string;
  readonly travellerName: string;
  readonly item: string;
}

/** The words for a stored key, from the grouped lists the form was given. */
function labelFor(groups: readonly ChoiceGroup[], key: string): string {
  for (const group of groups) {
    const found = group.choices.find((choice) => choice.key === key);
    if (found) return found.label;
  }
  return key;
}

export function RequestEvidenceForm({
  organizationId,
  fieldGroups,
  documentGroups,
  applicants = [],
  missions = [],
  fixed,
}: RequestEvidenceFormProps) {
  const [state, formAction, pending] = useActionState(requestEvidenceAction, INITIAL);
  // Every field is held here. React resets a form after each send (accepted or refused), which
  // would put every list back to its first choice. The traveller, the case and the kind of thing
  // asked for are kept so a second and third item take one choice each; only what was asked for
  // is cleared, and only once the request was accepted, so a refusal never costs a person what
  // they typed. After each answer the fields are drawn again from what is held (`redraw`), which
  // runs after the browser's reset.
  const [chosenApplicantId, setApplicantId] = useState('');
  const [chosenMissionId, setMissionId] = useState('');
  // On a case's workspace the two are the case's own, read from the props every time.
  const applicantId = fixed?.applicantId ?? chosenApplicantId;
  const missionId = fixed?.missionId ?? chosenMissionId;
  const [kind, setKind] = useState<'FIELD' | 'DOCUMENT'>('FIELD');
  const [fieldKey, setFieldKey] = useState('');
  const [documentChoice, setDocumentChoice] = useState('');
  const [otherName, setOtherName] = useState('');
  const [message, setMessage] = useState('');
  const [dueDate, setDueDate] = useState('');
  /** What has gone out from this form, each with the traveller and case it went to. */
  const [sent, setSent] = useState<readonly SentItem[]>([]);
  const [, redraw] = useState(0);
  const lastAsked = useRef<SentItem | null>(null);
  const handled = useRef<ActionState>(INITIAL);
  const itemRef = useRef<HTMLSelectElement>(null);
  const uid = useId();
  const ids = {
    applicant: `${uid}-applicant`,
    mission: `${uid}-case`,
    missionHint: `${uid}-case-hint`,
    kind: `${uid}-kind`,
    key: `${uid}-key`,
    other: `${uid}-other`,
    message: `${uid}-message`,
    due: `${uid}-due`,
  };

  const itemWords =
    kind === 'FIELD'
      ? labelFor(fieldGroups, fieldKey)
      : documentChoice === OTHER_DOCUMENT
        ? otherName.trim()
        : labelFor(documentGroups, documentChoice);

  useEffect(() => {
    // Once per answer: the same answer is never counted twice.
    if (handled.current === state) return;
    handled.current = state;
    redraw((count) => count + 1);
    if (state === INITIAL || !state.ok || state.message === '') return;
    const asked = lastAsked.current;
    if (asked) setSent((before) => [...before, asked]);
    setFieldKey('');
    setDocumentChoice('');
    setOtherName('');
    setMessage('');
    setDueDate('');
    // The next item is one choice away: keyboard focus goes to the list it is chosen from.
    itemRef.current?.focus();
  }, [state]);

  const travellerName = fixed
    ? fixed.applicantName
    : (applicants.find((a) => a.applicantId === applicantId)?.displayName ?? '');
  // Only what went to the traveller and case chosen now is listed: choosing someone else never
  // shows, or counts, a request that went elsewhere, even one that finished after the change.
  const sentHere = sent.filter(
    (entry) => entry.applicantId === applicantId && entry.missionId === missionId,
  );
  const sentName = sentHere[0]?.travellerName ?? '';

  return (
    <form
      action={formAction}
      className="field-list form-narrow"
      onSubmit={() => {
        lastAsked.current = { applicantId, missionId, travellerName, item: itemWords };
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="form-grid">
        {fixed ? (
          <>
            <input type="hidden" name="applicantId" value={fixed.applicantId} />
            <input type="hidden" name="missionId" value={fixed.missionId} />
            <p className="muted u-fs-085">
              For {fixed.applicantName}, {fixed.caseTitle}
            </p>
          </>
        ) : (
          <>
            <div className="field-row">
              <label className="field-label" htmlFor={ids.applicant}>
                Traveller
              </label>
              {applicants.length === 0 ? (
                <p className="muted u-fs-085">
                  No traveller has granted this organization access yet. Nothing to request from.
                </p>
              ) : (
                <select
                  id={ids.applicant}
                  name="applicantId"
                  required
                  className="input"
                  value={applicantId}
                  onChange={(event) => {
                    setApplicantId(event.target.value);
                    // A case belongs to one traveller: the one chosen for the last traveller must
                    // not travel with the next, or the request would be refused for a wrong pair.
                    setMissionId('');
                  }}
                >
                  <option value="" disabled>
                    Choose a traveller…
                  </option>
                  {applicants.map((a) => (
                    <option key={a.applicantId} value={a.applicantId}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {missions.length > 0 ? (
              <div className="field-row">
                <label className="field-label" htmlFor={ids.mission}>
                  Case
                </label>
                <select
                  id={ids.mission}
                  name="missionId"
                  className="input"
                  value={missionId}
                  aria-describedby={ids.missionHint}
                  onChange={(event) => setMissionId(event.target.value)}
                >
                  <option value="">Whole Traveller Record (Default)</option>
                  {missions.map((m) => (
                    <option key={m.missionId} value={m.missionId}>
                      {m.applicantName}: {m.title}
                    </option>
                  ))}
                </select>
                <small className="muted" id={ids.missionHint}>
                  Only if access is limited to one case.
                </small>
              </div>
            ) : null}
          </>
        )}
        <div className="field-row">
          <label className="field-label" htmlFor={ids.kind}>
            What do you need?
          </label>
          <select
            id={ids.kind}
            name="kind"
            className="input"
            value={kind}
            onChange={(event) => setKind(event.target.value === 'DOCUMENT' ? 'DOCUMENT' : 'FIELD')}
          >
            <option value="FIELD">A Detail from the Profile</option>
            <option value="DOCUMENT">A Document</option>
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={ids.key}>
            {kind === 'FIELD' ? 'Which detail?' : 'Which document?'}
          </label>
          {kind === 'FIELD' ? (
            <select
              id={ids.key}
              ref={itemRef}
              name="key"
              required
              className="input"
              value={fieldKey}
              onChange={(event) => setFieldKey(event.target.value)}
              key="field-key"
            >
              <option value="" disabled>
                Choose a detail…
              </option>
              {fieldGroups.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.choices.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <>
              <select
                id={ids.key}
                ref={itemRef}
                required
                className="input"
                value={documentChoice}
                onChange={(event) => setDocumentChoice(event.target.value)}
                key="document-key"
              >
                <option value="" disabled>
                  Choose a document…
                </option>
                {documentGroups.map((group) => (
                  <optgroup key={group.key} label={group.label}>
                    {group.choices.map((document) => (
                      <option key={document.key} value={document.key}>
                        {document.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={OTHER_DOCUMENT}>Something Else (Type Its Name)</option>
              </select>
              {documentChoice === OTHER_DOCUMENT ? (
                <input
                  id={ids.other}
                  name="key"
                  type="text"
                  required
                  className="input"
                  aria-label="Name of the other document"
                  placeholder="For example: Marriage Certificate"
                  value={otherName}
                  onChange={(event) => setOtherName(event.target.value)}
                />
              ) : (
                <input type="hidden" name="key" value={documentChoice} />
              )}
            </>
          )}
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={ids.message}>
            Message (Optional)
          </label>
          <input
            id={ids.message}
            name="message"
            type="text"
            className="input"
            placeholder="For example: needed for the visa form"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={ids.due}>
            Due Date (Optional)
          </label>
          <input
            id={ids.due}
            name="dueDate"
            type="date"
            className="input"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Request Evidence"
          busy="Sending…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
        {/* What has gone out from this form, so a second and third request are not guesswork. */}
        <output className="field-msg field-msg-ok">
          {sentHere.length > 0
            ? `Sent${sentName ? ` to ${sentName}` : ''}: ${sentHere.map((entry) => entry.item).join(', ')}.`
            : ''}
        </output>
      </div>
    </form>
  );
}
