import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import { getServerT } from '../../../../lib/i18n-server';
import type { ChoiceGroup } from '../../../../lib/master-profile-types';
import { setDocumentTypeAction } from './actions';

/**
 * What kind of document this file is. The choices come from the catalogue (built on the server and
 * passed in), "Other" types are always kept, and an "Other" type can carry a short name for what the
 * document is. Choosing "Not Set Yet" clears it.
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
  const t = getServerT(appApplicantCatalog);
  const selectId = `type-${documentId}`;
  const nameId = `type-name-${documentId}`;
  return (
    <form action={setDocumentTypeAction} className="field-stack">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="documentId" value={documentId} />
      <label className="field-label" htmlFor={selectId}>
        {t('appApplicant.appApplicantIdDocumentSuggestionCard.kindOfDocument')}
      </label>
      <select id={selectId} name="docType" className="input" defaultValue={docType ?? ''}>
        <option value="">{t('appApplicant.appApplicantIdDocumentTypeForm.notSetYet')}</option>
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
      <label className="field-label" htmlFor={nameId}>
        {t('appApplicant.appApplicantIdDocumentTypeForm.nameForAnOtherType')}
      </label>
      <div className="field-inline">
        <input
          id={nameId}
          name="subject"
          type="text"
          maxLength={120}
          defaultValue={subject ?? ''}
          className="input"
          placeholder={t(
            'appApplicant.appApplicantIdDocumentTypeForm.forExampleMarriageCertificate',
          )}
        />
        <button type="submit" className="btn btn-secondary">
          {t('appApplicant.appApplicantIdDocumentTypeForm.save')}
        </button>
      </div>
    </form>
  );
}
