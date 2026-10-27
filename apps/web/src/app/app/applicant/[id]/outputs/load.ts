import { fieldPolicyOf } from '@visastack/core/catalogue';
import {
  OUTPUT_TEMPLATES,
  type OutputFormat,
  type OutputTemplate,
  type OutputView,
  type SelectableCase,
  type SelectedOutput,
  type SelectedOutputOptions,
  accountPrincipal,
  buildSelectedOutput,
  engineRequest,
  listSelectableCases,
  outputFingerprint,
  recordOutputPrepared,
  renderOutputFile,
  renderOutputText,
  renderOutputView,
  requireAccess,
} from '@visastack/services';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { withSession } from '../../../../../lib/session';
import { establishStepUpProof } from '../../../../../lib/step-up';
import { type OutputRequest, requestParams } from './query';

/** A field the sheet can offer: its key (for the choice) and its name (for the person). Never a value. */
export interface FieldCandidate {
  readonly key: string;
  readonly label: string;
}

export interface PreparedOutput {
  readonly template: OutputTemplate;
  readonly cases: readonly SelectableCase[];
  /** The case in use: the one chosen, or the newest current one when none was chosen yet. */
  readonly missionId: string | null;
  /** The output is about a case and there is none to use. */
  readonly needsCase: boolean;
  readonly output: SelectedOutput | null;
  readonly view: OutputView | null;
  /** What a person copies: the plain text, or for the AI context its exact text. */
  readonly text: string | null;
  readonly fingerprint: string | null;
  readonly candidates: readonly FieldCandidate[];
}

export type PrepareResult =
  | { readonly state: 'ready'; readonly prepared: PreparedOutput }
  | { readonly state: 'denied' }
  | { readonly state: 'failed' }
  | { readonly state: 'reauth'; readonly url: string }
  | { readonly state: 'not_configured' };

export function outputsPath(applicantId: string): string {
  return `/app/applicant/${encodeURIComponent(applicantId)}/outputs`;
}

/** The address of the page for a request, so signing in again lands on the same preview. */
function pageAddress(applicantId: string, request: OutputRequest): string {
  return `${outputsPath(applicantId)}?${requestParams(request).toString()}`;
}

