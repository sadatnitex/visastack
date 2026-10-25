'use client';

import { useState } from 'react';
import { Icon } from './icons';
import { StatusBadge, type Tone } from './ui';

export interface DocumentReviewEntry {
  readonly id: string;
  readonly name: string;
  readonly safetyLabel: string;
  readonly safetyTone?: Tone;
  readonly processingLabel: string;
  readonly previewAllowed: boolean;
}

/** Metadata only. Opening bytes always goes through the existing authorized server action. */
export function DocumentReviewPanel({
  applicantId,
  documents,
  previewAction,
}: {
  readonly applicantId: string;
  readonly documents: readonly DocumentReviewEntry[];
  readonly previewAction: (form: FormData) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(documents[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const matches = documents.filter((document) =>
    document.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selected = matches.find((document) => document.id === selectedId) ?? matches[0];
  return (
    <aside className="card document-review-panel" aria-label="Document details">
      <p className="card-kicker">Your Document</p>
      <h2 className="card-title">Review and Preview</h2>
      {documents.length ? (
        <>
          <label className="field-label" htmlFor="review-document-search">
            Find a Document
          </label>
          <input
            className="input"
            id="review-document-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </>
      ) : null}
      {selected ? (
        <>
          <label className="field-label" htmlFor="review-document">
            Choose a document
          </label>
          <select
            className="input"
            id="review-document"
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {matches.map((document) => (
              <option key={document.id} value={document.id}>
                {document.name}
              </option>
            ))}
          </select>
          <div className="document-preview-placeholder">
            <Icon name="folder" size={40} />
            <p>Private document</p>
            <p className="card-body">Contents appear only after permission and safety checks.</p>
          </div>
          <h3 className="document-review-name">{selected.name}</h3>
          <div className="document-review-status">
            <StatusBadge tone={selected.safetyTone ?? 'neutral'}>
              {selected.safetyLabel}
            </StatusBadge>
            <span className="card-body">{selected.processingLabel}</span>
          </div>
          {selected.previewAllowed ? (
            <form action={previewAction}>
              <input type="hidden" name="applicantId" value={applicantId} />
              <input type="hidden" name="documentId" value={selected.id} />
              <button type="submit" className="btn btn-primary">
                Open Secure Preview
              </button>
            </form>
          ) : (
            <p className="notice">
              This document is not available to preview. Review its status in the document list.
            </p>
          )}
        </>
      ) : (
        <p className="card-body">
          {documents.length
            ? 'No documents match. Try another name or clear your search.'
            : 'Upload a document to review its details here.'}
        </p>
      )}
    </aside>
  );
}
