'use server';

import {
  type EvidenceAnswer,
  MAX_ANSWERS_PER_CONFIRMATION,
  accountPrincipal,
  confirmEvidenceAnswers,
  getApplicant,
  requireAccess,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { evidenceAnswerCatalog } from '../../../../../../i18n/evidence-answer';
import { getT } from '../../../../../../lib/i18n-server';
import { triggerNotificationWorker } from '../../../../../../lib/jobs';
import { withSession } from '../../../../../../lib/session';

/**
 * What the review form is told. `savedAt` is set only when the server sent at least one answer,
 * and is that confirmed moment. `sent` counts the answers that are now with the agency (sent just
 * now, or already sent by this same confirmation); `changed` counts the ones that were not sent
 * because the records moved after the page was opened.
 */
export interface AnswerActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly savedAt?: string;
  readonly sent: number;
  readonly changed: number;
}

/** The longest a posted id or key may be: an id is 36 characters, a key 24. Anything longer is not one. */
const MAX_VALUE_LENGTH = 64;

/** `<requestId>|<documentId>|<versionId>`: three plain values, nothing else. */
function parseAnswer(raw: FormDataEntryValue): EvidenceAnswer | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('|').map((part) => part.trim());
  if (parts.length !== 3) return null;
  const [requestId, documentId, documentVersionId] = parts;
  if (!requestId || !documentId || !documentVersionId) return null;
  if ([requestId, documentId, documentVersionId].some((part) => part.length > MAX_VALUE_LENGTH)) {
    return null;
  }
  return { requestId, documentId, documentVersionId };
}

/** At most one answer per request; malformed values are ignored. The caller refuses too many. */
function parseAnswers(values: readonly FormDataEntryValue[]): EvidenceAnswer[] {
  const answers: EvidenceAnswer[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const answer = parseAnswer(raw);
    if (!answer) continue;
    const key = answer.requestId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    answers.push(answer);
  }
  return answers;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim().slice(0, MAX_VALUE_LENGTH) : '';
}

/**
 * The traveller confirms the answers they reviewed, for the one agency the page named. The service
 * works the plan out again and sends an answer only when it still offers exactly that copy for
 * that request, so a page that has gone stale sends nothing and says so.
 */
export async function confirmAnswersAction(
  _previous: AnswerActionState,
  formData: FormData,
): Promise<AnswerActionState> {
  const t = await getT(evidenceAnswerCatalog);
  const refused = (message: string): AnswerActionState => ({
    ok: false,
    message,
    sent: 0,
    changed: 0,
  });
  const applicantId = text(formData, 'applicantId');
  const organizationId = text(formData, 'organizationId');
  const confirmationKey = text(formData, 'confirmationKey');
  if (!applicantId || !organizationId || !confirmationKey) {
    return refused(t('evidenceAnswer.actions.outOfDate'));
  }
  const answers = parseAnswers(formData.getAll('answer'));
  if (answers.length === 0) return refused(t('evidenceAnswer.actions.chooseOne'));
  // Never drop the rest without saying so: one confirmation sends at most this many.
  if (answers.length > MAX_ANSWERS_PER_CONFIRMATION) {
    return refused(t('evidenceAnswer.actions.overLimit', { limit: MAX_ANSWERS_PER_CONFIRMATION }));
  }

  const result = await withSession(async ({ db, accountId }): Promise<AnswerActionState> => {
    const applicant = await getApplicant(db, applicantId);
    if (!applicant || applicant.ownerAccountId !== accountId) {
      return refused(t('evidenceAnswer.actions.outOfDate'));
    }
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId },
      { purpose: 'self' },
    );
    if (!access.ok) return refused(t('evidenceAnswer.actions.outOfDate'));
    const confirmed = await confirmEvidenceAnswers(access.value, {
      organizationId,
      confirmationKey,
      answers,
    });
    if (!confirmed.ok) {
      return refused(
        confirmed.error.code === 'invalid' || confirmed.error.code === 'not_found'
          ? t('evidenceAnswer.actions.outOfDate')
          : t('evidenceAnswer.actions.failed'),
      );
    }
    const { sent, alreadySent, changed, organizationName } = confirmed.value;
    const done = sent + alreadySent;
    const agency = organizationName || t('evidenceAnswer.actions.theAgency');
    if (done === 0) {
      return { ok: false, message: t('evidenceAnswer.actions.noneSent'), sent: 0, changed };
    }
    return {
      ok: true,
      message:
        changed === 0
          ? t('evidenceAnswer.actions.allSent', { count: done, agency })
          : t('evidenceAnswer.actions.someChanged', { sent: done, changed, agency }),
      savedAt: new Date().toISOString(),
      sent: done,
      changed,
    };
  });
  // The page is read again whenever anything was sent or the records turned out to have moved, so
  // the list the person sees next is the current one.
  if (result.ok || result.changed > 0) {
    revalidatePath(`/app/applicant/${applicantId}/evidence`);
    revalidatePath(`/app/applicant/${applicantId}/evidence/answer`);
    // The agency hears about the new answers now, not at the next daily run (a repeat of the same
    // confirmation only asks the worker to look again; it queues nothing twice).
    if (result.ok && result.sent > 0) {
      after(() => triggerNotificationWorker().then(() => undefined));
    }
  }
  return result;
}
