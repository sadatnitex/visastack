'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { DEPTH_PHONE_QUERY } from '../lib/ccd/depth';
import { formatTimestampDate } from '../lib/format-date';
import { documentMark } from '../lib/item-icons';
import { agree, plural } from '../lib/plural';
import { useMediaQuery } from '../lib/use-popover';
import { Icon } from './icons';
import { ListFilterBar } from './list-pattern';
import { useSheetBehaviour } from './list-pattern/use-sheet';
import { MarkTile } from './mark-tile';
import { EmptyState, StatusBadge } from './ui';

export interface WalletBrowserDocument {
  readonly id: string;
  readonly name: string;
  /** The kind of document in plain words (for example "Passport"), or null when it is not set. */
  readonly kind: string | null;
  /** The AI's suggested kind while nobody has approved it yet. Shown as a suggestion, never as the kind. */
  readonly suggestedKind?: string | null;
  /** The stored type key (for example PASSPORT): the picture on the row comes from it, never from the label. */
  readonly docType?: string | null;
  /** The sharing category the kind files this document under (for example "Identity"), or null. */
  readonly category: string | null;
  readonly version: number | null;
  readonly updatedAt: string | null;
  readonly ready: boolean;
  readonly needsReview: boolean;
  readonly expiring: boolean;
  readonly safetyLabel: string;
  /** The colour of the safety words; neutral when the page does not say. */
  readonly safetyTone?: 'neutral' | 'success' | 'warning' | 'danger';
  readonly processingLabel: string;
  readonly previewAllowed: boolean;
  /**
   * The one word a row shows when something is not normal (Needs Review, Expiring Soon, Failed),
   * or null when nothing is wrong. When the page leaves it out, the row works it out from the
   * fields above. A normal file shows nothing here; how it was checked is in its details.
   */
  readonly stateWords?: { readonly label: string; readonly tone: RowTone } | null;
  readonly details: ReactNode;
  /**
   * The sentences about this file that are not facts or actions (how it was checked, why a hint
   * exists, what to try next). They sit in the one closed "About This File" fold, so the opened
   * document shows its facts and its actions (Owner, 5 Nov 2026: no page should have more than 30
   * words).
   */
  readonly aboutFile?: ReactNode;
  /** The row's Manage menu (resource lifecycle), drawn in the row next to its select button. */
  readonly manage?: ReactNode;
}
type RowTone = 'neutral' | 'success' | 'warning' | 'danger';
type Filter = 'all' | 'ready' | 'review' | 'expiring';
/** The colour each summary tile speaks in: blue is everything, green is ready, amber needs a look, red runs out. */
const FILTER_TONES: Readonly<Record<Filter, 'blue' | 'green' | 'amber' | 'red'>> = {
  all: 'blue',
  ready: 'green',
  review: 'amber',
  expiring: 'red',
};
/** The summary tiles above the list, which also filter it. Names, so Title Case. */
const FILTER_LABELS: Readonly<Record<Filter, string>> = {
  all: 'All Documents',
  ready: 'Ready to Use',
  review: 'Needs Review',
  expiring: 'Expiring Soon',
};
/**
 * Rows a page. A phone shows fewer, so the list with its Previous and Next buttons stays within
 * three screens (docs/uiux/SCROLL-BUDGET.md, enforced by e2e/scroll-budget/WP-SB4.spec.ts); every
 * document is still reached through the pages. The page is drawn first with the larger size, as
 * the server cannot know the screen, then narrows once the browser reports a phone.
 */
export const WALLET_PAGE_SIZE = { desktop: 12, phone: 6 } as const;
/** The filter choice for documents that no category holds yet. */
const NOT_SORTED = '__not-sorted__';

/** What a row says about its file when something is not normal; nothing when it is. */
function rowState(doc: WalletBrowserDocument): { label: string; tone: RowTone } | null {
  if (doc.stateWords !== undefined) return doc.stateWords;
  const safety = doc.safetyTone ?? 'neutral';
  if (safety === 'danger' || safety === 'warning') return { label: doc.safetyLabel, tone: safety };
  if (doc.needsReview) return { label: doc.processingLabel, tone: 'warning' };
  if (doc.expiring) return { label: 'Expiring Soon', tone: 'warning' };
  return doc.ready ? null : { label: doc.processingLabel, tone: 'neutral' };
}

