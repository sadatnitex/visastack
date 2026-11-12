'use client';

import { useActionState, useEffect, useId, useMemo, useRef, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
import {
  MAX_ASK_ITEMS,
  type MissingForCase,
  type RequestPicker,
  preticked,
} from '../../../../lib/request-picker-types';
import { type ActionState, requestEvidenceAction } from './actions';
import { EvidencePicker } from './evidence-picker';
import { EvidenceTray, type TrayItem } from './evidence-tray';

const INITIAL: ActionState = { ok: true, message: '' };

/** The traveller and the case, already chosen by the screen the form sits on (the case workspace). */
export interface FixedRequestTarget {
  readonly applicantId: string;
  readonly applicantName: string;
  readonly missionId: string;
  readonly caseTitle: string;
}

interface RequestEvidenceFormBaseProps {
  readonly organizationId: string;
  /** Every document and detail that can be asked for, grouped. Built on the server. */
  readonly picker: RequestPicker;
  /** A case's own checklist gaps (the case workspace only). Absent on Clients. */
  readonly missing?: MissingForCase | null;
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

/** One send that went out: to whom, for which case, and the sentence that says so. */
interface SentLine {
  readonly applicantId: string;
  readonly missionId: string;
  readonly line: string;
}

/** The tray entries for these picker ids, as the case's missing list names them. */
function trayOf(missing: MissingForCase | null, ids: readonly string[]): TrayItem[] {
  const wanted = new Set(ids);
  return (missing?.rows ?? [])
    .filter((row) => wanted.has(row.id))
    .map((row) => ({ id: row.id, label: row.label, hint: row.hint }));
}

/** The plain sentence for a send: "Sent 5 requests to Rahim Uddin." */
function sentSentence(count: number, name: string): string {
  const things = count === 1 ? '1 request' : `${count} requests`;
  return name ? `Sent ${things} to ${name}.` : `Sent ${things}.`;
}

export function RequestEvidenceForm({
  organizationId,
  picker,
  missing = null,
  applicants = [],
  missions = [],
  fixed,
}: RequestEvidenceFormProps) {
  const t = useT(appAgencyCatalog);
  const [state, formAction, pending] = useActionState(requestEvidenceAction, INITIAL);
  // Every field is held here. React resets a form after each send (accepted or refused), which
  // would put every list back to its first choice. The traveller and the case are kept so a second
  // send takes one choice; what was asked for is cleared only once the send was accepted, so a
  // refusal never costs a person what they chose. After each answer the fields are drawn again
  // from what is held (`redraw`), which runs after the browser's reset.
  const [chosenApplicantId, setApplicantId] = useState('');
  const [chosenMissionId, setMissionId] = useState('');
  // On a case's workspace the two are the case's own, read from the props every time.
  const applicantId = fixed?.applicantId ?? chosenApplicantId;
  const missionId = fixed?.missionId ?? chosenMissionId;

  // What will go out, in the order it was chosen. On a case the required, never-provided
  // checklist items start ticked; the agency can remove any of them.
  const [chosen, setChosen] = useState<readonly TrayItem[]>(() =>
    trayOf(missing, preticked(missing)).slice(0, MAX_ASK_ITEMS),
  );
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [problem, setProblem] = useState('');
  const [sent, setSent] = useState<SentLine | null>(null);
  const [, redraw] = useState(0);
  const lastAsked = useRef<{ applicantId: string; missionId: string; line: string } | null>(null);
  const handled = useRef<ActionState>(INITIAL);
  const searchRef = useRef<HTMLInputElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const afterRemove = useRef<number | null>(null);
  const uid = useId();
  const ids = {
    applicant: `${uid}-applicant`,
    mission: `${uid}-case`,
    missionHint: `${uid}-case-hint`,
    message: `${uid}-message`,
    messageHint: `${uid}-message-hint`,
    due: `${uid}-due`,
  };

  const selected = useMemo(() => new Set(chosen.map((item) => item.id)), [chosen]);
  const missingIds = useMemo(() => preticked(missing), [missing]);

  const travellerName = fixed
    ? fixed.applicantName
    : (applicants.find((a) => a.applicantId === applicantId)?.displayName ?? '');

  useEffect(() => {
    // Once per answer: the same answer is never counted twice.
    if (handled.current === state) return;
    handled.current = state;
    redraw((count) => count + 1);
    if (state === INITIAL || !state.ok || state.message === '') return;
    const asked = lastAsked.current;
    if (asked) setSent(asked);
    setChosen([]);
    setQuery('');
    setMessage('');
    setDueDate('');
    setProblem('');
    // The next send is one search away: keyboard focus goes to the search box.
    searchRef.current?.focus();
  }, [state]);

  // After Remove, focus moves to the next Remove button, or the search box when none is left.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per change of the tray
  useEffect(() => {
    const index = afterRemove.current;
    if (index === null) return;
    afterRemove.current = null;
    const buttons = trayRef.current?.querySelectorAll<HTMLButtonElement>('[data-remove]');
    const next = buttons?.[Math.min(index, (buttons?.length ?? 0) - 1)];
    (next ?? searchRef.current)?.focus();
  }, [chosen]);

  const toggle = (id: string, label: string, hint: string) => {
    setProblem('');
    if (selected.has(id)) {
      const rest = chosen.filter((item) => item.id !== id);
      setChosen(rest);
      setAnnouncement(`Removed ${label}. ${rest.length} selected.`);
      return;
    }
    if (chosen.length >= MAX_ASK_ITEMS) {
      setAnnouncement(`${MAX_ASK_ITEMS} is the most in one send. Remove one to add another.`);
      return;
    }
    setChosen([...chosen, { id, label, hint }]);
    setAnnouncement(`Added ${label}. ${chosen.length + 1} selected.`);
  };

  const remove = (id: string, index: number) => {
    const item = chosen.find((entry) => entry.id === id);
    afterRemove.current = index;
    setChosen(chosen.filter((entry) => entry.id !== id));
    setAnnouncement(`Removed ${item?.label ?? 'item'}. ${chosen.length - 1} selected.`);
  };

  const askAllMissing = () => {
    const next = [...chosen];
    for (const item of trayOf(missing, missingIds)) {
      if (next.some((entry) => entry.id === item.id)) continue;
      if (next.length >= MAX_ASK_ITEMS) break;
      next.push(item);
    }
    const added = missingIds.filter((id) => next.some((entry) => entry.id === id)).length;
    setChosen(next);
    setProblem('');
    setAnnouncement(
      added < missingIds.length
        ? `${added} of ${missingIds.length} missing items selected. ${MAX_ASK_ITEMS} is the most in one send.`
        : `${added} missing items selected. ${next.length} selected.`,
    );
  };

  const idle = chosen.length > 1 ? `Request Evidence (${chosen.length})` : 'Request Evidence';
  // Only what went to the traveller and case chosen now is shown: choosing someone else never
  // shows a send that went elsewhere, even one that finished after the change.
  const sentHere = sent && sent.applicantId === applicantId && sent.missionId === missionId;
  const shown: ActionState = problem
    ? { ok: false, message: problem }
    : state.ok && state.message !== '' && sentHere
      ? { ok: true, message: sent.line }
      : state;

  return (
    <form
      action={formAction}
      className="field-list form-narrow ask-form"
      onSubmit={(event) => {
        if (chosen.length === 0) {
          // Nothing chosen: say so where the choosing is, and send nothing.
          event.preventDefault();
          setProblem('Choose at least one item.');
          searchRef.current?.focus();
          return;
        }
        lastAsked.current = {
          applicantId,
          missionId,
          line: sentSentence(chosen.length, travellerName),
        };
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="form-grid">
        {fixed ? (
          <>
            <input type="hidden" name="applicantId" value={fixed.applicantId} />
            <input type="hidden" name="missionId" value={fixed.missionId} />
            <p className="muted u-fs-085">
              {t.node('appAgency.appAgencyOrgidRequestEvidenceForm.forApplicantnameCasetitle', {
                applicantName: fixed.applicantName,
                caseTitle: fixed.caseTitle,
              })}
            </p>
          </>
        ) : (
          <>
            <div className="field-row">
              <label className="field-label" htmlFor={ids.applicant}>
                {t.node('appAgency.appAgencyOrgidRequestEvidenceForm.traveller')}
              </label>
              {applicants.length === 0 ? (
                <p className="muted u-fs-085">
                  {t.node(
                    'appAgency.appAgencyOrgidRequestEvidenceForm.noTravellerHasGrantedThisOrganization',
                  )}
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
                  <option
                    {...t.lang('appAgency.appAgencyOrgidRequestEvidenceForm.chooseATraveller')}
                    value=""
                    disabled
                  >
                    {t('appAgency.appAgencyOrgidRequestEvidenceForm.chooseATraveller')}
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
                  {t.node('appAgency.appAgencyOrgidRequestEvidenceForm.case')}
                </label>
                <select
                  id={ids.mission}
                  name="missionId"
                  className="input"
                  value={missionId}
                  aria-describedby={ids.missionHint}
                  onChange={(event) => setMissionId(event.target.value)}
                >
                  <option
                    {...t.lang(
                      'appAgency.appAgencyOrgidRequestEvidenceForm.wholeTravellerRecordDefault',
                    )}
                    value=""
                  >
                    {t('appAgency.appAgencyOrgidRequestEvidenceForm.wholeTravellerRecordDefault')}
                  </option>
                  {missions.map((m) => (
                    <option key={m.missionId} value={m.missionId}>
                      {m.applicantName}: {m.title}
                    </option>
                  ))}
                </select>
                <small className="muted" id={ids.missionHint}>
                  {t.node('appAgency.appAgencyOrgidRequestEvidenceForm.onlyIfAccessIsLimitedTo')}
                </small>
              </div>
            ) : null}
          </>
        )}

        <EvidencePicker
          picker={picker}
          selected={selected}
          onToggle={toggle}
          query={query}
          onQuery={setQuery}
          searchRef={searchRef}
          missing={missing}
          missingIds={missingIds}
          onAskAllMissing={askAllMissing}
        />

        <div ref={trayRef}>
          <EvidenceTray
            items={chosen}
            onRemove={remove}
            onClear={() => {
              setChosen([]);
              setAnnouncement('Nothing selected.');
              searchRef.current?.focus();
            }}
          />
        </div>
        {/* Each chosen item travels as its own field; the server checks every one. */}
        {chosen.map((item) => (
          <input key={item.id} type="hidden" name="item" value={item.id} />
        ))}

        <div className="field-row">
          <label className="field-label" htmlFor={ids.message}>
            {t.node('appAgency.appAgencyOrgidRequestEvidenceForm.messageOptional')}
          </label>
          <input
            id={ids.message}
            name="message"
            type="text"
            className="input"
            placeholder={t(
              'appAgency.appAgencyOrgidRequestEvidenceForm.forExampleNeededForTheVisa',
            )}
            aria-describedby={ids.messageHint}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <small className="muted" id={ids.messageHint}>
            {t.node('appAgency.appAgencyOrgidRequestEvidenceForm.theMessageAndTheDueDate')}
          </small>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={ids.due}>
            {t.node('appAgency.appAgencyOrgidRequestEvidenceForm.dueDateOptional')}
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
        <SubmitButton pending={pending} idle={idle} busy="Sending…" className="btn btn-primary" />
        <FormMessage result={shown} />
        <output className="sr-only">{announcement}</output>
      </div>
    </form>
  );
}
