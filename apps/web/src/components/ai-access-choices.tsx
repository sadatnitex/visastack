import { AI_FEATURE_OFF_HINT } from '@visastack/core/ai-features';
import { useId } from 'react';
import {
  AI_CONNECTION_LAYERS,
  AI_CONNECTION_WARNING_LAYERS,
  type AiFileChoice,
  type AiFilesView,
  type ConsentInitial,
} from '../lib/ai-consent-choices';
import {
  AI_DOCUMENT_LIST_LABEL,
  AI_DOCUMENT_TEXT_LABEL,
  AI_FULL_NUMBERS_LABEL,
  AI_LAYER_LABELS,
  AI_LAYER_NOTES,
  AI_SUGGEST_CHANGES_LABEL,
  AI_SUGGEST_CHANGES_NOTE,
  AI_SUGGEST_KEPT_NOTE,
} from '../lib/ai-consent-labels';
import { AiFileChoices } from './ai-file-choices';

/**
 * Up to this many cases are listed as they are; a longer list sits in a short box that scrolls
 * inside (WP-SB4), so the screen stays short. A box, not a fold: these are one set of choices, so
 * the chosen one must always be on the page and reachable by keyboard.
 */
export const AI_CASES_INLINE_MAX = 3;

export interface AiAccessChoicesProps {
  readonly appName: string;
  readonly cases: readonly { readonly id: string; readonly title: string }[];
  /** What the fields start with: the safe defaults on consent, the stored choices on a change. */
  readonly initial: Omit<ConsentInitial, 'duration'>;
  readonly durations: readonly { readonly value: string; readonly label: string }[];
  readonly defaultDuration: string;
  /** Points the matching field at the form's error message. */
  readonly invalid?: { readonly field: string; readonly messageId: string };
  /**
   * Whether AI App Suggestions works right now (the platform owner's switch, S21). When it does
   * not, "Suggest Changes" stays on the screen, turned off, with a plain sentence saying so, and a
   * choice already made is kept as it was.
   */
  readonly suggestionsAvailable?: boolean;
  /**
   * `consent`: a new connection. The box always starts unticked, whatever a link asked for, so the
   * person ticks it themselves. `change`: Change Access on an existing connection. A stored choice
   * starts ticked and can always be unticked; while the feature is off it cannot be ticked on.
   */
  readonly suggestMode?: 'consent' | 'change';
  /** Change Access: whether the connection has it stored. Only then may it stay on while off. */
  readonly suggestStored?: boolean;
  /**
   * "Original Files" (S20): the documents that may be ticked and whether the feature works. Absent
   * while it cannot be offered at all (not available yet), which keeps what is stored.
   */
  readonly files?: AiFilesView;
  /** The ticked documents to start from: stored on Change Access, or what was just submitted. */
  readonly filesInitial?: readonly AiFileChoice[];
  /** Change Access: what the connection has stored. */
  readonly filesStored?: readonly AiFileChoice[];
}

/**
 * The choices of what an AI app may read (ADR 0021 section 5), one set of fields for the consent
 * screen and for Change Access on the Sharing page, so both always offer the same choices with
 * the same names. Sensitive parts carry a warning and are never preselected by the defaults.
 */
export function AiAccessChoices({
  appName,
  cases,
  initial,
  durations,
  defaultDuration,
  invalid,
  suggestionsAvailable = false,
  suggestMode = 'consent',
  suggestStored = false,
  files,
  filesInitial = [],
  filesStored = [],
}: AiAccessChoicesProps) {
  // Enabled while the feature works, or on Change Access when already stored (so it can be
  // unticked). Never shown ticked unless the server would keep it ticked.
  const suggestEditable = suggestionsAvailable || (suggestMode === 'change' && suggestStored);
  const suggestStartsTicked = suggestMode === 'change' && initial.suggestChanges && suggestEditable;
  const id = useId();
  const problem = (field: string) =>
    invalid?.field === field
      ? { 'aria-invalid': true as const, 'aria-describedby': invalid.messageId }
      : {};
  // The whole group is described by the message too, so it is read with the group's name.
  const problemGroup = (field: string) =>
    invalid?.field === field ? { 'aria-describedby': invalid.messageId } : {};
  const caseChoices = cases.map((item) => (
    <label key={item.id} className="check output-check" htmlFor={`${id}-ai-case-${item.id}`}>
      <input
        id={`${id}-ai-case-${item.id}`}
        type="radio"
        name="cases"
        value={item.id}
        defaultChecked={initial.cases === item.id}
        {...problem('cases')}
      />
      <span className="output-check-text">
        <span>Only {item.title}</span>
      </span>
    </label>
  ));
  return (
    <>
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

      <fieldset className="fieldset" {...problemGroup('cases')}>
        <legend className="field-label">Cases</legend>
        <div className="checks">
          <label className="check output-check" htmlFor={`${id}-ai-cases-all`}>
            <input
              id={`${id}-ai-cases-all`}
              type="radio"
              name="cases"
              value="all"
              defaultChecked={initial.cases === 'all'}
              {...problem('cases')}
            />
            <span className="output-check-text">
              <span>All Current Cases</span>
            </span>
          </label>
          {cases.length > AI_CASES_INLINE_MAX ? (
            <div className="checks ai-case-scroll">{caseChoices}</div>
          ) : (
            caseChoices
          )}
          <label className="check output-check" htmlFor={`${id}-ai-cases-none`}>
            <input
              id={`${id}-ai-cases-none`}
              type="radio"
              name="cases"
              value="none"
              defaultChecked={initial.cases === 'none'}
              {...problem('cases')}
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
              {...problem('document_list')}
            />
            <span className="output-check-text">
              <span>{AI_DOCUMENT_LIST_LABEL}</span>
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
              <span>{AI_DOCUMENT_TEXT_LABEL}</span>
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
              {...problem('reveal_identifiers')}
            />
            <span className="output-check-text">
              <span>{AI_FULL_NUMBERS_LABEL}</span>
              <span className="muted u-fs-075 ai-consent-warning">
                Sensitive: shows whole passport and ID numbers instead of the last three characters.
                You confirm it is you before this is allowed.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {files ? (
        <AiFileChoices
          candidates={files.candidates}
          initial={filesInitial}
          stored={filesStored}
          available={files.available}
          {...(invalid ? { invalid } : {})}
        />
      ) : null}

      <fieldset className="fieldset">
        <legend className="field-label">Changes</legend>
        <div className="checks">
          <label className="check output-check" htmlFor={`${id}-ai-suggest`}>
            <input
              id={`${id}-ai-suggest`}
              type="checkbox"
              name="suggest_changes"
              defaultChecked={suggestStartsTicked}
              disabled={!suggestEditable}
              {...(suggestionsAvailable ? {} : { 'aria-describedby': `${id}-ai-suggest-off` })}
            />
            <span className="output-check-text">
              <span>{AI_SUGGEST_CHANGES_LABEL}</span>
              <span className="muted u-fs-075">{AI_SUGGEST_CHANGES_NOTE}</span>
            </span>
          </label>
          {suggestionsAvailable ? null : (
            <p className="muted u-fs-075 u-m-0" id={`${id}-ai-suggest-off`}>
              {suggestMode === 'change' && suggestStored
                ? `${AI_FEATURE_OFF_HINT} ${AI_SUGGEST_KEPT_NOTE}`
                : AI_FEATURE_OFF_HINT}
            </p>
          )}
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
          defaultValue={defaultDuration}
          {...problem('duration')}
        >
          {durations.map((duration) => (
            <option key={duration.value} value={duration.value}>
              {duration.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
