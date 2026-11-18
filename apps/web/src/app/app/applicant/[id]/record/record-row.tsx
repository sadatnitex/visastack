'use client';
import Link from 'next/link';
import { useT } from '../../../../../components/i18n-provider';
import { DocumentPicture } from '../../../../../components/pictures/document-picture';
import { StatusPicture } from '../../../../../components/pictures/status-picture';
import { ExpandableSection } from '../../../../../components/ui-lift/expandable-section';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import type { RecordDetailId, RecordItem, RecordNotStarted } from '../record-hub';
import { recordStatusPicture } from './record-status';
import './u6-records.css';

const KEY = 'appApplicant.appApplicantIdRecordRow.';
const DETAIL_LABELS = {
  waiting: `${KEY}waitingOnYou`,
  version: `${KEY}version`,
  saved: `${KEY}saved`,
  expires: `${KEY}expires`,
  replacedBy: `${KEY}replacedBy`,
  usedIn: `${KEY}usedInCases`,
  sharedWith: `${KEY}sharedWith`,
  detailsSaved: `${KEY}detailsSaved`,
} as const satisfies Record<RecordDetailId, string>;
/** What an empty value says, for the details that can be empty. */
const EMPTY_VALUES = {
  expires: `${KEY}notConfirmed`,
  usedIn: `${KEY}noneYet`,
  sharedWith: `${KEY}noOne`,
} as const;

/**
 * One item of the Record as one compact row (U6): a picture, the name, one status picture and one
 * action. The details sit inside the row, so the list never repeats them as lines of text. The
 * name is the toggle; the item's own page and the one action are real links, so nothing the
 * person could do before is lost.
 */
export function RecordRow({ item }: { readonly item: RecordItem }) {
  const t = useT(appApplicantCatalog);
  // An end date is known when the opened row has one; only then may the sentence mention it.
  const dated = item.detailRows?.some((row) => row.id === 'expires' && row.value !== null) ?? false;
  const picture = recordStatusPicture(item.status.label, dated);
  const sentence = t(picture.sentenceKey);
  // A document names its kind under the name. Everything else lives inside the row, so the closed
  // row never repeats a detail line (a profile section's count is the first row inside).
  const summary = item.type;
  const opensSamePage = item.action?.href === item.href;
  return (
    <li className="u6-row" data-kind={item.kind}>
      <ExpandableSection
        title={
          <span className="record-hub-item-title" dir="auto">
            {item.title}
          </span>
        }
        summary={summary}
        picture={
          <DocumentPicture
            type={item.kind === 'document' ? item.type : null}
            size={32}
            generic="icon"
          />
        }
        status={<StatusPicture kind={picture.kind} label={item.status.label} text={sentence} />}
        statusDescription={`${item.status.label}. ${sentence}`}
      >
        {item.detailRows ? (
          <dl className="u6-facts">
            {item.detailRows.map((row) => {
              const empty = row.id === 'expires' || row.id === 'usedIn' || row.id === 'sharedWith';
              return (
                <div key={row.id} className="u6-fact">
                  <dt>{t(DETAIL_LABELS[row.id])}</dt>
                  <dd>
                    {row.id === 'detailsSaved'
                      ? t(`${KEY}detailsSavedValue`, {
                          answered: row.value ?? '0',
                          total: row.total ?? 0,
                        })
                      : (row.value ??
                        (empty ? t(EMPTY_VALUES[row.id as keyof typeof EMPTY_VALUES]) : ''))}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <ul className="u6-facts-list">
            {item.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        )}
        {opensSamePage ? null : (
          <Link
            className="u6-open"
            href={item.href}
            aria-label={`${t(`${KEY}openDocument`)}: ${item.title}`}
          >
            {t(`${KEY}openDocument`)}
          </Link>
        )}
      </ExpandableSection>
      {item.action ? (
        <div className="u6-row-action">
          <Link
            className="btn btn-secondary"
            href={item.action.href}
            aria-label={`${item.action.label}: ${item.title}`}
          >
            {item.action.label}
          </Link>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The one Not Started group (owner screenshot, 18 Nov 2026): a quiet row for each group that still
 * has empty profile sections, with a link to each section inside. Replaces a line of links under
 * every group.
 */
export function NotStartedRows({ groups }: { readonly groups: readonly RecordNotStarted[] }) {
  const t = useT(appApplicantCatalog);
  return (
    <ul className="u6-rows u6-quiet">
      {groups.map(({ name, sections }) => (
        <li key={name}>
          <ExpandableSection
            title={<span dir="auto">{name}</span>}
            summary={t(`${KEY}moreToAdd`, { count: sections.length })}
          >
            <ul className="u6-links">
              {sections.map((section) => (
                <li key={section.id}>
                  <Link href={section.href}>{section.title}</Link>
                </li>
              ))}
            </ul>
          </ExpandableSection>
        </li>
      ))}
    </ul>
  );
}
