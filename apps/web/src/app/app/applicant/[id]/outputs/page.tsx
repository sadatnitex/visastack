import {
  CATALOGUE_DOCUMENT_GROUPS,
  CATALOGUE_LAYERS,
  type LayerKey,
} from '@visastack/core/catalogue';
import {
  OUTPUT_TEMPLATES,
  OUTPUT_TEMPLATE_IDS,
  type OutputView,
  type SelectedOutput,
  longDay,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CollapsibleGroup } from '../../../../../components/collapsible-group';
import { SelectedScopeSummary } from '../../../../../components/selected-scope-summary';
import { WhatsAppShare } from '../../../../../components/share/whatsapp-share';
import { StickyActionBar } from '../../../../../components/sticky-action-bar';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { applicantOutputsCatalog } from '../../../../../i18n/applicant-outputs';
import { resolveBaseUrl } from '../../../../../lib/base-url';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { plural } from '../../../../../lib/plural';
import { composeShareMessage } from '../../../../../lib/whatsapp-link';
import { CopyTextButton, PrintButton } from './copy-button';
import { outputsPath, prepareOutput } from './load';
import { parseOutputRequest, requestFields } from './query';

export const metadata: Metadata = { title: 'Summaries' };

export const dynamic = 'force-dynamic';

/** Layers that carry the most sensitive things; offered, but said plainly. */
const CAREFUL_LAYERS: ReadonlySet<LayerKey> = new Set(['declarations', 'health', 'money']);

const DEPTH_CHOICES = [
  [
    'brief',
    'Short',
    "Only what the case's checklist asks for, with the sources left out. A case with no checklist shows just the basics.",
  ],
  ['standard', 'Standard', 'Everything in the parts you chose, with where each detail came from.'],
  [
    'full',
    'Everything',
    'As Standard, plus suggestions that are not confirmed yet, labelled as such.',
  ],
] as const;

type OutputsQuery = Record<string, string | string[] | undefined>;

/** The three steps of the page (WP-SB4): pick a summary, choose what goes in, check and share. */
type OutputStep = 1 | 2 | 3;
const STEPS: readonly (readonly [OutputStep, string])[] = [
  [1, 'Choose a Summary'],
  [2, 'Choose What to Include'],
  [3, 'Check and Copy'],
];

/**
 * Where the person is: no summary picked yet, choices not yet turned into a preview, or a preview
 * showing. Step 3 needs a preview that exists, not only one that was asked for (a summary that
 * needs a case shows none until a case is chosen, so its choices stay open).
 */
function currentStep(query: OutputsQuery, previewed: boolean, hasPreview: boolean): OutputStep {
  if (previewed && hasPreview) return 3;
  const { output } = query;
  return output === undefined ? 1 : 2;
}

/**
 * Where the person is in the three steps, in words. Not links: each step opens from its own
 * heading below, so a link here could never land on a folded part.
 */