async function prepare(
  applicantId: string,
  request: OutputRequest,
  deliver:
    | null
    | ((
        prepared: PreparedOutput,
        ctx: { record: () => Promise<boolean> },
      ) => Promise<DeliverResult>),
): Promise<PrepareResult | DeliverResult> {
  return withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'self' },
    );
    // Anyone but the owner, including someone the record is shared with, sees "not found".
    if (!access.ok || access.value.actor.kind !== 'applicant_owner') {
      return { state: 'denied' as const };
    }
    const proof = access.value;
    const template = OUTPUT_TEMPLATES[request.template];

    // The case list and the field names are for the page's pickers; a download needs neither.
    const forPage = deliver === null;
    const listed = forPage ? await listSelectableCases(proof) : null;
    if (listed && !listed.ok) return { state: 'failed' as const };
    const cases = listed?.ok ? listed.value : [];
    // Before the first preview, a case template starts on the newest current case.
    let missionId = request.choice.missionId;
    if (
      !missionId &&
      !request.previewed &&
      (template.needsCase || request.template === 'ai_context')
    ) {
      missionId = template.needsCase ? (cases.find((c) => c.current)?.id ?? null) : null;
    }
    const choice = { ...request.choice, missionId };

    // Full numbers need a recent identity check, asked for here and nowhere else.
    let stepUp: Awaited<ReturnType<typeof establishStepUpProof>> | null = null;
    const { selection, options } = engineRequest(request.template, choice);
    if (selection.revealIdentifiers) {
      stepUp = await establishStepUpProof(
        { accountId, action: 'EXPORT_PROFILE', resourceId: applicantId },
        pageAddress(applicantId, { ...request, choice }),
      );
      if (stepUp.kind === 'reauth_required')
        return { state: 'reauth' as const, url: stepUp.reauthUrl };
      if (stepUp.kind === 'not_configured') return { state: 'not_configured' as const };
    }
    const encryption = createKeyManagementPort();
    const engineOptions: SelectedOutputOptions = {
      ...options,
      ...(encryption ? { encryption } : {}),
      ...(stepUp?.kind === 'proof' ? { stepUp: stepUp.proof } : {}),
    };

    const needsCase = template.needsCase && missionId === null;
    if (needsCase) {
      return {
        state: 'ready' as const,
        prepared: {
          template,
          cases,
          missionId,
          needsCase: true,
          output: null,
          view: null,
          text: null,
          fingerprint: null,
          candidates: [],
        },
      };
    }

    // The sheet lets the person pick fields; the names on offer come from a first, wider build.
    let candidates: FieldCandidate[] = [];
    if (template.offersFieldPicker && forPage) {
      const { fieldKeys: _picked, ...wideOptions } = engineOptions;
      const wide = await buildSelectedOutput(proof, selection, wideOptions);
      if (!wide.ok) return { state: 'failed' as const };
      candidates = [
        ...wide.value.person.basics,
        ...Object.values(wide.value.profile).flatMap((list) => list ?? []),
      ]
        .map((value) => ({
          key: value.fieldKey,
          label: fieldPolicyOf(value.fieldKey)?.label ?? value.label,
        }))
        .filter((candidate, index, all) => all.findIndex((c) => c.key === candidate.key) === index);
    }

    const built = await buildSelectedOutput(proof, selection, engineOptions);
    if (!built.ok) {
      return built.error.code === 'step_up_required'
        ? { state: 'reauth' as const, url: pageAddress(applicantId, { ...request, choice }) }
        : { state: 'failed' as const };
    }
    const output = built.value;
    let view: OutputView | null = null;
    let text: string;
    try {
      if (request.template === 'ai_context') {
        const file = renderOutputFile('ai_context', output, 'json', { question: choice.question });
        text = file?.body ?? '';
      } else {
        view = renderOutputView(request.template, output);
        text = renderOutputText(view);
      }
    } catch {
      return { state: 'failed' as const };
    }
    const prepared: PreparedOutput = {
      template,
      cases,
      missionId,
      needsCase: false,
      output,
      view,
      text,
      fingerprint: outputFingerprint(request.template, output, choice.question),
      candidates,
    };
    if (!deliver) return { state: 'ready' as const, prepared };
    return deliver(prepared, {
      record: async () => {
        const recorded = await recordOutputPrepared(proof, {
          template: request.template,
          format: request.format,
          output,
        });
        return recorded.ok;
      },
    });
  });
}

/** The page's own read: the preview of what a download would hold right now. */
export async function prepareOutput(
  applicantId: string,
  request: OutputRequest,
): Promise<PrepareResult> {
  return (await prepare(applicantId, request, null)) as PrepareResult;
}

export type DeliverResult =
  | {
      readonly state: 'file';
      readonly body: string;
      readonly contentType: string;
      readonly format: OutputFormat;
      readonly preparedOn: string;
    }
  | { readonly state: 'changed' }
  | { readonly state: 'nothing' }
  | { readonly state: 'denied' }
  | { readonly state: 'failed' }
  | { readonly state: 'reauth'; readonly url: string }
  | { readonly state: 'not_configured' };

/**
 * The download's one read: the output is built again from the record as it is now, and is handed
 * over only if it is the very output the person previewed (same fingerprint). Anything that
 * changed in between, in the record or in what the rules allow, sends the person back to preview
 * again; a different packet is never delivered in silence. One audit entry is written before the
 * file is returned, and when it cannot be written no file is returned.
 */
export async function deliverOutput(
  applicantId: string,
  request: OutputRequest,
): Promise<DeliverResult> {
  const result = await prepare(applicantId, request, async (prepared, ctx) => {
    if (!prepared.output || !prepared.fingerprint) return { state: 'nothing' as const };
    if (request.fingerprint === null || request.fingerprint !== prepared.fingerprint) {
      return { state: 'changed' as const };
    }
    const file = renderOutputFile(request.template, prepared.output, request.format, {
      question: request.choice.question,
    });
    if (!file || file.body.length === 0) return { state: 'nothing' as const };
    if (!(await ctx.record())) return { state: 'failed' as const };
    return {
      state: 'file' as const,
      body: file.body,
      contentType: file.contentType,
      format: request.format,
      preparedOn: prepared.output.preparedOn,
    };
  });
  if (result.state === 'ready') return { state: 'failed' };
  return result;
}
