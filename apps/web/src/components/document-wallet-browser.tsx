'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { formatTimestampDate } from '../lib/format-date';
import { agree, plural } from '../lib/plural';
import { EmptyState, StatusBadge } from './ui';

export interface WalletBrowserDocument {
  readonly id: string;
  readonly name: string;
  /** The kind of document in plain words (for example "Passport"), or null when it is not set. */
  readonly kind: string | null;
  /** The AI's suggested kind while nobody has approved it yet. Shown as a suggestion, never as the kind. */
  readonly suggestedKind?: string | null;
  /** The sharing category the kind files this document under (for example "Identity"), or null. */
  readonly category: string | null;
  readonly version: number | null;
  readonly updatedAt: string | null;
  readonly ready: boolean;
  readonly needsReview: boolean;
  readonly expiring: boolean;
  readonly safetyLabel: string;
  readonly processingLabel: string;
  readonly previewAllowed: boolean;
  readonly details: ReactNode;
}
type Filter = 'all' | 'ready' | 'review' | 'expiring';
/** The summary tiles above the list, which also filter it. Names, so Title Case. */
const FILTER_LABELS: Readonly<Record<Filter, string>> = {
  all: 'All Documents',
  ready: 'Ready to Use',
  review: 'Needs Review',
  expiring: 'Expiring Soon',
};
const PAGE_SIZE = 12;
/** The filter choice for documents that no category holds yet. */
const NOT_SORTED = '__not-sorted__';

