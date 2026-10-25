import type { ChoiceGroup } from '../../../../lib/master-profile-types';
import { setDocumentTypeAction } from './actions';

/**
 * What kind of document this file is. The choices come from the catalogue (built on the server and
 * passed in), "Other" types are always kept, and an "Other" type can carry a short name for what the
 * document is. Choosing "Not set" clears it.
 */
export function DocumentTypeForm({
  applicantId,
  documentId,
  docType,
  subject,
  groups,
}: {
  readonly applicantId: string;
  readonly documentId: string;
  readonly docType: string | null;
  readonly subject: string | null;
  readonly groups: readonly ChoiceGroup[];
}) {
  const selectId = `type-${documentId}`;
  const nameId = `type-name-${documentId}`;
  return (
    <form action={setDocumentTypeAction} className="document-type-form">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="documentId" value={documentId} />
      <label className="muted u-fs-075" htmlFor={selectId}>
        Kind of Document
      </label>
      <select id={selectId} name="docType" className="input" defaultValue={docType ?? ''}>
        <option value="">Not set</option>
        {groups.map((group) => (
          <optgroup key={group.key} label={group.label}>
            {group.choices.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <label className="muted u-fs-075" htmlFor={nameId}>
        If it is an Other type, what is it?
      </label>
      <input
        id={nameId}
        name="subject"
        type="text"
        maxLength={120}
        defaultValue={subject ?? ''}
        className="input"
        placeholder="For example: Marriage Certificate"
      />
      <button type="submit" className="btn btn-secondary u-btn-xs">
        Save
      </button>
    </form>
  );
}
