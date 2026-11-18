import { DocumentPicture } from '../../src/components/pictures/document-picture';
import {
  STATUS_KINDS,
  STATUS_MEANINGS,
  type StatusKind,
  StatusPicture,
  statusPictureWords,
} from '../../src/components/pictures/status-picture';
import { ExpandableSection } from '../../src/components/ui-lift/expandable-section';

/**
 * WAL1: the Expandable Section with all six status pictures, as later screens will use it. The
 * real components and the real stylesheet; the words are made up. Summaries are short, long in
 * English and long in Bangla (Bangla runs about a third longer), so wrapping is tested. Used by
 * e2e/wallet/u1-foundation.spec.ts.
 */
export interface Wal1FixtureProps {
  /** Every section starts open. */
  readonly open?: boolean;
}

const LONG_ENGLISH =
  'Given name, family name, date of birth, place of birth, passport number, date of issue and date of expiry, with two details still to add before this case can be prepared';

const LONG_BANGLA =
  'আপনার পাসপোর্টের নাম, জন্ম তারিখ, জন্মস্থান, পাসপোর্ট নম্বর, ইস্যুর তারিখ এবং মেয়াদ শেষের তারিখ, যার মধ্যে আরও দুটি তথ্য যোগ করা বাকি আছে';

const SUMMARIES: Readonly<Record<StatusKind, { text: string; bangla?: true }>> = {
  DECLARED: { text: '3 of 5 added' },
  DOCUMENT_SUPPORTED: { text: LONG_ENGLISH },
  EXTRACTED_PENDING: { text: LONG_BANGLA, bangla: true },
  APPLICANT_CONFIRMED: { text: 'Date of birth' },
  CONFLICTED: { text: `${LONG_ENGLISH} ${LONG_ENGLISH}` },
  STALE: { text: `${LONG_BANGLA} ${LONG_BANGLA}`, bangla: true },
};

function Body({ kind }: { readonly kind: StatusKind }) {
  const field = `wal1-${kind}`;
  return (
    <>
      <p>{STATUS_MEANINGS[kind].sentence}</p>
      <div className="field">
        <label htmlFor={`${field}-value`}>Value to Save</label>
        <input id={`${field}-value`} defaultValue="EXAMPLE" />
      </div>
      <div className="field">
        <label htmlFor={`${field}-source`}>Where It Came From</label>
        <select id={`${field}-source`} defaultValue="file">
          <option value="file">A File You Uploaded</option>
          <option value="typed">Typed In</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${field}-note`}>Note</label>
        <textarea id={`${field}-note`} rows={2} defaultValue="" />
      </div>
      <div className="lift-actions">
        <button type="button" className="btn btn-primary">
          Save
        </button>
        <a href="#top" className="btn btn-secondary">
          Open the File
        </a>
      </div>
    </>
  );
}

export default function Wal1FoundationFixture({ open = false }: Wal1FixtureProps) {
  return (
    <div className="wal1-fixture" id="top">
      <h1>Status Pictures</h1>
      <ul className="status-picture-key wal1-fixture-legend" aria-label="Status Pictures">
        {STATUS_KINDS.map((kind) => (
          <li key={kind} data-kind={kind}>
            <StatusPicture kind={kind} />
            {/* The button already carries the name for screen readers; this copy is for the eye. */}
            <span aria-hidden="true">{STATUS_MEANINGS[kind].name}</span>
          </li>
        ))}
      </ul>
      <h2>Sections</h2>
      <div className="wal1-fixture-sections">
        {STATUS_KINDS.map((kind) => {
          const { text, bangla } = SUMMARIES[kind];
          return (
            <ExpandableSection
              key={kind}
              id={`section-${kind}`}
              className={`wal1-section-${kind}`}
              title={`${STATUS_MEANINGS[kind].name} Details`}
              summary={bangla ? <span lang="bn">{text}</span> : text}
              picture={<DocumentPicture type="PASSPORT" size={40} />}
              status={<StatusPicture kind={kind} />}
              statusDescription={statusPictureWords(kind)}
              defaultOpen={open}
              remember
            >
              <Body kind={kind} />
            </ExpandableSection>
          );
        })}
        <ExpandableSection id="section-plain" title="How This Was Checked" defaultOpen={open}>
          <p>A section with a name only: no picture, no summary, no status.</p>
        </ExpandableSection>
      </div>
    </div>
  );
}
