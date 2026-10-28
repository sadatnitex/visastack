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
  buildWhatsAppShare,
  longDay,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SelectedScopeSummary } from '../../../../../components/selected-scope-summary';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { resolveBaseUrl } from '../../../../../lib/base-url';
import { plural } from '../../../../../lib/plural';
import { CopyTextButton, PrintButton } from './copy-button';
import { outputsPath, prepareOutput } from './load';
import { parseOutputRequest, requestFields } from './query';

export const metadata: Metadata = { title: 'Briefs and Summaries' };

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

function ViewSections({ view }: { readonly view: OutputView }) {
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
            <p className="muted u-m-0">{section.emptyNote ?? 'Nothing to show.'}</p>
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
          <h4 className="output-section-title">Still Unknown or Needs a Look</h4>
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
      eyebrow="Share"
      title="Briefs and Summaries"
      description="Choose what goes in, check the preview, then copy, print or download one summary. Everything you do not select stays out."
      back={{ href: `/app/applicant/${id}/record`, label: 'Records' }}
    />
  );

  if (prepared.state === 'not_configured') {
    return (
      <>
        {header}
        <p role="alert" className="notice notice-warn">
          Showing full numbers needs an extra sign-in check, which is not available here right now.
          Turn that choice off to continue.
        </p>
      </>
    );
  }
  if (prepared.state === 'failed') {
    return (
      <>
        {header}
        <p role="alert" className="notice notice-warn">
          We could not prepare this summary just now. Refresh to try again.
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
  const whatsapp = template.whatsapp ? buildWhatsAppShare(resolveBaseUrl()) : null;
  const carriedFields = requestFields({
    ...request,
    choice: { ...choice, missionId: ready.missionId },
  });
  const showCasePicker = template.needsCase || request.template === 'ai_context';

  return (
    <>
      {header}
      <div className="notice u-mb-150 output-noprint">
        <p className="u-m-0">
          A summary is a one-time copy. It does not update when your record changes, and VisaStack
          cannot take it back once you have shared it. Sharing it with an agency or an AI app is
          your choice each time.
        </p>
      </div>

      {request.error === 'changed' ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          Your record or your choices changed after you previewed this, so nothing was downloaded.
          Check the new preview below, then download again.
        </p>
      ) : null}
      {request.error === 'failed' ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          We could not make the file just now. Try again.
        </p>
      ) : null}
      {request.error === 'nothing' ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          There is nothing to download for these choices. Choose something to include first.
        </p>
      ) : null}

      <nav aria-label="Kinds of Summary" className="u-mb-150 output-noprint">
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
                      Selected
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="card u-mb-150 output-noprint" aria-labelledby="output-choose-heading">
        <h3 className="card-title" id="output-choose-heading">
          Choose What to Include
        </h3>
        <form method="get" action={`${pageHref}#output-preview`} className="output-form">
          <input type="hidden" name="output" value={request.template} />
          <input type="hidden" name="preview" value="1" />
          {showCasePicker ? (
            <div className="field-row">
              <label className="field-label" htmlFor="output-case">
                Case
              </label>
              <select
                id="output-case"
                name="case"
                className="input"
                defaultValue={ready.missionId ?? ''}
              >
                {template.needsCase ? null : <option value="">No Case</option>}
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
            <legend className="field-label">Parts of Your Record</legend>
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
                          ? `${layer.description} Sensitive: include it only if the reader needs it.`
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
              <legend className="field-label">Documents</legend>
              <label className="check output-check" htmlFor="output-docs">
                <input
                  id="output-docs"
                  type="checkbox"
                  name="docs"
                  value="1"
                  defaultChecked={choice.documentList}
                />
                <span className="output-check-text">
                  <span>Include the List of My Documents</span>
                  <span className="muted u-fs-075">
                    Kind, dates and status only. No file is ever included.
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}

          {template.offersDocumentText ? (
            <fieldset className="fieldset">
              <legend className="field-label">Text Read from My Documents</legend>
              <p className="muted u-fs-075 u-m-0" id="output-text-note">
                Adds the words read from your documents in the groups you tick. Passports, ID, money
                and health documents are never included. Choose this only if the AI app needs the
                words themselves.
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
              <legend className="field-label">How Much Detail</legend>
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
              <legend className="field-label">Numbers</legend>
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
                  <span>Show Full Document Numbers</span>
                  <span className="muted u-fs-075" id="output-numbers-note">
                    Passport and ID numbers show only their last three characters unless you tick
                    this. You will be asked to confirm it is you.
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}

          {template.offersQuestion ? (
            <div className="field-row">
              <label className="field-label" htmlFor="output-question">
                What You Want Help with (Optional)
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
              <legend className="field-label">Details to Include</legend>
              <input type="hidden" name="picked" value="1" />
              <p className="muted u-fs-075 u-m-0">
                These are the confirmed details in the parts you chose. Untick any you do not want
                in the sheet.
              </p>
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
            </fieldset>
          ) : null}

          <div className="output-actions">
            <button type="submit" className="btn btn-primary">
              Preview
            </button>
            {request.previewed ? (
              <Link href={`${pageHref}?output=${request.template}`} className="btn btn-secondary">
                Start Again
              </Link>
            ) : null}
          </div>
        </form>
      </section>

      {ready.needsCase ? (
        ready.cases.some((item) => item.current) ? (
          <p className="notice u-mb-150">Choose a case above, then press Preview.</p>
        ) : (
          <EmptyState
            title="No Case Yet"
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
            Preview: {template.label}
          </h3>
          <p className="muted">
            Prepared on {longDay(output.preparedOn)}. This is exactly what the copy or file will
            hold.
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
              Documents: the list only. No document file is included.
            </p>
          ) : null}
          {output.selection.revealIdentifiers ? (
            <p className="notice notice-warn">
              Full document numbers are included. Share this copy only with someone who needs them.
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
                This is the exact text an AI app would receive. It has no files and no links, and
                the app is told it is a snapshot.
              </p>
              <textarea
                readOnly
                className="input output-ai"
                rows={14}
                value={text}
                aria-label="The exact text an AI app would receive"
              />
            </>
          ) : view ? (
            <ViewSections view={view} />
          ) : null}

          <div className="output-actions">
            <CopyTextButton
              text={text}
              label={request.template === 'ai_context' ? 'Copy Text' : 'Copy All'}
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
                {format === 'csv' ? 'Download Spreadsheet File' : 'Download Text File'}
              </button>
            ))}
          </form>
          <p className="muted u-fs-075">
            The file is made again when you download it. If your record changed since this preview,
            nothing is downloaded and you will be asked to preview again.
          </p>
        </section>
      ) : null}

      {output && whatsapp?.ok ? (
        <section className="card output-noprint" aria-labelledby="output-whatsapp-heading">
          <h3 className="card-title" id="output-whatsapp-heading">
            Tell Them on WhatsApp
          </h3>
          <p className="card-body">
            A short message you can send yourself. It holds no document, number or name, only a link
            to sign in to VisaStack. VisaStack never sends it for you.
          </p>
          <textarea
            readOnly
            className="input output-whatsapp-message"
            rows={3}
            value={whatsapp.value.message}
            aria-label="The WhatsApp message"
          />
          <div className="output-actions">
            <a
              href={whatsapp.value.href}
              className="btn btn-secondary output-action"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open WhatsApp
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <CopyTextButton text={whatsapp.value.message} label="Copy Message" />
          </div>
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