/** Metadata filters only. Byte access remains inside the existing authorized server actions. */
export function DocumentWalletBrowser({
  applicantId,
  documents,
  initialSelection,
}: {
  readonly applicantId: string;
  readonly documents: readonly WalletBrowserDocument[];
  readonly initialSelection?: string;
}) {
  const [selectedId, setSelectedId] = useState(initialSelection ?? documents[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const categories = [
    ...new Set(
      documents.map((doc) => doc.category).filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const notSorted = documents.filter((doc) => doc.category === null).length;
  const matches = documents.filter(
    (doc) =>
      (category === 'all' ||
        (category === NOT_SORTED ? doc.category === null : doc.category === category)) &&
      (filter === 'all' ||
        (filter === 'ready' ? doc.ready : filter === 'review' ? doc.needsReview : doc.expiring)) &&
      `${doc.name} ${doc.kind ?? ''} ${doc.category ?? ''}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount - 1);
  const visible = matches.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
  const selected = documents.find((doc) => doc.id === selectedId);
  const counts = {
    all: documents.length,
    ready: documents.filter((doc) => doc.ready).length,
    review: documents.filter((doc) => doc.needsReview).length,
    expiring: documents.filter((doc) => doc.expiring).length,
  };
  return (
    <>
      <div className="wallet-overview-strip" aria-label="Document state filters">
        {(Object.entries(FILTER_LABELS) as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
              setPage(0);
            }}
          >
            <span>{label}</span>
            <strong>{counts[key]}</strong>
          </button>
        ))}
      </div>
      <div className="document-wallet-layout">
        <section className="card document-wallet-list" aria-label="Document metadata list">
          <div className="wallet-filter-controls">
            <label>
              Category
              <select
                className="input"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All Categories</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
                {notSorted > 0 ? <option value={NOT_SORTED}>Not Set Yet</option> : null}
              </select>
            </label>
            <label>
              Search Documents
              <input
                className="input"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="Search names, kinds or categories"
              />
            </label>
          </div>
          {notSorted > 0 ? (
            <p className="notice" data-testid="wallet-not-sorted">
              {notSorted} document{notSorted === 1 ? ' has' : 's have'} no kind set yet, so{' '}
              {notSorted === 1 ? 'it is' : 'they are'} in no category and left out when you share by
              category. Open a document and choose its kind.{' '}
              {category === NOT_SORTED ? null : (
                <button
                  type="button"
                  className="btn btn-secondary u-btn-xs"
                  onClick={() => {
                    setCategory(NOT_SORTED);
                    setPage(0);
                  }}
                >
                  Show {notSorted === 1 ? 'It' : 'Them'}
                </button>
              )}
            </p>
          ) : null}
          <output className="muted">
            {plural(matches.length, 'document')} {agree(matches.length, 'matches', 'match')}. Page{' '}
            {activePage + 1} of {pageCount}.
          </output>
          {visible.length ? (
            <ul className="wallet-metadata-list">
              {visible.map((doc) => (
                <li key={doc.id} id={`document-${doc.id}`}>
                  <button
                    type="button"
                    className="wallet-document-select"
                    aria-pressed={selectedId === doc.id}
                    onClick={() => {
                      setSelectedId(doc.id);
                      const url = new URL(window.location.href);
                      url.searchParams.set('document', doc.id);
                      window.history.replaceState(window.history.state, '', url);
                    }}
                  >
                    <span className="wallet-document-name">{doc.name}</span>
                    <span className="muted">
                      {doc.kind ?? 'Kind not set'}
                      {doc.category ? ` · ${doc.category}` : ''}
                      {doc.kind === null && doc.suggestedKind
                        ? ` · AI suggests ${doc.suggestedKind}`
                        : ''}{' '}
                      · {doc.version === null ? 'Version unavailable' : `Version ${doc.version}`}
                    </span>
                    <span className="wallet-document-state">
                      <StatusBadge
                        tone={doc.needsReview ? 'warning' : doc.ready ? 'success' : 'neutral'}
                      >
                        {doc.processingLabel}
                      </StatusBadge>
                      <span>{doc.safetyLabel}</span>
                    </span>
                    <span className="muted">
                      {doc.updatedAt
                        ? `Updated ${formatTimestampDate(doc.updatedAt)}`
                        : 'Update time unavailable'}
                    </span>
                  </button>
                  {selectedId === doc.id ? (
                    <a className="wallet-detail-jump" href="#wallet-selected-document">
                      View Selected Details →
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="file"
              title={documents.length ? 'No Documents Match' : 'No Documents Yet'}
              {...(documents.length
                ? {}
                : {
                    why: 'You add each paper once, and it can fill a checklist item on any visa case.',
                    action: { href: '#add-document', label: 'Add a Document' },
                  })}
            >
              {documents.length
                ? 'Clear the search or choose another category or status.'
                : 'This is your document vault: passports, bank statements, photos and the other papers you use again and again. Add your first one with the form on this page.'}
            </EmptyState>
          )}
          {pageCount > 1 ? (
            <div className="wallet-pagination" aria-label="Document pages">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={activePage === 0}
                onClick={() => setPage(activePage - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={activePage + 1 === pageCount}
                onClick={() => setPage(activePage + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </section>
        <aside
          id="wallet-selected-document"
          tabIndex={-1}
          className="card wallet-selected-document"
          aria-label="Selected document details"
        >
          <h3>Selected Document</h3>
          {selected ? (
            <>
              {!matches.some((doc) => doc.id === selected.id) ? (
                <p className="muted">Your selected document is outside the current list filter.</p>
              ) : null}
              <div className="document-preview-placeholder">
                <strong>{selected.name}</strong>
                <p>
                  {selected.previewAllowed
                    ? 'Open the secure preview below. Permission and current safety are checked again before bytes are served.'
                    : 'Preview is blocked while this file is unsafe, still processing or otherwise unavailable.'}
                </p>
              </div>
              <p className="muted">
                File format is checked when the file is opened. A verified format is not recorded in
                this metadata view.
              </p>
              {selected.details}
              <Link className="btn btn-secondary" href={`/app/applicant/${applicantId}/sharing`}>
                Review Sharing Permissions
              </Link>
              <p className="wallet-ai-notice">
                Sharing requires consent, an exact reviewed scope and recipient acceptance. AI
                suggestions never update your profile until you approve them.
              </p>
            </>
          ) : (
            <EmptyState
              icon="alert"
              title={selectedId ? 'Selected Document Is Unavailable' : 'Choose a Document'}
            >
              Select an available row to review its metadata and authorized actions.
            </EmptyState>
          )}
        </aside>
      </div>
    </>
  );
}