function StepList({ step }: { readonly step: OutputStep }) {
  const t = getServerT(applicantOutputsCatalog);
  return (
    <ol
      className="output-steps u-mb-150 output-noprint"
      aria-label={t('applicantOutputs.appApplicantIdOutputsPage.steps')}
    >
      {STEPS.map(([number, label]) => (
        <li
          key={number}
          className="output-step"
          aria-current={number === step ? 'step' : undefined}
        >
          <span className="output-step-number" aria-hidden="true">
            {number}
          </span>
          <span>
            <span className="sr-only">
              {t.node('applicantOutputs.appApplicantIdOutputsPage.stepNumberOf3', { number })}{' '}
            </span>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ViewSections({ view }: { readonly view: OutputView }) {
  const t = getServerT(applicantOutputsCatalog);
  return (
    <>
      {view.intro.map((paragraph) => (
        <p key={paragraph} className="card-body">
          {paragraph}
        </p>
      ))}
      {view.sections.map((section) => (
        <section key={section.heading} className="output-section">
          <h4 className="output-section-title">{section.heading}</h4>
          {section.rows.length === 0 ? (
            <p className="muted u-m-0">
              {section.emptyNote ??
                t.node('applicantOutputs.appApplicantIdOutputsPage.nothingToShow')}
            </p>
          ) : (
            <dl className="output-rows">
              {section.rows.map((row, index) => (
                <div key={`${row.label}-${index}`} className="output-row">
                  <dt>{row.label}</dt>
                  <dd>
                    {row.value}
                    {row.note ? <span className="output-row-note">{row.note}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
      {view.unknowns.length > 0 ? (
        <section className="output-section">
          <h4 className="output-section-title">
            {t.node('applicantOutputs.appApplicantIdOutputsPage.stillUnknownOrNeedsALook')}
          </h4>
          <ul className="output-unknowns">
            {view.unknowns.map((line, index) => (
              // Two lines can read the same, so the key carries the position as well.
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {view.footer.map((note) => (
        <p key={note} className="muted output-footer-note">
          {note}
        </p>
      ))}
    </>
  );
}

function aiSummary(output: SelectedOutput): string[] {
  const values =
    output.person.basics.length +
    Object.values(output.profile).reduce((total, list) => total + (list?.length ?? 0), 0);
  const lines = [`${plural(values, 'detail')} from your record`];
  if (output.cases.length > 0) lines.push(plural(output.cases.length, 'case'));
  if (output.documents.length > 0) {
    lines.push(
      `A list of ${plural(output.documents.length, 'document')} (kind, dates and status only)`,
    );
  }
  if (output.documentText.length > 0) {
    lines.push(`Text read from ${plural(output.documentText.length, 'document')}`);
  }
  return lines;
}

/**
 * Briefs and summaries (v1.2 B10, B11, B12, E04): five outputs built from the same server-side
 * projection. The person chooses what goes in, sees exactly what it holds, and only then copies,
 * prints or downloads it. Everything shown here is built on the server from what the person
 * chose; nothing is filtered in the browser. Owner only, through the access gate.
 */
export default async function OutputsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<OutputsQuery>;
}) {
  await primeLocale();
  const t = getServerT(applicantOutputsCatalog);
  const { id } = await params;
  const query = await searchParams;
  const request = parseOutputRequest(query);
  const template = OUTPUT_TEMPLATES[request.template];
  const prepared = await prepareOutput(id, request);
  if (prepared.state === 'denied') notFound();
  if (prepared.state === 'reauth') redirect(prepared.url);

  const pageHref = outputsPath(id);
  const header = (
    <PageHeader
      as="h2"
      title={t('applicantOutputs.appApplicantIdOutputsPage.summaries')}
      description={t('applicantOutputs.appApplicantIdOutputsPage.chooseWhatGoesInCheckThe')}
      back={{ href: `/app/applicant/${id}/record`, label: 'Records' }}
    />
  );

  if (prepared.state === 'not_configured') {
    return (
      <>
        {header}
        <p role="alert" className="notice notice-warn">
          {t.node('applicantOutputs.appApplicantIdOutputsPage.showingFullNumbersNeedsAnExtra')}
        </p>
      </>
    );
  }
  if (prepared.state === 'failed') {
    return (
      <>
        {header}
        <p role="alert" className="notice notice-warn">
          {t.node('applicantOutputs.appApplicantIdOutputsPage.weCouldNotPrepareThisSummary')}
        </p>
      </>
    );
  }

  const ready = prepared.prepared;
  const { output, view, text } = ready;
  const choice = request.choice;
  const layerLabels = CATALOGUE_LAYERS.filter((layer) =>
    output?.selection.layers.includes(layer.key),
  ).map((layer) => layer.label);
  const chosenCase = ready.cases.find((item) => item.id === ready.missionId) ?? null;
  const whatsapp = template.whatsapp
    ? composeShareMessage(
        { template: 'summary-link', link: `${resolveBaseUrl()}/app/shared` },
        { allowedOrigins: [resolveBaseUrl()] },
      )
    : null;
  const carriedFields = requestFields({
    ...request,
    choice: { ...choice, missionId: ready.missionId },
  });
  const showCasePicker = template.needsCase || request.template === 'ai_context';
  const step = currentStep(query, request.previewed, Boolean(output && text));

  return (
    <>
      {header}
      <div className="notice u-mb-150 output-noprint">
        <p className="u-m-0">
          {t.node('applicantOutputs.appApplicantIdOutputsPage.aSummaryIsAOneTime')}
        </p>
      </div>

      {request.error === 'changed' ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          {t.node('applicantOutputs.appApplicantIdOutputsPage.yourRecordOrYourChoicesChanged')}
        </p>
      ) : null}
      {request.error === 'failed' ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          {t.node('applicantOutputs.appApplicantIdOutputsPage.weCouldNotMakeTheFile')}
        </p>
      ) : null}
      {request.error === 'nothing' ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          {t.node('applicantOutputs.appApplicantIdOutputsPage.thereIsNothingToDownloadFor')}
        </p>
      ) : null}

      <StepList step={step} />

      {/* Step 1. Open until a summary is picked; afterwards one line says which, and opens again. */}
      <div className="u-mb-150 output-noprint">
        <CollapsibleGroup
          id="output-step-choose"
          title={
            step === 1
              ? t('applicantOutputs.appApplicantIdOutputsPage.chooseASummary')
              : t('applicantOutputs.appApplicantIdOutputsPage.summaryLabel', {
                  label: template.label,
                })
          }
          open={step === 1}
        >
          <nav aria-label={t('applicantOutputs.appApplicantIdOutputsPage.kindsOfSummary')}>
            <ul className="output-templates">
              {OUTPUT_TEMPLATE_IDS.map((templateId) => {
                const item = OUTPUT_TEMPLATES[templateId];
                const href = `${pageHref}?output=${templateId}${ready.missionId ? `&case=${ready.missionId}` : ''}`;
                return (
                  <li key={templateId}>
                    <Link
                      href={href}
                      className="output-template"
                      aria-current={templateId === request.template ? 'page' : undefined}
                    >
                      <span className="output-template-name">{item.label}</span>
                      <span className="output-template-note">{item.description}</span>
                      {/* Seen, not only coloured: the chosen card says so. Read aloud as the current page. */}
                      {templateId === request.template ? (
                        <span
                          className="badge badge-neutral output-template-selected"
                          aria-hidden="true"
                        >
                          {t.node('applicantOutputs.appApplicantIdOutputsPage.selected')}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </CollapsibleGroup>
      </div>

      <section
        id="output-step-options"
        className="card u-mb-150 output-noprint"
        aria-labelledby="output-choose-heading"
      >
        <h3 className="card-title" id="output-choose-heading">
          {t.node('applicantOutputs.appApplicantIdOutputsPage.chooseWhatToInclude')}
        </h3>
        {/* Step 2. Folded once a preview shows, so the preview is near the top; it opens again. */}
        <CollapsibleGroup
          id="output-choices"
          title={t('applicantOutputs.appApplicantIdOutputsPage.yourChoices')}
          open={step !== 3}
        >
          <form method="get" action={`${pageHref}#output-preview`} className="output-form">
            <input type="hidden" name="output" value={request.template} />
            <input type="hidden" name="preview" value="1" />
            {showCasePicker ? (
              <div className="field-row">
                <label className="field-label" htmlFor="output-case">
                  {t.node('applicantOutputs.appApplicantIdOutputsPage.case')}
                </label>
                <select
                  id="output-case"
                  name="case"
                  className="input"
                  defaultValue={ready.missionId ?? ''}
                >
                  {template.needsCase ? null : (
                    <option
                      {...t.lang('applicantOutputs.appApplicantIdOutputsPage.noCase')}
                      value=""
                    >
                      {t('applicantOutputs.appApplicantIdOutputsPage.noCase')}
                    </option>
                  )}
                  {ready.cases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                      {item.referenceCode ? ` (${item.referenceCode})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <fieldset className="fieldset">
              <legend className="field-label">
                {t.node('applicantOutputs.appApplicantIdOutputsPage.partsOfYourRecord')}
              </legend>
              <div className="checks">
                {CATALOGUE_LAYERS.filter((layer) => template.layersOffered.includes(layer.key)).map(
                  (layer) => (
                    <label
                      key={layer.key}
                      className="check output-check"
                      htmlFor={`output-layer-${layer.key}`}
                    >
                      <input
                        id={`output-layer-${layer.key}`}
                        type="checkbox"
                        name="layer"
                        value={layer.key}
                        defaultChecked={choice.layers.includes(layer.key)}
                      />
                      <span className="output-check-text">
                        <span>{layer.label}</span>
                        <span className="muted u-fs-075">
                          {CAREFUL_LAYERS.has(layer.key)
                            ? t.node(
                                'applicantOutputs.appApplicantIdOutputsPage.descriptionSensitiveIncludeItOnlyIf',
                                { description: layer.description },
                              )
                            : layer.description}
                        </span>
                      </span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>

            {template.offersDocumentList ? (
              <fieldset className="fieldset">
                <legend className="field-label">
                  {t.node('applicantOutputs.appApplicantIdOutputsPage.documents')}
                </legend>
                <label className="check output-check" htmlFor="output-docs">
                  <input
                    id="output-docs"
                    type="checkbox"
                    name="docs"
                    value="1"
                    defaultChecked={choice.documentList}
                  />
                  <span className="output-check-text">
                    <span>
                      {t.node(
                        'applicantOutputs.appApplicantIdOutputsPage.includeTheListOfMyDocuments',
                      )}
                    </span>
                    <span className="muted u-fs-075">
                      {t.node(
                        'applicantOutputs.appApplicantIdOutputsPage.kindDatesAndStatusOnlyNo',
                      )}
                    </span>
                  </span>
                </label>
              </fieldset>
            ) : null}

            {template.offersDocumentText ? (
              <fieldset className="fieldset">
                <legend className="field-label">
                  {t.node('applicantOutputs.appApplicantIdOutputsPage.textReadFromMyDocuments')}
                </legend>
                <p className="muted u-fs-075 u-m-0" id="output-text-note">
                  {t.node('applicantOutputs.appApplicantIdOutputsPage.addsTheWordsReadFromYour')}
                </p>
                <div className="checks">
                  {CATALOGUE_DOCUMENT_GROUPS.map((group) => (
                    <label
                      key={group.key}
                      className="check output-check"
                      htmlFor={`output-text-${group.key}`}
                    >
                      <input
                        id={`output-text-${group.key}`}
                        type="checkbox"
                        name="text"
                        value={group.key}
                        aria-describedby="output-text-note"
                        defaultChecked={choice.documentText.includes(group.key)}
                      />
                      <span>{group.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {template.offersDepth ? (
              <fieldset className="fieldset">
                <legend className="field-label">
                  {t.node('applicantOutputs.appApplicantIdOutputsPage.howMuchDetail')}
                </legend>
                <div className="checks">
                  {DEPTH_CHOICES.map(([value, label, note]) => (
                    <label
                      key={value}
                      className="check output-check"
                      htmlFor={`output-depth-${value}`}
                    >
                      <input
                        id={`output-depth-${value}`}
                        type="radio"
                        name="depth"
                        value={value}
                        defaultChecked={choice.depth === value}
                      />
                      <span className="output-check-text">
                        <span>{label}</span>
                        <span className="muted u-fs-075">{note}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {template.offersFullNumbers ? (
              <fieldset className="fieldset">
                <legend className="field-label">
                  {t.node('applicantOutputs.appApplicantIdOutputsPage.numbers')}
                </legend>
                <label className="check output-check" htmlFor="output-numbers">
                  <input
                    id="output-numbers"
                    type="checkbox"
                    name="numbers"
                    value="1"
                    defaultChecked={choice.revealIdentifiers}
                    aria-describedby="output-numbers-note"
                  />
                  <span className="output-check-text">
                    <span>
                      {t.node('applicantOutputs.appApplicantIdOutputsPage.showFullDocumentNumbers')}
                    </span>
                    <span className="muted u-fs-075" id="output-numbers-note">
                      {t.node(
                        'applicantOutputs.appApplicantIdOutputsPage.passportAndIdNumbersShowOnly',
                      )}
                    </span>
                  </span>
                </label>
              </fieldset>
            ) : null}

            {template.offersQuestion ? (
              <div className="field-row">
                <label className="field-label" htmlFor="output-question">
                  {t.node('applicantOutputs.appApplicantIdOutputsPage.whatYouWantHelpWithOptional')}
                </label>
                <input
                  id="output-question"
                  name="q"
                  type="text"
                  className="input"
                  maxLength={600}
                  defaultValue={choice.question}
                  autoComplete="off"
                />
              </div>
            ) : null}

            {template.offersFieldPicker && ready.candidates.length > 0 ? (
              <fieldset className="fieldset">
                <legend className="field-label">
                  {t.node('applicantOutputs.appApplicantIdOutputsPage.detailsToInclude')}
                </legend>
                <input type="hidden" name="picked" value="1" />
                <p className="muted u-fs-075 u-m-0">
                  {t.node(
                    'applicantOutputs.appApplicantIdOutputsPage.theseAreTheConfirmedDetailsIn',
                  )}
                </p>
                {/* Folded away by default (WP-SB4): every box keeps its tick and is sent either way. */}
                <CollapsibleGroup
                  id="output-fields"
                  title={t('applicantOutputs.appApplicantIdOutputsPage.chooseDetails')}
                  count={ready.candidates.length}
                  noun={{ one: 'detail', other: 'details' }}
                >
                  <div className="checks">
                    {ready.candidates.map((candidate, index) => (
                      <label
                        key={candidate.key}
                        className="check output-check"
                        htmlFor={`output-field-${index}`}
                      >
                        <input
                          id={`output-field-${index}`}
                          type="checkbox"
                          name="field"
                          value={candidate.key}
                          defaultChecked={
                            choice.fieldKeys === null || choice.fieldKeys.includes(candidate.key)
                          }
                        />
                        <span>{candidate.label}</span>
                      </label>
                    ))}
                  </div>
                </CollapsibleGroup>
              </fieldset>
            ) : null}

            <StickyActionBar
              label={t('applicantOutputs.appApplicantIdOutputsPage.previewYourSummary')}
            >
              <button type="submit" className="btn btn-primary">
                {t.node('applicantOutputs.appApplicantIdOutputsPage.preview')}
              </button>
              {request.previewed ? (
                <Link href={`${pageHref}?output=${request.template}`} className="btn btn-secondary">
                  {t.node('applicantOutputs.appApplicantIdOutputsPage.startAgain')}
                </Link>
              ) : null}
            </StickyActionBar>
          </form>
        </CollapsibleGroup>
      </section>

      {ready.needsCase ? (
        ready.cases.some((item) => item.current) ? (
          <p className="notice u-mb-150">
            {t.node('applicantOutputs.appApplicantIdOutputsPage.chooseACaseAboveThenPress')}
          </p>
        ) : (
          <EmptyState
            title={t('applicantOutputs.appApplicantIdOutputsPage.noCaseYet')}
            icon="briefcase"
            action={{ href: `/app/applicant/${id}/missions`, label: 'Open Cases' }}
          >
            This summary is about one case. Start a case first, then come back. Or{' '}
            <Link href={`${pageHref}?output=confirmed_sheet`}>
              make a Confirmed Information Sheet
            </Link>
            , which does not need a case.
          </EmptyState>
        )
      ) : null}

      {output && text ? (
        <section
          id="output-preview"
          className="card u-mb-150 output-preview"
          aria-labelledby="output-preview-heading"
        >
          <h3 className="card-title" id="output-preview-heading">
            {t.node('applicantOutputs.appApplicantIdOutputsPage.previewLabel', {
              label: template.label,
            })}
          </h3>
          <p className="muted">
            {t.node('applicantOutputs.appApplicantIdOutputsPage.preparedOnLongdayThisIsExactly', {
              longDay: longDay(output.preparedOn),
            })}
          </p>
          <SelectedScopeSummary
            snapshot
            recipient={template.recipient}
            purpose={template.label}
            permissions={[]}
            profile={
              layerLabels.length > 0 || chosenCase
                ? {
                    kind: 'parts',
                    labels: [...layerLabels, ...(chosenCase ? [`Case: ${chosenCase.title}`] : [])],
                  }
                : { kind: 'nothing' }
            }
            documents={{ kind: 'omit' }}
            endsOn={null}
          />
          {output.selection.documentList ? (
            <p className="muted u-fs-075">
              {t.node('applicantOutputs.appApplicantIdOutputsPage.documentsTheListOnlyNoDocument')}
            </p>
          ) : null}
          {output.selection.revealIdentifiers ? (
            <p className="notice notice-warn">
              {t.node(
                'applicantOutputs.appApplicantIdOutputsPage.fullDocumentNumbersAreIncludedShare',
              )}
            </p>
          ) : null}

          {request.template === 'ai_context' ? (
            <>
              <ul className="output-unknowns">
                {aiSummary(output).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="card-body">
                {t.node('applicantOutputs.appApplicantIdOutputsPage.thisIsTheExactTextAn')}
              </p>
              <textarea
                readOnly
                className="input output-ai"
                rows={14}
                value={text}
                aria-label={t('applicantOutputs.appApplicantIdOutputsPage.theExactTextAnAiApp')}
              />
            </>
          ) : view ? (
            <ViewSections view={view} />
          ) : null}

          <div className="output-actions">
            <CopyTextButton
              text={text}
              label={
                request.template === 'ai_context'
                  ? t('applicantOutputs.appApplicantIdOutputsPage.copyText')
                  : t('applicantOutputs.appApplicantIdOutputsPage.copyAll')
              }
            />
            {request.template === 'trip_essentials' ? <PrintButton /> : null}
          </div>
          <form method="post" action={`${pageHref}/download`} className="output-actions">
            {carriedFields.map(([name, value]) => (
              <input key={`${name}=${value}`} type="hidden" name={name} value={value} />
            ))}
            <input type="hidden" name="fp" value={ready.fingerprint ?? ''} />
            {template.formats.map((format) => (
              <button
                key={format}
                type="submit"
                name="format"
                value={format}
                className="btn btn-secondary output-action"
              >
                {format === 'csv'
                  ? t.node('applicantOutputs.appApplicantIdOutputsPage.downloadSpreadsheetFile')
                  : t.node('applicantOutputs.appApplicantIdOutputsPage.downloadTextFile')}
              </button>
            ))}
          </form>
          <p className="muted u-fs-075">
            {t.node('applicantOutputs.appApplicantIdOutputsPage.theFileIsMadeAgainWhen')}
          </p>
        </section>
      ) : null}

      {output && whatsapp?.ok ? (
        <section className="card output-noprint" aria-labelledby="output-whatsapp-heading">
          <h3 className="card-title" id="output-whatsapp-heading">
            {t.node('applicantOutputs.appApplicantIdOutputsPage.tellThemOnWhatsapp')}
          </h3>
          <p className="card-body">
            {t.node('applicantOutputs.appApplicantIdOutputsPage.aShortMessageYouCanSend')}
          </p>
          <textarea
            readOnly
            className="input output-whatsapp-message"
            rows={3}
            value={whatsapp.message.text}
            aria-label={t('applicantOutputs.appApplicantIdOutputsPage.theWhatsappMessage')}
          />
          <WhatsAppShare
            message={whatsapp.message}
            title={t('applicantOutputs.appApplicantIdOutputsPage.visastack')}
          />
          <p className="muted u-fs-075">
            For them to see your details, share them through{' '}
            <Link href={`/app/applicant/${id}/sharing`}>Sharing</Link>. They sign in and see only
            what you share.
          </p>
        </section>
      ) : null}
    </>
  );
}