/** The kind part of a row's second line: data, never a sentence. The date follows as its own piece. */
function rowKindLine(doc: WalletBrowserDocument): string {
  const parts = [
    doc.kind ?? 'Kind not set',
    doc.kind === null && doc.suggestedKind ? `AI suggests ${doc.suggestedKind}` : null,
    doc.version !== null && doc.version > 1 ? `Version ${doc.version}` : null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

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
  // On a phone the chosen document opens as a full screen of its own, with one way back. A link
  // that names a document (a reminder) opens it straight away. Larger screens keep the side panel.
  const [sheetOpen, setSheetOpen] = useState(Boolean(initialSelection));
  const phone = useMediaQuery(DEPTH_PHONE_QUERY);
  const sheetShown = phone && sheetOpen;
  const sheet = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /**
   * Leaves the full screen. The chosen document is also taken out of the address, so a refresh of
   * the page (it refreshes by itself while files are read) never reopens the screen that was
   * just closed.
   */
  const closeSheet = () => {
    setSheetOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('document');
    url.searchParams.delete('action');
    window.history.replaceState(window.history.state, '', url);
    // Back to the row that opened it, so a keyboard or screen reader person is where they were.
    opener.current?.focus();
  };
  const closeSheetRef = useRef(closeSheet);
  closeSheetRef.current = closeSheet;
  // Esc, Tab inside the full screen and no scrolling behind it: the one behaviour of every panel.
  useSheetBehaviour({
    open: sheetShown,
    trap: sheetShown,
    panel: sheet,
    onClose: () => closeSheetRef.current(),
  });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const pageSize = useMediaQuery(DEPTH_PHONE_QUERY)
    ? WALLET_PAGE_SIZE.phone
    : WALLET_PAGE_SIZE.desktop;
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
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const activePage = Math.min(page, pageCount - 1);
  const visible = matches.slice(activePage * pageSize, (activePage + 1) * pageSize);
  const selected = documents.find((doc) => doc.id === selectedId);
  const counts = {
    all: documents.length,
    ready: documents.filter((doc) => doc.ready).length,
    review: documents.filter((doc) => doc.needsReview).length,
    expiring: documents.filter((doc) => doc.expiring).length,
  };
  return (
    <>
      {/* Four zeros say nothing: with no documents at all the empty state below is the whole screen. */}
      {documents.length > 0 ? (
        <div className="wallet-overview-strip" aria-label="Document state filters">
          {(Object.entries(FILTER_LABELS) as [Filter, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-tone={FILTER_TONES[key]}
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key);
                setPage(0);
              }}
            >
              <span className="wallet-tile-name">{label}</span>
              <strong>{counts[key]}</strong>
            </button>
          ))}
        </div>
      ) : null}
      <div className="document-wallet-layout">
        <section className="card document-wallet-list" aria-label="Document metadata list">
          {documents.length > 0 ? (
            <ListFilterBar
              rows={documents.length}
              minRows={1}
              filtersLevel="browse"
              activeFilters={category === 'all' ? 0 : 1}
              query={query}
              onQuery={(value) => {
                setQuery(value);
                setPage(0);
              }}
              searchLabel="Search Documents"
            >
              <label>
                <span className="sr-only">Category</span>
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
            </ListFilterBar>
          ) : null}
          {notSorted > 0 ? (
            <div className="wallet-nokind" data-testid="wallet-not-sorted">
              <span className="wallet-nokind-icon" aria-hidden="true">
                <Icon name="alert" size={18} />
              </span>
              <span className="wallet-nokind-title">
                {notSorted} {agree(notSorted, 'Needs', 'Need')} a Kind
              </span>
              <details className="wallet-why">
                <summary>Why?</summary>
                <p>
                  {notSorted} document{notSorted === 1 ? ' has' : 's have'} no kind set yet, so{' '}
                  {notSorted === 1 ? 'it is' : 'they are'} in no category and left out when you
                  share by category. Open a document and choose its kind.
                </p>
              </details>
              <button
                type="button"
                className="btn btn-secondary u-btn-xs"
                onClick={() => {
                  setCategory(category === NOT_SORTED ? 'all' : NOT_SORTED);
                  setPage(0);
                }}
              >
                {category === NOT_SORTED ? 'Show All' : `Show ${notSorted === 1 ? 'It' : 'Them'}`}
              </button>
            </div>
          ) : null}
          <output className="sr-only">
            {plural(matches.length, 'document')} {agree(matches.length, 'matches', 'match')}. Page{' '}
            {activePage + 1} of {pageCount}.
          </output>
          {visible.length ? (
            <ul className="wallet-metadata-list">
              {visible.map((doc) => {
                const state = rowState(doc);
                return (
                  <li key={doc.id} id={`document-${doc.id}`}>
                    <button
                      type="button"
                      className="wallet-document-select"
                      aria-pressed={selectedId === doc.id}
                      onClick={(event) => {
                        setSelectedId(doc.id);
                        opener.current = event.currentTarget;
                        setSheetOpen(true);
                        const url = new URL(window.location.href);
                        url.searchParams.set('document', doc.id);
                        window.history.replaceState(window.history.state, '', url);
                      }}
                    >
                      <MarkTile
                        mark={documentMark(doc.docType ?? null)}
                        size="sm"
                        className="wallet-document-icon"
                      />
                      <span className="wallet-document-name" data-value="name">
                        {doc.name}
                      </span>
                      {state ? (
                        <span className="wallet-document-state">
                          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                        </span>
                      ) : null}
                      <span className="wallet-document-kind" data-value="kind">
                        {rowKindLine(doc)}
                      </span>
                      {doc.updatedAt ? (
                        <span className="wallet-document-updated" data-value="date">
                          {formatTimestampDate(doc.updatedAt)}
                        </span>
                      ) : null}
                    </button>
                    {doc.manage ? <div className="wallet-document-manage">{doc.manage}</div> : null}
                    {selectedId === doc.id ? (
                      <a className="wallet-detail-jump" href="#wallet-selected-document">
                        View Selected Details →
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              art="documents"
              title={documents.length ? 'No Documents Match' : 'No Documents Yet'}
              {...(documents.length
                ? {}
                : {
                    why: 'Then use it on every case.',
                    action: {
                      href: `/app/applicant/${applicantId}/documents/add`,
                      label: 'Add a Document',
                    },
                  })}
            >
              {documents.length
                ? 'Clear the search or choose another category or status.'
                : 'Add each paper once.'}
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
              <span className="wallet-page-count" data-value="page">
                {activePage + 1} of {pageCount}
              </span>
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
          ref={sheet}
          tabIndex={-1}
          className="card wallet-selected-document"
          data-sheet={sheetOpen ? 'open' : 'closed'}
          aria-label="Selected document details"
          {...(sheetShown ? { role: 'dialog', 'aria-modal': true } : {})}
        >
          <div className="wallet-sheet-bar">
            <button type="button" className="btn btn-secondary" onClick={closeSheet}>
              Back to Documents
            </button>
          </div>
          <h2 className="wallet-selected-title">Selected Document</h2>
          {selected ? (
            <>
              {!matches.some((doc) => doc.id === selected.id) ? (
                <p className="muted">Your selected document is outside the current list filter.</p>
              ) : null}
              <div className="document-preview-placeholder">
                <strong data-value="name">{selected.name}</strong>
                {selected.previewAllowed ? null : <p>Preview is blocked for this file.</p>}
              </div>
              {selected.details}
              <Link className="btn btn-secondary" href={`/app/applicant/${applicantId}/sharing`}>
                Review Sharing Permissions
              </Link>
              <details className="docs-more wallet-about-file">
                <summary>About This File</summary>
                {selected.previewAllowed ? null : (
                  <p>
                    Preview is blocked while this file is unsafe, still processing or otherwise
                    unavailable.
                  </p>
                )}
                {selected.aboutFile}
                {selected.previewAllowed ? (
                  <p>
                    Open the secure preview below. Permission and current safety are checked again
                    before bytes are served.
                  </p>
                ) : null}
                <p className="muted">
                  File format is checked when the file is opened. A verified format is not recorded
                  in this metadata view.
                </p>
                <p className="wallet-ai-notice">
                  Sharing requires consent, an exact reviewed scope and recipient acceptance. AI
                  suggestions never update your profile until you approve them.
                </p>
              </details>
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
