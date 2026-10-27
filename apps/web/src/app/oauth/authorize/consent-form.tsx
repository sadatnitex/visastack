'use client';

import { useActionState, useId } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../components/form-feedback';
import {
  AI_CONNECTION_DURATIONS,
  AI_CONNECTION_LAYERS,
  AI_CONNECTION_WARNING_LAYERS,
  CONSENT_DEFAULTS,
  type ConsentInitial,
} from '../../../lib/ai-consent-choices';
import {
  AI_DURATION_LABELS,
  AI_LAYER_LABELS,
  AI_LAYER_NOTES,
} from '../../../lib/ai-consent-labels';
import { answerAiConsentAction } from './actions';

export interface ConsentFormProps {
  /** The checked request, carried so the answer can be checked again on the server. */
  readonly request: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly resource: string;
    readonly state: string | null;
  };
  readonly appName: string;
  readonly record: { readonly id: string; readonly name: string };
  readonly cases: readonly { readonly id: string; readonly title: string }[];
  /** The choices to start from: the safe defaults, or the person's own after a sign-in check. */
  readonly initial?: ConsentInitial;
}

/**
 * What the person lets their own AI app read. Nothing is preselected beyond the safe defaults in
 * ADR 0021 section 5; sensitive parts carry a warning and stay off until chosen.
 */
export function ConsentForm({
  request,
  appName,
  record,
  cases,
  initial = CONSENT_DEFAULTS,
}: ConsentFormProps) {
  const [state, formAction, pending] = useActionState(answerAiConsentAction, NO_RESULT);
  const id = useId();
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="client_id" value={request.clientId} />
      <input type="hidden" name="redirect_uri" value={request.redirectUri} />
      <input type="hidden" name="code_challenge" value={request.codeChallenge} />
      <input type="hidden" name="resource" value={request.resource} />
      {request.state !== null ? <input type="hidden" name="state" value={request.state} /> : null}
      <input type="hidden" name="record" value={record.id} />

      <fieldset className="fieldset">
        <legend className="field-label">What {appName} Can Read</legend>
        <div className="checks">
          {AI_CONNECTION_LAYERS.map((layer) => (
            <label key={layer} className="check output-check" htmlFor={`${id}-ai-layer-${layer}`}>
              <input
                id={`${id}-ai-layer-${layer}`}
                type="checkbox"
                name="layer"
                value={layer}
                defaultChecked={initial.layers.includes(layer)}
              />
              <span className="output-check-text">
                <span>{AI_LAYER_LABELS[layer]}</span>
                <span
                  className={
                    AI_CONNECTION_WARNING_LAYERS.includes(layer)
                      ? 'muted u-fs-075 ai-consent-warning'
                      : 'muted u-fs-075'
                  }
                >
                  {AI_LAYER_NOTES[layer]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="fieldset">
        <legend className="field-label">Cases</legend>
        <div className="checks">
          <label className="check output-check" htmlFor={`${id}-ai-cases-all`}>
            <input
              id={`${id}-ai-cases-all`}
              type="radio"
              name="cases"
              value="all"
              defaultChecked={initial.cases === 'all'}
            />
            <span className="output-check-text">
              <span>All Current Cases</span>
            </span>
          </label>
          {cases.map((item) => (
            <label
              key={item.id}
              className="check output-check"
              htmlFor={`${id}-ai-case-${item.id}`}
            >
              <input
                id={`${id}-ai-case-${item.id}`}
                type="radio"
                name="cases"
                value={item.id}
                defaultChecked={initial.cases === item.id}
              />
              <span className="output-check-text">
                <span>Only {item.title}</span>
              </span>
            </label>
          ))}
          <label className="check output-check" htmlFor={`${id}-ai-cases-none`}>
            <input
              id={`${id}-ai-cases-none`}
              type="radio"
              name="cases"
              value="none"
              defaultChecked={initial.cases === 'none'}
            />
            <span className="output-check-text">
              <span>No Cases</span>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="fieldset">
        <legend className="field-label">Documents</legend>
        <div className="checks">
          <label className="check output-check" htmlFor={`${id}-ai-document-list`}>
            <input
              id={`${id}-ai-document-list`}
              type="checkbox"
              name="document_list"
              defaultChecked={initial.documentList}
            />
            <span className="output-check-text">
              <span>List of My Documents</span>
              <span className="muted u-fs-075">
                Kind, dates and status only. No file is shared.
              </span>
            </span>
          </label>
          <label className="check output-check" htmlFor={`${id}-ai-document-text`}>
            <input
              id={`${id}-ai-document-text`}
              type="checkbox"
              name="document_text"
              defaultChecked={initial.documentText}
            />
            <span className="output-check-text">
              <span>Text Read From My Documents</span>
              <span className="muted u-fs-075 ai-consent-warning">
                Sensitive: the words read from documents in the parts you allow above. Protected
                document types are never included.
              </span>
            </span>
          </label>
          <label className="check output-check" htmlFor={`${id}-ai-reveal`}>
            <input
              id={`${id}-ai-reveal`}
              type="checkbox"
              name="reveal_identifiers"
              defaultChecked={initial.revealIdentifiers}
            />
            <span className="output-check-text">
              <span>Full Document Numbers</span>
              <span className="muted u-fs-075 ai-consent-warning">
                Sensitive: shows whole passport and ID numbers instead of the last three characters.
                You confirm it is you before this is allowed.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-ai-duration`}>
          How Long
        </label>
        <select
          id={`${id}-ai-duration`}
          name="duration"
          className="input"
          defaultValue={initial.duration}
        >
          {AI_CONNECTION_DURATIONS.map((duration) => (
            <option key={duration} value={duration}>
              {AI_DURATION_LABELS[duration]}
            </option>
          ))}
        </select>
      </div>

      <p className="card-body">
        This app can read what you choose here. It cannot change anything in VisaStack. You can turn
        it off at any time.
      </p>
      <FormMessage result={state} pending={pending} pendingText="Connecting…" />
      <div className="page-actions">
        <SubmitButton
          pending={pending}
          name="decision"
          value="allow"
          idle="Allow Access"
          busy="Connecting…"
        />
        <SubmitButton
          pending={pending}
          name="decision"
          value="deny"
          idle="Do Not Allow"
          busy="Do Not Allow"
          className="btn btn-secondary"
        />
      </div>
    </form>
  );
}
